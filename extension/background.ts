import type {
  ExtensionCredentials,
  ExtensionLoginSummary,
  ExtensionPasskeyCreateInput,
  ExtensionPasskeyCreateResult,
  ExtensionPasskeyGetInput,
  ExtensionPasskeyGetResult,
} from '../src/lib/extensionProtocol'
import { hostFromUrl, hostMatches } from '../src/lib/extensionProtocol'
import { isValidRpId } from '../src/lib/passkeys'
import {
  nativeFill,
  nativeFocus,
  nativePair,
  nativePasskeyCreate,
  nativePasskeyGet,
  nativeSaveLogin,
  nativeSearch,
  nativeStatus,
} from './nativeBridge'

/** Firefox expose `browser` (promesses) ; Chrome expose `chrome`. */
const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

const DEFAULT_APP_URL = 'http://localhost:1420'
const APP_URL_KEY = 'appUrl'

interface ExtensionMessage {
  type?: string
  query?: string
  itemId?: string
  tabId?: number
  frameId?: number
  host?: string
  username?: string
  password?: string
  url?: string
  appUrl?: string
  kind?: string
  requestId?: string
  payload?: unknown
  decision?: string
}

interface AppStatus {
  appOpen: boolean
  unlocked: boolean
  paired?: boolean
  hostAccess?: boolean
  mode?: 'native' | 'tab'
  tabId?: number
  appUrl: string
}

async function getAppUrl(): Promise<string> {
  const stored = await api.storage.local.get(APP_URL_KEY)
  const value = stored[APP_URL_KEY]
  const url = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_APP_URL
  return url.replace(/\/+$/, '')
}

async function findAppTab(appUrl: string): Promise<chrome.tabs.Tab | undefined> {
  // Le filtre `url` s’appuie sur la permission d’hôte de l’application, ce qui
  // évite d’accorder la permission `tabs` (accès aux URL de tous les onglets).
  const tabs = await api.tabs.query({ url: [`${appUrl}/*`] })
  return tabs[0]
}

async function readTabStatus(): Promise<AppStatus> {
  const appUrl = await getAppUrl()
  const tab = await findAppTab(appUrl)
  if (!tab?.id) return { appOpen: false, unlocked: false, appUrl, mode: 'tab' }

  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const bridge = (
          window as unknown as { __coffreExtension?: { version?: number } }
        ).__coffreExtension
        return bridge?.version ?? 0
      },
    })
    return {
      appOpen: true,
      unlocked: Number(result?.result) > 0,
      tabId: tab.id,
      appUrl,
      mode: 'tab',
    }
  } catch {
    return { appOpen: true, unlocked: false, tabId: tab.id, appUrl, mode: 'tab' }
  }
}

/**
 * Le pont natif est prioritaire : il ne dépend pas d’un onglet Coffre ouvert.
 * L’onglet Web reste le repli lorsque l’application desktop ne répond pas.
 */
async function hasHostAccess(): Promise<boolean> {
  try {
    return await api.permissions.contains({
      origins: ['http://*/*', 'https://*/*'],
    })
  } catch {
    return false
  }
}

const CONTENT_SCRIPT_ID = 'coffre-inline'
const WEBAUTHN_SCRIPT_ID = 'coffre-webauthn-main'

/**
 * Le content script n’est enregistré qu’après autorisation explicite des hôtes.
 * Il est ainsi absent des pages tant que l’utilisateur n’a pas activé le menu
 * dans les champs. L’interception WebAuthn suit la même permission et tourne
 * dans le monde de la page, à `document_start`, sans accès aux clés.
 */
async function syncContentScriptRegistration(): Promise<void> {
  let registered: Array<{ id: string }> = []
  try {
    registered = await api.scripting.getRegisteredContentScripts()
  } catch {
    // Firefox ou un navigateur sans scripting dynamique.
    return
  }
  const allowed = await hasHostAccess()
  const hasContent = registered.some((script) => script.id === CONTENT_SCRIPT_ID)
  const hasWebauthn = registered.some(
    (script) => script.id === WEBAUTHN_SCRIPT_ID,
  )

  if (!allowed) {
    const ids = [
      ...(hasContent ? [CONTENT_SCRIPT_ID] : []),
      ...(hasWebauthn ? [WEBAUTHN_SCRIPT_ID] : []),
    ]
    if (ids.length > 0) {
      try {
        await api.scripting.unregisterContentScripts({ ids })
      } catch {
        // Déjà retiré par le navigateur.
      }
    }
    return
  }

  if (!hasContent) {
    try {
      await api.scripting.registerContentScripts([
        {
          id: CONTENT_SCRIPT_ID,
          matches: ['http://*/*', 'https://*/*'],
          js: ['content.js'],
          runAt: 'document_idle',
          allFrames: true,
          persistAcrossSessions: true,
        },
      ])
    } catch {
      // Le remplissage au clic reste disponible depuis le popup.
    }
  }

  if (!hasWebauthn) {
    try {
      await api.scripting.registerContentScripts([
        {
          id: WEBAUTHN_SCRIPT_ID,
          matches: ['http://*/*', 'https://*/*'],
          js: ['webauthn-main.js'],
          runAt: 'document_start',
          allFrames: true,
          persistAcrossSessions: true,
          world: 'MAIN',
        },
      ])
    } catch {
      // Pas de monde MAIN : le content script injecte le script en repli.
    }
  }
}

void syncContentScriptRegistration()
void updateActionBadge()

async function readStatus(): Promise<AppStatus> {
  const hostAccess = await hasHostAccess()
  const native = await nativeStatus()
  if (native) {
    return {
      appOpen: true,
      unlocked: native.unlocked,
      paired: native.paired,
      hostAccess,
      mode: 'native',
      appUrl: '',
    }
  }
  return { ...(await readTabStatus()), hostAccess }
}

async function requireNativeCredentials(
  status: AppStatus,
  itemId: string,
  host: string,
): Promise<{ credentials?: ExtensionCredentials | null; error?: string }> {
  if (!status.paired) return { error: 'needs-pairing' }
  if (!status.unlocked) return { error: 'locked' }
  if (!host) return { error: 'domain-mismatch' }
  const result = await nativeFill(itemId, host)
  if (result.error) return { error: result.error }
  return {
    credentials: (result.credentials as ExtensionCredentials | null) ?? null,
  }
}

async function search(query: string): Promise<{
  items?: ExtensionLoginSummary[]
  error?: string
}> {
  const status = await readStatus()
  if (status.mode === 'native') {
    if (!status.paired) return { error: 'needs-pairing' }
    if (!status.unlocked) return { error: 'locked' }
    const result = await nativeSearch(query)
    return {
      items: (result.items as ExtensionLoginSummary[] | undefined) ?? [],
      error: result.error,
    }
  }
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }

  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: async (value: string) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              search: (query: string) => Promise<ExtensionLoginSummary[]>
            }
          }
        ).__coffreExtension
        if (!bridge) return []
        return bridge.search(value)
      },
      args: [query],
    })
    return { items: (result?.result as ExtensionLoginSummary[] | undefined) ?? [] }
  } catch {
    return { error: 'permission' }
  }
}

async function credentialsFromTab(
  status: AppStatus,
  itemId: string,
  host: string,
): Promise<{ credentials?: ExtensionCredentials | null; error?: string }> {
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }

  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: async (id: string, pageHost: string) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              fill: (
                itemId: string,
                host?: string,
              ) => Promise<ExtensionCredentials | null>
            }
          }
        ).__coffreExtension
        if (!bridge) return null
        return bridge.fill(id, pageHost)
      },
      args: [itemId, host],
    })
    return {
      credentials: (result?.result as ExtensionCredentials | null | undefined) ?? null,
    }
  } catch {
    return { error: 'permission' }
  }
}

async function injectCredentials(
  targetId: number,
  data: ExtensionCredentials,
): Promise<{ ok?: boolean; filled?: number; error?: string }> {
  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: targetId },
      func: (values: { username: string; password: string; totp: string }) => {
        const visible = (element: Element): boolean => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element as HTMLElement)
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none'
          )
        }

        const setValue = (input: HTMLInputElement, value: string) => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          )?.set
          setter?.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }

        const password = Array.from(
          document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
        ).find(visible)

        let username: HTMLInputElement | undefined
        if (password) {
          const scope = password.closest('form') ?? document
          const candidates = Array.from(
            scope.querySelectorAll<HTMLInputElement>('input'),
          ).filter(
            (input) =>
              input !== password &&
              visible(input) &&
              ['text', 'email', 'tel', ''].includes(input.type),
          )
          username =
            candidates.find((input) =>
              /user|email|login|ident|mail/i.test(
                `${input.name} ${input.id} ${input.autocomplete}`,
              ),
            ) ?? candidates[0]
        } else {
          username = Array.from(
            document.querySelectorAll<HTMLInputElement>(
              'input[type="text"], input[type="email"]',
            ),
          ).find(visible)
        }

        let filled = 0
        if (username && values.username) {
          setValue(username, values.username)
          filled += 1
        }
        if (password && values.password) {
          setValue(password, values.password)
          filled += 1
        }
        if (values.totp) {
          const otp = Array.from(
            document.querySelectorAll<HTMLInputElement>(
              'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="totp" i], input[id*="otp" i]',
            ),
          ).find(visible)
          if (otp) {
            setValue(otp, values.totp)
            filled += 1
          }
        }

        if (filled > 0) {
          const focusTarget = password ?? username
          focusTarget?.focus()
        }
        return { filled }
      },
      args: [
        {
          username: data.username,
          password: data.password,
          totp: data.totp,
        },
      ],
    })
    const filled = Number(
      (result?.result as { filled?: number } | undefined)?.filled ?? 0,
    )
    return filled > 0 ? { ok: true, filled } : { error: 'no-fields' }
  } catch {
    return { error: 'no-tab' }
  }
}

async function fill(
  itemId: string,
  tabId: number | undefined,
): Promise<{ ok?: boolean; filled?: number; error?: string }> {
  let targetId = tabId
  if (!targetId) {
    const [active] = await api.tabs.query({ active: true, currentWindow: true })
    targetId = active?.id
  }
  if (!targetId) return { error: 'no-tab' }

  let host = ''
  try {
    const tab = await api.tabs.get(targetId)
    host = tab.url ? hostFromUrl(tab.url) : ''
  } catch {
    host = ''
  }

  const status = await readStatus()
  const fetched =
    status.mode === 'native'
      ? await requireNativeCredentials(status, itemId, host)
      : await credentialsFromTab(status, itemId, host)
  if (fetched.error) return { error: fetched.error }
  const data = fetched.credentials
  if (!data) return { error: 'not-found' }

  return injectCredentials(targetId, data)
}

interface PendingSave {
  host: string
  username: string
  password: string
  url: string
  expires: number
  timer: number
}

const recentSelections = new Map<
  number,
  { itemId: string; host: string; expires: number }
>()
const pendingSaves = new Map<string, PendingSave>()
const latestPendingByTab = new Map<number, string>()

async function updateActionBadge(): Promise<void> {
  try {
    await api.action.setBadgeBackgroundColor({ color: '#d97706' })
    await api.action.setBadgeText({
      text: pendingSaves.size > 0 ? '●' : '',
    })
  } catch {
    // Certains navigateurs ne supportent pas le badge : le popup reste usable.
  }
}

function clearPendingSave(key: string): void {
  const pending = pendingSaves.get(key)
  if (pending) clearTimeout(pending.timer)
  pendingSaves.delete(key)
  const tabId = Number(key.split(':')[0])
  if (latestPendingByTab.get(tabId) === key) latestPendingByTab.delete(tabId)
  void updateActionBadge()
}

function latestPendingForTab(tabId: number): string | null {
  const key = latestPendingByTab.get(tabId)
  if (!key) return null
  const pending = pendingSaves.get(key)
  if (!pending || pending.expires < Date.now()) {
    clearPendingSave(key)
    return null
  }
  return key
}

function saveKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`
}

function validTabFrame(tabId: unknown, frameId: unknown): boolean {
  return (
    Number.isInteger(tabId) &&
    Number.isInteger(frameId) &&
    (tabId as number) >= 0 &&
    (frameId as number) >= 0
  )
}

async function fetchCredentials(
  itemId: string,
  host: string,
  status: AppStatus,
): Promise<{ credentials?: ExtensionCredentials | null; error?: string }> {
  if (status.mode === 'native') {
    return requireNativeCredentials(status, itemId, host)
  }
  return credentialsFromTab(status, itemId, host)
}

async function menuSearch(
  tabId: number,
  host: string,
  query: string,
): Promise<{ items?: ExtensionLoginSummary[]; error?: string; recentId?: string }> {
  const result = await search(query.trim() || host)
  if (result.error) return { error: result.error }
  const recent = recentSelections.get(tabId)
  const recentId =
    recent &&
    recent.expires > Date.now() &&
    (recent.host === host || hostMatches(recent.host, host))
      ? recent.itemId
      : undefined
  return { items: result.items ?? [], recentId }
}

async function menuFill(
  tabId: number,
  frameId: number,
  host: string,
  itemId: string,
): Promise<{ ok?: boolean; error?: string }> {
  if (!validTabFrame(tabId, frameId) || !host || !itemId) {
    return { error: 'invalid' }
  }
  const status = await readStatus()
  const fetched = await fetchCredentials(itemId, host, status)
  if (fetched.error) return { error: fetched.error }
  const credentials = fetched.credentials
  if (!credentials) return { error: 'not-found' }

  try {
    const response = (await api.tabs.sendMessage(
      tabId,
      {
        type: 'COFFRE_FILL_CREDENTIALS',
        host,
        credentials: {
          username: credentials.username,
          password: credentials.password,
          totp: credentials.totp,
        },
      },
      { frameId },
    )) as { ok?: boolean; error?: string } | undefined
    if (!response?.ok) {
      return { error: response?.error ?? 'no-fields' }
    }
    recentSelections.set(tabId, {
      itemId,
      host,
      expires: Date.now() + 120_000,
    })
    return { ok: true }
  } catch {
    return { error: 'no-tab' }
  }
}

function setPendingSave(
  key: string,
  pending: Omit<PendingSave, 'expires' | 'timer'>,
): void {
  clearPendingSave(key)
  const expires = Date.now() + 120_000
  const timer = setTimeout(() => {
    clearPendingSave(key)
  }, 120_000)
  pendingSaves.set(key, { ...pending, expires, timer })
  const tabId = Number(key.split(':')[0])
  latestPendingByTab.set(tabId, key)
  void updateActionBadge()
}

async function formSubmitted(
  sender: chrome.runtime.MessageSender,
  message: ExtensionMessage,
): Promise<{ prompt: boolean; error?: string }> {
  const tabId = sender.tab?.id
  const frameId = sender.frameId
  if (!Number.isInteger(tabId) || !Number.isInteger(frameId)) {
    return { prompt: false, error: 'invalid' }
  }
  const host =
    typeof message.host === 'string'
      ? hostFromUrl(message.host) || message.host.trim().toLowerCase()
      : ''
  const username = typeof message.username === 'string' ? message.username : ''
  const password = typeof message.password === 'string' ? message.password : ''
  if (!host || !password) return { prompt: false }

  const status = await readStatus()
  const canSave =
    status.mode === 'native'
      ? Boolean(status.paired && status.unlocked)
      : Boolean(status.appOpen && status.unlocked)
  if (!canSave) return { prompt: false }

  setPendingSave(saveKey(tabId as number, frameId as number), {
    host,
    username,
    password,
    url: typeof message.url === 'string' ? message.url : '',
  })
  return { prompt: true }
}

async function saveCredentials(
  input: { host: string; username: string; password: string },
): Promise<{ ok?: boolean; updated?: boolean; itemId?: string; error?: string }> {
  const status = await readStatus()
  if (status.mode === 'native') {
    if (!status.paired) return { error: 'needs-pairing' }
    if (!status.unlocked) return { error: 'locked' }
    return nativeSaveLogin(input)
  }
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }

  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: async (values: {
        host: string
        username: string
        password: string
        title: string
      }) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              saveLogin?: (input: {
                host: string
                username: string
                password: string
                title?: string
              }) => Promise<{ id: string; updated: boolean } | null>
            }
          }
        ).__coffreExtension
        if (!bridge?.saveLogin) return null
        return bridge.saveLogin(values)
      },
      args: [{ ...input, title: input.host }],
    })
    const saved = result?.result as
      | { id: string; updated: boolean }
      | null
      | undefined
    if (!saved) return { error: 'save-failed' }
    return { ok: true, updated: saved.updated, itemId: saved.id }
  } catch {
    return { error: 'permission' }
  }
}

async function menuSave(
  tabId: number,
  frameId: number,
): Promise<{ ok?: boolean; updated?: boolean; error?: string }> {
  if (!validTabFrame(tabId, frameId)) return { error: 'invalid' }
  const key = saveKey(tabId, frameId)
  const pending = pendingSaves.get(key)
  if (!pending || pending.expires < Date.now()) {
    pendingSaves.delete(key)
    return { error: 'no-pending' }
  }
  const result = await saveCredentials({
    host: pending.host,
    username: pending.username,
    password: pending.password,
  })
  if (result.ok) {
    clearPendingSave(key)
  }
  return result
}

type PasskeyKind = 'create' | 'get'
type PasskeyDecision = 'approve' | 'decline' | 'timeout' | 'confirmation-failed'

interface PendingPasskeyRequest {
  id: string
  kind: PasskeyKind
  tabId: number
  frameId: number
  host: string
  origin: string
  rpId: string
  userName: string
  challenge: string
  allowCredentials: string[]
  excludeCredentials: string[]
  windowId?: number
  timer?: ReturnType<typeof setTimeout>
  keepAlive?: ReturnType<typeof setInterval>
  resolve: (decision: PasskeyDecision) => void
}

const pendingPasskeys = new Map<string, PendingPasskeyRequest>()
const PASSKEY_REQUEST_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const PASSKEY_TIMEOUT_MS = 120_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function validPasskeyRpId(rpId: string, origin: string): boolean {
  try {
    return isValidRpId(rpId, origin)
  } catch {
    return false
  }
}

function credentialIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' &&
        entry.length > 0 &&
        entry.length <= 1024 &&
        BASE64URL_PATTERN.test(entry),
    )
    .slice(0, 50)
}

function requestOrigin(sender: chrome.runtime.MessageSender): string {
  const raw = sender.url ?? sender.tab?.url ?? ''
  try {
    return new URL(raw).origin
  } catch {
    return ''
  }
}

function isPasskeyPage(sender: chrome.runtime.MessageSender): boolean {
  const page = api.runtime.getURL('passkey.html')
  return (
    typeof sender.url === 'string' &&
    (sender.url === page || sender.url.startsWith(`${page}?`))
  )
}

function closePasskeyWindow(request: PendingPasskeyRequest): void {
  if (typeof request.windowId === 'number') {
    void api.windows.remove(request.windowId).catch(() => undefined)
  }
}

function decidePasskey(id: string, decision: PasskeyDecision): boolean {
  const request = pendingPasskeys.get(id)
  if (!request) return false
  pendingPasskeys.delete(id)
  if (request.timer) clearTimeout(request.timer)
  if (request.keepAlive) clearInterval(request.keepAlive)
  closePasskeyWindow(request)
  request.resolve(decision)
  return true
}

async function requestPasskeyApproval(
  request: PendingPasskeyRequest,
): Promise<PasskeyDecision> {
  return new Promise((resolve) => {
    request.resolve = resolve
    pendingPasskeys.set(request.id, request)
    request.timer = setTimeout(
      () => decidePasskey(request.id, 'timeout'),
      PASSKEY_TIMEOUT_MS,
    )
    // Une fenêtre de confirmation laisse le service worker inactif : ce petit
    // appel périodique évite qu’il soit suspendu avant la décision.
    request.keepAlive = setInterval(() => {
      void api.storage.local.get('coffre-passkey-keepalive').catch(() => undefined)
    }, 20_000)

    void (async () => {
      try {
        const created = await api.windows.create({
          url: `${api.runtime.getURL('passkey.html')}?id=${encodeURIComponent(
            request.id,
          )}`,
          type: 'popup',
          width: 430,
          height: 560,
          focused: true,
        })
        const entry = pendingPasskeys.get(request.id)
        if (!entry) {
          if (typeof created?.id === 'number') {
            void api.windows.remove(created.id).catch(() => undefined)
          }
          return
        }
        entry.windowId = created?.id
        if (typeof created?.id !== 'number') {
          decidePasskey(request.id, 'confirmation-failed')
        }
      } catch {
        decidePasskey(request.id, 'confirmation-failed')
      }
    })()
  })
}

async function passkeyCreateFromTab(
  status: AppStatus,
  input: ExtensionPasskeyCreateInput,
): Promise<{ result?: ExtensionPasskeyCreateResult; error?: string }> {
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }
  try {
    const [injected] = await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: async (values: ExtensionPasskeyCreateInput) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              passkeyCreate?: (
                input: ExtensionPasskeyCreateInput,
              ) => Promise<ExtensionPasskeyCreateResult | null>
            }
          }
        ).__coffreExtension
        if (!bridge?.passkeyCreate) return null
        return bridge.passkeyCreate(values)
      },
      args: [input],
    })
    const result = injected?.result as
      | ExtensionPasskeyCreateResult
      | null
      | undefined
    return result ? { result } : { error: 'passkey-failed' }
  } catch {
    return { error: 'permission' }
  }
}

async function passkeyGetFromTab(
  status: AppStatus,
  input: ExtensionPasskeyGetInput,
): Promise<{ result?: ExtensionPasskeyGetResult | null; error?: string }> {
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }
  try {
    const [injected] = await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: async (values: ExtensionPasskeyGetInput) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              passkeyGet?: (
                input: ExtensionPasskeyGetInput,
              ) => Promise<ExtensionPasskeyGetResult | null>
            }
          }
        ).__coffreExtension
        if (!bridge?.passkeyGet) return null
        return bridge.passkeyGet(values)
      },
      args: [input],
    })
    const result = injected?.result as
      | ExtensionPasskeyGetResult
      | null
      | undefined
    return result === null || result === undefined
      ? { result: null }
      : { result }
  } catch {
    return { error: 'permission' }
  }
}

async function passkeyRequest(
  sender: chrome.runtime.MessageSender,
  message: ExtensionMessage,
): Promise<unknown> {
  const context = await contentContext(sender)
  if (!context) return { error: 'invalid' }
  const kind =
    message.kind === 'create' || message.kind === 'get' ? message.kind : null
  const requestId =
    typeof message.requestId === 'string' ? message.requestId : ''
  if (!kind || !PASSKEY_REQUEST_PATTERN.test(requestId)) {
    return { error: 'invalid' }
  }
  if (
    [...pendingPasskeys.values()].some(
      (entry) =>
        entry.tabId === context.tabId && entry.frameId === context.frameId,
    )
  ) {
    return { error: 'busy' }
  }

  const payload = isRecord(message.payload) ? message.payload : null
  if (!payload) return { error: 'invalid' }
  const rpId =
    typeof payload.rpId === 'string' ? payload.rpId.trim().toLowerCase() : ''
  const challenge =
    typeof payload.challenge === 'string' ? payload.challenge : ''
  if (
    !rpId ||
    rpId.length > 253 ||
    !challenge ||
    challenge.length > 2048 ||
    !BASE64URL_PATTERN.test(challenge)
  ) {
    return { error: 'invalid' }
  }

  const origin = requestOrigin(sender)
  if (!origin || !validPasskeyRpId(rpId, origin)) {
    return { error: 'invalid-rp' }
  }

  const status = await readStatus()
  if (status.mode === 'native') {
    if (!status.paired) return { error: 'needs-pairing' }
    if (!status.unlocked) return { error: 'locked' }
  } else {
    if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
    if (!status.unlocked) return { error: 'locked' }
  }

  const userName =
    typeof payload.userName === 'string'
      ? payload.userName.trim().slice(0, 500)
      : ''
  const userHandle =
    typeof payload.userHandle === 'string' &&
    payload.userHandle.length <= 500 &&
    BASE64URL_PATTERN.test(payload.userHandle)
      ? payload.userHandle
      : ''
  const allowCredentials = credentialIdList(payload.allowCredentials)
  const excludeCredentials = credentialIdList(payload.excludeCredentials)

  const request: PendingPasskeyRequest = {
    id: requestId,
    kind,
    tabId: context.tabId,
    frameId: context.frameId,
    host: context.host,
    origin,
    rpId,
    userName,
    challenge,
    allowCredentials,
    excludeCredentials,
    resolve: () => undefined,
  }

  const decision = await requestPasskeyApproval(request)
  if (decision === 'decline') return { fallback: true }
  if (decision === 'timeout' || decision === 'confirmation-failed') {
    return { fallback: true }
  }

  if (kind === 'create') {
    const input: ExtensionPasskeyCreateInput = {
      rpId,
      origin,
      challenge,
      userName,
      userHandle: userHandle || undefined,
      excludeCredentials,
    }
    const response =
      status.mode === 'native'
        ? await nativePasskeyCreate(input)
        : await passkeyCreateFromTab(status, input)
    if (response.error) return { error: response.error }
    if (!response.result) return { error: 'passkey-failed' }
    return { result: response.result }
  }

  const input: ExtensionPasskeyGetInput = {
    rpId,
    origin,
    challenge,
    allowCredentials,
  }
  const response =
    status.mode === 'native'
      ? await nativePasskeyGet(input)
      : await passkeyGetFromTab(status, input)
  if (response.error) return { error: response.error }
  if (response.result === null || response.result === undefined) {
    return { fallback: true }
  }
  return { result: response.result }
}

async function contentContext(
  sender: chrome.runtime.MessageSender,
): Promise<{ tabId: number; frameId: number; host: string } | null> {
  const tabId = sender.tab?.id
  const frameId = sender.frameId
  if (!Number.isInteger(tabId) || !Number.isInteger(frameId)) return null
  const url = sender.url ?? sender.tab?.url ?? ''
  const host = hostFromUrl(url)
  if (!host) return null
  return { tabId: tabId as number, frameId: frameId as number, host }
}

async function openApp(): Promise<{ ok: boolean }> {
  const native = await nativeStatus()
  if (native) {
    await nativeFocus()
    return { ok: true }
  }
  const appUrl = await getAppUrl()
  const tab = await findAppTab(appUrl)
  if (tab?.id) {
    await api.tabs.update(tab.id, { active: true })
    if (typeof tab.windowId === 'number') {
      await api.windows.update(tab.windowId, { focused: true })
    }
    return { ok: true }
  }
  await api.tabs.create({ url: appUrl })
  return { ok: true }
}

async function handle(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'GET_STATUS':
      return readStatus()
    case 'SEARCH':
      return search(message.query ?? '')
    case 'FILL':
      return fill(message.itemId ?? '', message.tabId)
    case 'OPEN_APP':
    case 'FOCUS_APP':
      return openApp()
    case 'PAIR':
      return nativePair()
    case 'ENABLE_INLINE':
      await syncContentScriptRegistration()
      return { ok: true, hostAccess: await hasHostAccess() }
    case 'CONTENT_CONTEXT':
      return contentContext(sender)
    case 'PASSKEY_REQUEST':
      return passkeyRequest(sender, message)
    case 'PASSKEY_CANCEL': {
      if (!(await contentContext(sender))) return { error: 'invalid' }
      const id =
        typeof message.requestId === 'string' ? message.requestId : ''
      if (!PASSKEY_REQUEST_PATTERN.test(id)) return { error: 'invalid' }
      decidePasskey(id, 'decline')
      return { ok: true }
    }
    case 'GET_PASSKEY_REQUEST': {
      if (!isPasskeyPage(sender)) return { error: 'forbidden' }
      const id =
        typeof message.requestId === 'string' ? message.requestId : ''
      const pending = pendingPasskeys.get(id)
      if (!pending) return { error: 'expired' }
      return {
        request: {
          kind: pending.kind,
          host: pending.host,
          rpId: pending.rpId,
          userName: pending.userName,
          credentialCount: pending.allowCredentials.length,
        },
      }
    }
    case 'PASSKEY_DECISION': {
      if (!isPasskeyPage(sender)) return { error: 'forbidden' }
      const id =
        typeof message.requestId === 'string' ? message.requestId : ''
      const decision =
        message.decision === 'approve' || message.decision === 'decline'
          ? message.decision
          : null
      if (!decision || !PASSKEY_REQUEST_PATTERN.test(id)) {
        return { error: 'invalid' }
      }
      return decidePasskey(id, decision)
        ? { ok: true }
        : { error: 'expired' }
    }
    case 'MENU_SEARCH':
      return menuSearch(
        Number(message.tabId),
        message.host ?? '',
        message.query ?? '',
      )
    case 'MENU_FILL':
      return menuFill(
        Number(message.tabId),
        Number(message.frameId),
        message.host ?? '',
        message.itemId ?? '',
      )
    case 'FORM_SUBMITTED':
      return formSubmitted(sender, message)
    case 'SAVE_STATUS': {
      const key = saveKey(Number(message.tabId), Number(message.frameId))
      const pending = pendingSaves.get(key)
      if (!pending || pending.expires < Date.now()) {
        pendingSaves.delete(key)
        return { pending: null }
      }
      return {
        pending: { username: pending.username, host: pending.host },
      }
    }
    case 'SAVE_NOW':
      return menuSave(Number(message.tabId), Number(message.frameId))
    case 'GET_PENDING_SAVE': {
      const tabId = Number(message.tabId)
      const key = latestPendingForTab(tabId)
      if (!key) return { pending: null }
      const pending = pendingSaves.get(key)
      if (!pending) return { pending: null }
      return {
        pending: {
          username: pending.username,
          host: pending.host,
          tabId,
          frameId: Number(key.split(':')[1]),
        },
      }
    }
    case 'SAVE_PENDING_NOW': {
      const tabId = Number(message.tabId)
      const key = latestPendingForTab(tabId)
      if (!key) return { error: 'no-pending' }
      return menuSave(
        Number(key.split(':')[0]),
        Number(key.split(':')[1]),
      )
    }
    case 'SAVE_DISMISS': {
      const key = saveKey(Number(message.tabId), Number(message.frameId))
      clearPendingSave(key)
      return { ok: true }
    }
    case 'SAVE_DISMISS_PENDING': {
      const key = latestPendingForTab(Number(message.tabId))
      if (key) clearPendingSave(key)
      return { ok: true }
    }
    case 'GET_APP_URL':
      return { appUrl: await getAppUrl() }
    case 'SET_APP_URL': {
      const value = (message.appUrl ?? '').trim().replace(/\/+$/, '')
      if (!/^https?:\/\/[^/\s]+$/i.test(value)) {
        return { error: 'invalid-url' }
      }
      await api.storage.local.set({ [APP_URL_KEY]: value })
      return { ok: true, appUrl: value }
    }
    default:
      return { error: 'unknown-message' }
  }
}

api.windows.onRemoved.addListener((windowId) => {
  for (const request of [...pendingPasskeys.values()]) {
    if (request.windowId === windowId) decidePasskey(request.id, 'decline')
  }
})

api.tabs.onRemoved.addListener((tabId) => {
  for (const request of [...pendingPasskeys.values()]) {
    if (request.tabId === tabId) decidePasskey(request.id, 'decline')
  }
})

api.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    // Seules nos propres pages (popup, options, service worker) peuvent
    // demander des identifiants ; aucun content script n’est exposé.
    if (sender.id !== api.runtime.id) return
    void handle(message, sender)
      .then((result) => sendResponse(result))
      .catch((error: unknown) =>
        sendResponse({
          error: error instanceof Error ? error.message : 'unknown-error',
        }),
      )
    return true
  },
)
