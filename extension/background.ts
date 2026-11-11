import type {
  ExtensionAutofillKind,
  ExtensionAutofillSummary,
  ExtensionCardSaveInput,
  ExtensionCredentials,
  ExtensionFillValues,
  ExtensionIdentitySaveInput,
  ExtensionLoginSummary,
  ExtensionPasskeyCreateInput,
  ExtensionPasskeyCreateResult,
  ExtensionPasskeyGetInput,
  ExtensionPasskeyGetResult,
} from '../src/lib/extensionProtocol'
import {
  hostFromUrl,
  hostMatches,
  pageServiceFromUrl,
} from '../src/lib/extensionProtocol'
import type {
  PhishingAssessment,
  PhishingQuery,
} from '../src/lib/phishing'
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
} from '../src/lib/password'
import { isValidRpId } from '../src/lib/passkeys'
import { badgeText } from './badge'
import {
  matchingLoginSummaries,
  totpLoginSummary,
} from './commandHelpers'
import {
  buildContextMenuModel,
  type ContextMenuEntry,
} from './contextMenuModel'
import { t } from './i18n'
import {
  loadSettings,
  saveSettings,
  usesNativeBridge,
} from './settings'
import { isSiteExcluded, siteKey } from './siteExclusions'
import { submitLoginForm } from './loginSubmit'
import { saveBannerView } from './saveBannerState'
import {
  PendingSaveStore,
  RecentSelectionStore,
  type SessionStorageArea,
  type StoredPendingSave,
} from './sessionState'
import {
  nativeAssessHost,
  nativeCheckLogin,
  nativeFill,
  nativeFocus,
  nativePair,
  nativePasskeyCreate,
  nativePasskeyGet,
  nativeRecordGeneratedPassword,
  nativeRecordPhishingChoice,
  nativeSaveCard,
  nativeSaveIdentity,
  nativeSaveLogin,
  nativeSearch,
  nativeStatus,
  nativeUnlock,
} from './nativeBridge'

/** Firefox expose `browser` (promesses) ; Chrome expose `chrome`. */
const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

const DEFAULT_APP_URL = 'http://localhost:1420'
const APP_URL_KEY = 'appUrl'

/**
 * Service transmis à l’application pour la règle de domaines : l’origine de la
 * page (`schéma://hôte[:port]`) quand l’URL est connue et correspond à l’hôte,
 * sinon l’hôte seul. Sans schéma ni port, un élément `http://hôte:8080` ne
 * correspondrait jamais, et le refus HTTPS → HTTP serait sans effet.
 */
function serviceFor(host: string, url: string | undefined): string {
  const origin = url ? pageServiceFromUrl(url) : ''
  return origin && hostFromUrl(origin) === host ? origin : host
}

/**
 * `storage.session` est le seul stockage partagé qui accepte un secret en
 * transit : il reste en mémoire et disparaît à la fermeture du navigateur.
 * Un repli mémoire couvre les navigateurs qui ne l’exposent pas encore.
 */
class MemorySessionArea implements SessionStorageArea {
  private values = new Map<string, unknown>()

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null || keys === undefined) {
      return Object.fromEntries(this.values)
    }
    const wanted = Array.isArray(keys) ? keys : [keys]
    return Object.fromEntries(
      wanted
        .filter((key) => this.values.has(key))
        .map((key) => [key, this.values.get(key)]),
    )
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.values.set(key, value)
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.values.delete(key)
  }
}

function sessionStorageArea(): SessionStorageArea {
  try {
    const session = api.storage.session as SessionStorageArea | undefined
    if (session) return session
  } catch {
    // Firefox avant 115 ou navigateur sans stockage de session.
  }
  return new MemorySessionArea()
}

async function prepareSessionStorage(): Promise<void> {
  try {
    const session = api.storage.session as
      | (SessionStorageArea & {
          setAccessLevel?: (value: {
            accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
          }) => Promise<void>
        })
      | undefined
    await session?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  } catch {
    // Firefox expose storage.session sans setAccessLevel : l’accès reste
    // limité aux pages d’extension par le manifeste.
  }
}

const sessionReady = prepareSessionStorage()
const sessionStorage = sessionStorageArea()
const pendingSaveStore = new PendingSaveStore(
  sessionStorage,
  Date.now,
  sessionReady,
)
const recentSelectionStore = new RecentSelectionStore(
  sessionStorage,
  Date.now,
  sessionReady,
)

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
  command?: string
  menuItemId?: string
  excluded?: boolean
  kind?: string
  formKind?: string
  includeSensitive?: boolean
  overridePhishing?: boolean
  card?: Record<string, unknown>
  identity?: Record<string, unknown>
  requestId?: string
  offerId?: string
  payload?: unknown
  decision?: string
  signals?: string[]
  choice?: string
  token?: string
  topHost?: string
  mode?: string
}

interface AppStatus {
  appOpen: boolean
  unlocked: boolean
  paired?: boolean
  hostAccess?: boolean
  siteAccess?: boolean
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
async function grantedHostOrigins(): Promise<string[]> {
  try {
    const appUrl = await getAppUrl()
    const appPatterns = new Set([
      `${appUrl}/*`,
      'http://localhost:4173/*',
      'http://127.0.0.1:4173/*',
    ])
    const all = await api.permissions.getAll()
    return (all.origins ?? []).filter(
      (origin) => /^https?:\/\//i.test(origin) && !appPatterns.has(origin),
    )
  } catch {
    return []
  }
}

async function hasHostAccess(): Promise<boolean> {
  return (await grantedHostOrigins()).length > 0
}

async function hasSiteAccess(): Promise<boolean> {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true })
    const url = tab?.url ?? ''
    if (!/^https?:/i.test(url)) return false
    const origin = new URL(url).origin
    return await api.permissions.contains({ origins: [`${origin}/*`] })
  } catch {
    return false
  }
}

const CONTENT_SCRIPT_ID = 'coffre-inline'
const WEBAUTHN_SCRIPT_ID = 'coffre-webauthn-main'

/**
 * Le content script n’est enregistré que sur les hôtes explicitement
 * autorisés. Site par site ou tous les sites, la liste vient de
 * `permissions.getAll` : aucune permission d’hôte globale n’est supposée.
 * L’interception WebAuthn suit exactement les mêmes hôtes.
 */
async function syncContentScriptRegistration(): Promise<void> {
  let registered: Array<{ id: string }> = []
  try {
    registered = await api.scripting.getRegisteredContentScripts()
  } catch {
    // Firefox ou un navigateur sans scripting dynamique.
    return
  }
  const origins = await grantedHostOrigins()
  const existing = registered
    .filter(
      (script) =>
        script.id === CONTENT_SCRIPT_ID || script.id === WEBAUTHN_SCRIPT_ID,
    )
    .map((script) => script.id)
  if (existing.length > 0) {
    try {
      await api.scripting.unregisterContentScripts({ ids: existing })
    } catch {
      // Déjà retiré par le navigateur.
    }
  }
  if (origins.length === 0) return

  try {
    await api.scripting.registerContentScripts([
      {
        id: CONTENT_SCRIPT_ID,
        matches: origins,
        js: ['content.js'],
        runAt: 'document_idle',
        allFrames: true,
        persistAcrossSessions: true,
      },
    ])
  } catch {
    // Le remplissage au clic reste disponible depuis le popup.
  }

  try {
    await api.scripting.registerContentScripts([
      {
        id: WEBAUTHN_SCRIPT_ID,
        matches: origins,
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

void syncContentScriptRegistration()
void updateActionBadge()
// Le menu contextuel est construit au premier onglet activé : certains
// navigateurs n’aiment pas les appels à `contextMenus` avant la fin de
// l’initialisation du service worker.

async function readStatus(): Promise<AppStatus> {
  const settings = await loadSettings()
  const hostAccess = await hasHostAccess()
  const siteAccess = await hasSiteAccess()
  const native = usesNativeBridge(settings.appMode)
    ? await nativeStatus()
    : null
  let status: AppStatus
  if (native) {
    status = {
      appOpen: true,
      unlocked: native.unlocked,
      paired: native.paired,
      hostAccess,
      siteAccess,
      mode: 'native',
      appUrl: '',
    }
  } else {
    status = { ...(await readTabStatus()), hostAccess, siteAccess }
  }
  // Une proposition d’enregistrement ne survit pas au verrouillage du coffre :
  // le secret en transit n’a plus de raison d’être conservé.
  if (!status.unlocked) await clearSessionState()
  return status
}

async function recordGeneratedPassword(
  host: string,
  password: string,
): Promise<{ ok?: boolean; error?: string }> {
  if (!password || password.length > 1024) return { error: 'invalid' }
  const status = await readStatus()
  if (status.mode === 'native') {
    if (!status.paired) return { error: 'needs-pairing' }
    if (!status.unlocked) return { error: 'locked' }
    return nativeRecordGeneratedPassword({ password, host })
  }
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }
  try {
    await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: (value: { password: string; host: string }) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              recordGeneratedPassword?: (input: {
                password: string
                host?: string
              }) => Promise<void>
            }
          }
        ).__coffreExtension
        return bridge?.recordGeneratedPassword
          ? bridge.recordGeneratedPassword(value)
          : undefined
      },
      args: [{ password, host }],
    })
    return { ok: true }
  } catch {
    return { error: 'permission' }
  }
}

async function fillAllowedForHost(host: string): Promise<boolean> {
  if (!host) return false
  const settings = await loadSettings()
  return !isSiteExcluded(settings.neverFillSites, host)
}

async function saveAllowedForHost(host: string): Promise<boolean> {
  if (!host) return false
  const settings = await loadSettings()
  return !isSiteExcluded(settings.neverSaveSites, host)
}

async function requireNativeCredentials(
  status: AppStatus,
  itemId: string,
  host: string,
  kind: ExtensionAutofillKind = 'login',
  includeSensitive = false,
  allowMismatch = false,
): Promise<{ credentials?: ExtensionFillValues | null; error?: string }> {
  if (!status.paired) return { error: 'needs-pairing' }
  if (!status.unlocked) return { error: 'locked' }
  if (kind === 'login' && !host) return { error: 'domain-mismatch' }
  const result = await nativeFill(
    itemId,
    host,
    kind,
    includeSensitive,
    allowMismatch,
  )
  if (result.error) return { error: result.error }
  return {
    credentials: (result.credentials as ExtensionFillValues | null) ?? null,
  }
}

/**
 * Évalue l’hôte avant un remplissage forcé ou un enregistrement. La réponse ne
 * contient que des codes de signaux et, au plus, le domaine connu imité.
 */
async function assessHost(
  query: PhishingQuery,
): Promise<PhishingAssessment | null> {
  const status = await readStatus()
  if (status.mode === 'native') {
    if (!status.paired || !status.unlocked) return null
    const result = await nativeAssessHost(query)
    return (result.assessment as PhishingAssessment | null) ?? null
  }
  if (!status.appOpen || !status.tabId || !status.unlocked) return null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const [result] = await api.scripting.executeScript({
        target: { tabId: status.tabId },
        world: 'MAIN',
        func: (value: PhishingQuery) => {
          const bridge = (
            window as unknown as {
              __coffreExtension?: {
                assessHost?: (
                  input: PhishingQuery,
                ) => Promise<PhishingAssessment | null>
              }
            }
          ).__coffreExtension
          return bridge?.assessHost ? bridge.assessHost(value) : null
        },
        args: [query],
      })
      const assessment = (result?.result as PhishingAssessment | null) ?? null
      if (assessment) return assessment
    } catch {
      // La passerelle peut être recréée pendant une mutation : nouvel essai.
    }
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  return null
}

async function recordPhishingChoice(input: {
  host: string
  signals: string[]
  choice: 'cancel' | 'continue'
}): Promise<void> {
  const status = await readStatus()
  if (status.mode === 'native') {
    if (!status.paired || !status.unlocked) return
    await nativeRecordPhishingChoice(input).catch(() => undefined)
    return
  }
  if (!status.appOpen || !status.tabId || !status.unlocked) return
  try {
    await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: (value: typeof input) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              recordPhishingChoice?: (choice: typeof value) => Promise<void>
            }
          }
        ).__coffreExtension
        return bridge?.recordPhishingChoice
          ? bridge.recordPhishingChoice(value)
          : undefined
      },
      args: [input],
    })
  } catch {
    // Le journal est accessoire : le remplissage continue.
  }
}

async function search(
  query: string,
  kind: ExtensionAutofillKind = 'login',
): Promise<{ items?: ExtensionAutofillSummary[]; error?: string }> {
  const status = await readStatus()
  if (status.mode === 'native') {
    if (!status.paired) return { error: 'needs-pairing' }
    if (!status.unlocked) return { error: 'locked' }
    const result = await nativeSearch(query, kind)
    return {
      items: (result.items as ExtensionAutofillSummary[] | undefined) ?? [],
      error: result.error,
    }
  }
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }

  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: async (value: string, wanted: string) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              search: (query: string) => Promise<ExtensionLoginSummary[]>
              searchCards?: (query: string) => Promise<ExtensionAutofillSummary[]>
              searchIdentities?: (
                query: string,
              ) => Promise<ExtensionAutofillSummary[]>
              searchCustom?: (
                query: string,
              ) => Promise<ExtensionAutofillSummary[]>
            }
          }
        ).__coffreExtension
        if (!bridge) return []
        if (wanted === 'card' && bridge.searchCards) {
          return bridge.searchCards(value)
        }
        if (wanted === 'identity' && bridge.searchIdentities) {
          return bridge.searchIdentities(value)
        }
        if (wanted === 'custom' && bridge.searchCustom) {
          return bridge.searchCustom(value)
        }
        return bridge.search(value)
      },
      args: [query, kind],
    })
    return {
      items: (result?.result as ExtensionAutofillSummary[] | undefined) ?? [],
    }
  } catch {
    return { error: 'permission' }
  }
}

async function credentialsFromTab(
  status: AppStatus,
  itemId: string,
  host: string,
  kind: ExtensionAutofillKind = 'login',
  includeSensitive = false,
  allowMismatch = false,
): Promise<{ credentials?: ExtensionFillValues | null; error?: string }> {
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }

  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: async (
        id: string,
        pageHost: string,
        wanted: string,
        sensitive: boolean,
        mismatch: boolean,
      ) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              fill: (
                itemId: string,
                host?: string,
                options?: { allowMismatch?: boolean },
              ) => Promise<ExtensionCredentials | null>
              fillItem?: (
                itemId: string,
                options?: {
                  host?: string
                  includeSensitive?: boolean
                  allowMismatch?: boolean
                },
              ) => Promise<ExtensionFillValues | null>
              searchCustom?: (query: string) => Promise<ExtensionAutofillSummary[]>
              fillCustom?: (itemId: string) => Promise<ExtensionFillValues | null>
            }
          }
        ).__coffreExtension
        if (!bridge) return null
        if (wanted === 'custom' && bridge.fillCustom) {
          return bridge.fillCustom(id)
        }
        if (bridge.fillItem) {
          return bridge.fillItem(id, {
            host: pageHost,
            includeSensitive: sensitive,
            allowMismatch: mismatch,
          })
        }
        if (wanted !== 'login') return null
        const login = await bridge.fill(id, pageHost, { allowMismatch: mismatch })
        return login ? { kind: 'login', ...login } : null
      },
      args: [itemId, host, kind, includeSensitive, allowMismatch],
    })
    return {
      credentials: (result?.result as ExtensionFillValues | null | undefined) ?? null,
    }
  } catch {
    return { error: 'permission' }
  }
}

const TOTP_CLIPBOARD_TTL_MS = 30_000

/**
 * Copie le code TOTP dans le presse-papiers puis l’efface après 30 secondes
 * seulement si le contenu n’a pas changé. `clipboardRead` est réservée à ce
 * contrôle ; si la lecture échoue, le presse-papiers n’est jamais vidé.
 */
async function copyTotpToClipboard(
  tabId: number,
  code: string,
): Promise<boolean> {
  if (!code) return false
  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId },
      func: async (value: string, ttl: number) => {
        const write = async (text: string): Promise<boolean> => {
          try {
            await navigator.clipboard.writeText(text)
            return true
          } catch {
            // Repli pour les contextes sans API asynchrone.
          }
          try {
            const host = document.createElement('div')
            host.style.cssText =
              'position:fixed;left:-1000px;top:-1000px;width:1px;height:1px;opacity:0'
            const root = host.attachShadow({ mode: 'closed' })
            const area = document.createElement('textarea')
            area.value = text
            area.setAttribute('readonly', '')
            root.append(area)
            document.documentElement.append(host)
            area.select()
            const copied = document.execCommand('copy')
            host.remove()
            return copied
          } catch {
            return false
          }
        }
        const read = async (): Promise<string | null> => {
          try {
            return await navigator.clipboard.readText()
          } catch {
            return null
          }
        }
        if (!(await write(value))) return false
        window.setTimeout(() => {
          void (async () => {
            const current = await read()
            if (current === value) await write('')
          })()
        }, ttl)
        return true
      },
      args: [code, TOTP_CLIPBOARD_TTL_MS],
    })
    return result?.result === true
  } catch {
    return false
  }
}

async function maybeCopyTotp(tabId: number, code: string): Promise<void> {
  if (!code) return
  try {
    const settings = await loadSettings()
    if (!settings.copyTotpAfterFill) return
    await copyTotpToClipboard(tabId, code)
  } catch {
    // La copie ne doit jamais faire échouer le remplissage.
  }
}

async function injectCredentials(
  targetId: number,
  data: ExtensionCredentials,
  expectedService: string,
): Promise<{ ok?: boolean; filled?: number; error?: string }> {
  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: targetId },
      func: (
        values: { username: string; password: string; totp: string },
        expected: string,
      ) => {
        // L’onglet peut avoir navigué pendant la récupération asynchrone des
        // identifiants : vérifier l’origine dans le document cible empêche de
        // taper le secret dans un autre site.
        let expectedUrl: URL
        let currentUrl: URL
        try {
          expectedUrl = new URL(
            /^[a-z][a-z0-9+.-]*:/i.test(expected) ? expected : `https://${expected}`,
          )
          currentUrl = new URL(location.href)
        } catch {
          return { filled: 0, error: 'host-changed' }
        }
        if (
          expectedUrl.hostname.replace(/^www\./, '').toLowerCase() !==
            currentUrl.hostname.replace(/^www\./, '').toLowerCase() ||
          (expectedUrl.port && expectedUrl.port !== currentUrl.port)
        ) {
          return { filled: 0, error: 'host-changed' }
        }

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
        expectedService,
      ],
    })
    const injected = result?.result as
      | { filled?: number; error?: string }
      | undefined
    if (injected?.error) return { error: injected.error }
    const filled = Number(injected?.filled ?? 0)
    if (filled > 0) {
      await maybeCopyTotp(targetId, data.totp)
    }
    // La validation automatique n’a lieu que si l’utilisateur l’a activée.
    if (filled > 0 && (await loadSettings()).autoSubmitLogin) {
      try {
        await api.scripting.executeScript({
          target: { tabId: targetId },
          func: submitLoginForm,
        })
      } catch {
        // Le remplissage reste valide même si la validation automatique échoue.
      }
    }
    return filled > 0 ? { ok: true, filled } : { error: 'no-fields' }
  } catch {
    return { error: 'no-tab' }
  }
}

function flashActionBadge(): void {
  void api.action
    .setBadgeText({ text: '!' })
    .catch(() => undefined)
  setTimeout(() => void updateActionBadge(), 2_000)
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function pingContentScript(
  tabId: number,
  frameId = 0,
): Promise<boolean> {
  try {
    const response = (await api.tabs.sendMessage(
      tabId,
      { type: 'COFFRE_PING' },
      { frameId },
    )) as { ok?: boolean } | undefined
    return response?.ok === true
  } catch {
    return false
  }
}

/**
 * Les raccourcis et le menu contextuel accordent `activeTab` : le content
 * script peut être injecté à la demande sur un site qui n’a pas encore reçu la
 * permission durable.
 */
async function ensureContentScript(
  tabId: number,
  frameId = 0,
): Promise<boolean> {
  if (await pingContentScript(tabId, frameId)) return true
  try {
    await api.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ['content.js'],
    })
  } catch {
    return false
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    if (await pingContentScript(tabId, frameId)) return true
  }
  return false
}

async function openMenuInTab(
  tabId: number,
  kind: ExtensionAutofillKind,
  frameId = 0,
): Promise<boolean> {
  if (!(await ensureContentScript(tabId, frameId))) return false
  try {
    const response = (await api.tabs.sendMessage(
      tabId,
      { type: 'COFFRE_OPEN_MENU', kind },
      { frameId },
    )) as { ok?: boolean } | undefined
    return response?.ok === true
  } catch {
    return false
  }
}

async function commandFillLogin(): Promise<boolean> {
  const tab = await activeTab()
  if (!tab?.id) {
    flashActionBadge()
    return false
  }
  const host = tab.url ? hostFromUrl(tab.url) : ''
  if (!host || !(await fillAllowedForHost(host))) {
    flashActionBadge()
    return false
  }
  const status = await readStatus()
  if (!status.unlocked || (status.mode === 'native' && !status.paired)) {
    flashActionBadge()
    return false
  }
  const result = await search(host, 'login')
  if (result.error) {
    flashActionBadge()
    return false
  }
  const matches = matchingLoginSummaries(result.items ?? [], host)
  if (matches.length === 0) {
    flashActionBadge()
    return false
  }
  if (matches.length > 1) {
    if (await openMenuInTab(tab.id, 'login')) return true
    flashActionBadge()
    return false
  }
  const filled = await fill(matches[0].id, tab.id)
  if (filled.ok) return true
  flashActionBadge()
  return false
}

async function generateAndFillPassword(
  tabId: number,
  url: string,
  frameId = 0,
): Promise<boolean> {
  const host = url ? hostFromUrl(url) : ''
  if (!host || !(await fillAllowedForHost(host))) {
    flashActionBadge()
    return false
  }
  let password = ''
  try {
    const { generatePasswordForRules, passwordRulesForUrl } = await import(
      '../src/lib/passwordRules'
    )
    const site = url ? passwordRulesForUrl(url) : null
    password = site
      ? generatePasswordForRules(site.rules, DEFAULT_PASSWORD_OPTIONS.length)
      : generatePassword(DEFAULT_PASSWORD_OPTIONS)
  } catch {
    password = generatePassword(DEFAULT_PASSWORD_OPTIONS)
  }
  if (!(await ensureContentScript(tabId, frameId))) {
    flashActionBadge()
    return false
  }
  try {
    const response = (await api.tabs.sendMessage(
      tabId,
      { type: 'COFFRE_FILL_GENERATED', password },
      { frameId },
    )) as { ok?: boolean } | undefined
    if (response?.ok) {
      // Q3 : le mot de passe rempli reste retrouvable dans l’historique
      // chiffré du générateur si l’inscription n’est pas enregistrée.
      const host = url ? hostFromUrl(url) : ''
      void recordGeneratedPassword(host, password).catch(() => undefined)
      return true
    }
  } catch {
    // Le badge ci-dessous signale l’échec.
  }
  flashActionBadge()
  return false
}

async function commandGeneratePassword(): Promise<boolean> {
  const tab = await activeTab()
  if (!tab?.id) {
    flashActionBadge()
    return false
  }
  const host = tab.url ? hostFromUrl(tab.url) : ''
  if (!host || !(await fillAllowedForHost(host))) {
    flashActionBadge()
    return false
  }
  return generateAndFillPassword(tab.id, tab.url ?? '')
}

async function commandFillTotp(): Promise<boolean> {
  const tab = await activeTab()
  if (!tab?.id) {
    flashActionBadge()
    return false
  }
  const host = tab.url ? hostFromUrl(tab.url) : ''
  if (!host || !(await fillAllowedForHost(host))) {
    flashActionBadge()
    return false
  }
  const status = await readStatus()
  if (!status.unlocked || (status.mode === 'native' && !status.paired)) {
    flashActionBadge()
    return false
  }
  const result = await search(host, 'login')
  if (result.error) {
    flashActionBadge()
    return false
  }
  const match = totpLoginSummary(result.items ?? [], host)
  if (!match) {
    flashActionBadge()
    return false
  }
  const fetched = await fetchCredentials(
    match.id,
    serviceFor(host, tab.url),
    status,
  )
  if (fetched.error || !fetched.credentials) {
    flashActionBadge()
    return false
  }
  const credentials = fetched.credentials
  if (credentials.kind !== 'login' || !credentials.totp) {
    flashActionBadge()
    return false
  }
  if (!(await ensureContentScript(tab.id))) {
    flashActionBadge()
    return false
  }
  try {
    const response = (await api.tabs.sendMessage(tab.id, {
      type: 'COFFRE_FILL_TOTP',
      code: credentials.totp,
    })) as { ok?: boolean } | undefined
    if (response?.ok) return true
  } catch {
    // Le badge ci-dessous signale l’échec.
  }
  flashActionBadge()
  return false
}

async function handleCommand(command: string): Promise<boolean> {
  if (command === 'fill-login') return commandFillLogin()
  if (command === 'generate-password') return commandGeneratePassword()
  if (command === 'fill-totp') return commandFillTotp()
  return false
}

/**
 * Détails d’une connexion pour affichage/copie manuelle dans le popup ou le
 * menu inline. Le domaine est vérifié comme pour un remplissage : l’extension
 * ne peut pas révéler un identifiant enregistré pour un autre site.
 */
async function itemDetails(
  itemId: string,
  host: string,
  url = '',
): Promise<{ details?: ExtensionCredentials; error?: string }> {
  if (!itemId || !host) return { error: 'not-found' }
  // Sans URL complète, le refus HTTPS → HTTP et le port explicite ne peuvent
  // pas être vérifiés : on refuse plutôt que de copier un secret sur un site
  // non sécurisé.
  if (!url) return { error: 'missing-url' }

  const status = await readStatus()
  const fetched = await fetchCredentials(itemId, serviceFor(host, url), status)
  if (fetched.error) return { error: fetched.error }

  const credentials = fetched.credentials
  if (!credentials || credentials.kind !== 'login') {
    return { error: 'not-found' }
  }

  return {
    details: {
      id: credentials.id,
      title: credentials.title,
      username: credentials.username,
      password: credentials.password,
      totp: credentials.totp,
    },
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
    host = tab.url ? serviceFor(hostFromUrl(tab.url), tab.url) : ''
  } catch {
    host = ''
  }
  if (!(await fillAllowedForHost(host))) return { error: 'excluded' }

  const status = await readStatus()
  const fetched =
    status.mode === 'native'
      ? await requireNativeCredentials(status, itemId, host)
      : await credentialsFromTab(status, itemId, host)
  if (fetched.error) return { error: fetched.error }
  const data = fetched.credentials
  if (!data) return { error: 'not-found' }
  if (data.kind !== 'login') return { error: 'no-fields' }

  return injectCredentials(targetId, data, host)
}

let badgeTimer: ReturnType<typeof setTimeout> | undefined
let badgeUpdating = false
let badgeQueued = false

async function pendingSessionUnlocked(): Promise<boolean> {
  const status = await readStatus()
  if (!status.unlocked) await clearSessionState()
  return status.unlocked
}

function scheduleBadgeRefresh(entries: StoredPendingSave[]): void {
  if (badgeTimer) clearTimeout(badgeTimer)
  badgeTimer = undefined
  if (entries.length === 0) return
  const nextExpiry = Math.min(...entries.map((entry) => entry.expiresAt))
  badgeTimer = setTimeout(
    () => void updateActionBadge(),
    Math.max(1_000, nextExpiry - Date.now() + 250),
  )
}

async function badgeLoginCount(host: string): Promise<number> {
  const result = await search(host, 'login')
  return result.items?.length ?? 0
}

async function updateActionBadge(): Promise<void> {
  // `search` passe par `readStatus`, qui purge la session verrouillée et
  // rappelle cette fonction : le garde évite une récursion, et la demande
  // suivante est rejouée à la fin pour ne pas perdre un changement d’état.
  if (badgeUpdating) {
    badgeQueued = true
    return
  }
  badgeUpdating = true
  try {
    // Vérifier le verrouillage avant de lire les propositions : sinon une
    // proposition peut survivre en mémoire alors que le coffre est fermé.
    const status = await readStatus()
    const entries = status.unlocked ? await pendingSaveStore.list() : []
    scheduleBadgeRefresh(entries)
    if (entries.length > 0) {
      await api.action.setBadgeBackgroundColor({ color: '#d97706' })
      await api.action.setBadgeText({
        text: badgeText(entries.length, 0, false),
      })
      return
    }

    const settings = await loadSettings()
    const siteAccess = await hasSiteAccess()
    const unlocked = status.unlocked
    const [tab] = await api.tabs.query({ active: true, currentWindow: true })
    const host = tab?.url ? hostFromUrl(tab.url) : ''
    const allowed =
      unlocked &&
      siteAccess &&
      Boolean(host) &&
      !isSiteExcluded(settings.neverFillSites, host)
    const count = allowed ? await badgeLoginCount(host) : 0
    await api.action.setBadgeBackgroundColor({ color: '#3f3f46' })
    await api.action.setBadgeText({
      text: badgeText(0, count, allowed),
    })
  } catch {
    // Certains navigateurs ne supportent pas le badge : le popup reste usable.
  } finally {
    badgeUpdating = false
    if (badgeQueued) {
      badgeQueued = false
      void updateActionBadge()
    }
  }
}

async function clearPendingSave(key: string): Promise<void> {
  await pendingSaveStore.remove(key)
  await updateActionBadge()
}

async function latestPendingForTab(
  tabId: number,
): Promise<StoredPendingSave | null> {
  return pendingSaveStore.latestForTab(tabId)
}

async function clearSessionState(): Promise<void> {
  await Promise.all([
    pendingSaveStore.clear(),
    recentSelectionStore.clear(),
  ])
  await updateActionBadge()
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
  kind: ExtensionAutofillKind = 'login',
  includeSensitive = false,
  allowMismatch = false,
): Promise<{ credentials?: ExtensionFillValues | null; error?: string }> {
  if (status.mode === 'native') {
    return requireNativeCredentials(
      status,
      itemId,
      host,
      kind,
      includeSensitive,
      allowMismatch,
    )
  }
  return credentialsFromTab(
    status,
    itemId,
    host,
    kind,
    includeSensitive,
    allowMismatch,
  )
}

async function menuSearch(
  tabId: number,
  host: string,
  query: string,
  kind: ExtensionAutofillKind = 'login',
): Promise<{
  items?: ExtensionAutofillSummary[]
  error?: string
  recentId?: string
}> {
  const result = await search(query.trim() || host, kind)
  if (result.error) return { error: result.error }
  const recent = await recentSelectionStore.get(tabId)
  const recentId =
    kind === 'login' &&
    recent &&
    recent.expiresAt > Date.now() &&
    (recent.host === host || hostMatches(recent.host, host))
      ? recent.itemId
      : undefined
  return { items: result.items ?? [], recentId }
}

async function menuFill(
  tabId: number,
  frameId: number,
  host: string,
  pageUrl: string,
  itemId: string,
  kind: ExtensionAutofillKind = 'login',
  includeSensitive = false,
  overridePhishing = false,
): Promise<{
  ok?: boolean
  error?: string
  phishing?: PhishingAssessment
}> {
  if (!validTabFrame(tabId, frameId) || !host || !itemId) {
    return { error: 'invalid' }
  }
  if (!(await fillAllowedForHost(host))) return { error: 'excluded' }

  let url = pageUrl.slice(0, 2048)
  if (!url) {
    try {
      const tab = await api.tabs.get(tabId)
      url = tab.url ?? ''
    } catch {
      url = ''
    }
  }

  const assessment = await assessHost({
    host,
    url,
    mode: 'fill',
    itemId,
  })
  if (assessment && assessment.signals.length > 0) {
    if (!overridePhishing) {
      return { error: 'phishing-warning', phishing: assessment }
    }
    void recordPhishingChoice({
      host,
      signals: assessment.signals.map((signal) => signal.code),
      choice: 'continue',
    })
  }

  const status = await readStatus()
  const fetched = await fetchCredentials(
    itemId,
    serviceFor(host, url),
    status,
    kind,
    includeSensitive,
    Boolean(assessment && assessment.signals.length > 0 && overridePhishing),
  )
  if (fetched.error) return { error: fetched.error }
  const credentials = fetched.credentials
  if (!credentials) return { error: 'not-found' }

  try {
    const response = (await api.tabs.sendMessage(
      tabId,
      {
        type: 'COFFRE_FILL_ITEM',
        host,
        values: credentials,
      },
      { frameId },
    )) as { ok?: boolean; error?: string } | undefined
    if (!response?.ok) {
      return { error: response?.error ?? 'no-fields' }
    }
    if (kind === 'login') {
      await recentSelectionStore.set(tabId, itemId, host)
      if (credentials.kind === 'login') {
        await maybeCopyTotp(tabId, credentials.totp)
      }
    }
    return { ok: true }
  } catch {
    return { error: 'no-tab' }
  }
}

async function setPendingSave(
  key: string,
  pending: Omit<
    StoredPendingSave,
    'id' | 'key' | 'tabId' | 'frameId' | 'createdAt' | 'expiresAt'
  >,
): Promise<StoredPendingSave> {
  const [tabId, frameId] = key.split(':').map(Number)
  const saved = await pendingSaveStore.upsert({
    ...pending,
    key,
    tabId,
    frameId,
  })
  await updateActionBadge()
  return saved
}

function pendingText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

type LoginSaveState = 'same' | 'different' | 'missing'

/**
 * Repli pour les versions de l’application antérieures à `check-login` :
 * compare via la recherche et le remplissage existants, sans redéployer le
 * desktop ni dupliquer les secrets dans le service worker au-delà du contrôle.
 */
async function compareExistingLogin(
  status: AppStatus,
  service: string,
  username: string,
  password: string,
): Promise<LoginSaveState | null> {
  const host = hostFromUrl(service) || service
  const result = await search(host, 'login')
  if (result.error) return null
  const candidates = (result.items ?? []).filter(
    (item): item is ExtensionLoginSummary =>
      'username' in item &&
      'host' in item &&
      item.username.trim().toLowerCase() === username.trim().toLowerCase() &&
      hostMatches(item.host, host),
  )
  if (candidates.length === 0) return 'missing'

  let compared = false
  for (const candidate of candidates) {
    const fetched = await fetchCredentials(candidate.id, service, status)
    if (!fetched.credentials || fetched.credentials.kind !== 'login') continue
    compared = true
    if (fetched.credentials.password === password) return 'same'
  }
  return compared ? 'different' : null
}

async function loginSaveState(
  status: AppStatus,
  /** Origine de la page si connue (voir `serviceFor`), sinon l’hôte. */
  host: string,
  username: string,
  password: string,
): Promise<LoginSaveState | null> {
  if (status.mode === 'native') {
    if (!status.paired || !status.unlocked) return null
    const result = await nativeCheckLogin({ host, username, password })
    if (result.state) return result.state
    return compareExistingLogin(status, host, username, password)
  }
  if (!status.appOpen || !status.tabId || !status.unlocked) return null

  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: (values: { host: string; username: string; password: string }) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              checkLogin?: (
                input: typeof values,
              ) => Promise<'same' | 'different' | 'missing' | null>
            }
          }
        ).__coffreExtension
        return bridge?.checkLogin ? bridge.checkLogin(values) : null
      },
      args: [{ host, username, password }],
    })
    const state = result?.result
    if (state === 'same' || state === 'different' || state === 'missing') {
      return state
    }
  } catch {
    // Ancienne version de l’application : repli ci-dessous.
  }
  return compareExistingLogin(status, host, username, password)
}

async function formSubmitted(
  sender: chrome.runtime.MessageSender,
  message: ExtensionMessage,
): Promise<{ prompt: boolean; offerId?: string; error?: string }> {
  const tabId = sender.tab?.id
  const frameId = sender.frameId
  if (!Number.isInteger(tabId) || !Number.isInteger(frameId)) {
    return { prompt: false, error: 'invalid' }
  }
  const host =
    typeof message.host === 'string'
      ? hostFromUrl(message.host) || message.host.trim().toLowerCase()
      : ''
  if (!host) return { prompt: false }
  if (!(await saveAllowedForHost(host))) return { prompt: false }
  const kind: ExtensionAutofillKind =
    message.formKind === 'card' || message.formKind === 'identity'
      ? message.formKind
      : 'login'
  const url = typeof message.url === 'string' ? message.url : ''
  const base = {
    host,
    kind,
    url,
    username: '',
    password: '',
  }

  let pending: Omit<
    StoredPendingSave,
    'id' | 'key' | 'tabId' | 'frameId' | 'createdAt' | 'expiresAt'
  >
  if (kind === 'card') {
    const card = message.card ?? {}
    const number = pendingText(card.number, 40).replace(/\s+/g, '')
    if (!number) return { prompt: false }
    const cardholder = pendingText(card.cardholder, 200)
    const expiry = pendingText(card.expiry, 20)
    const last4 = number.slice(-4)
    pending = {
      ...base,
      label: cardholder || `Carte •••• ${last4}`,
      detail: `•••• ${last4}${expiry ? ` · ${expiry}` : ''}`,
      card: {
        cardholder,
        number,
        expiry,
        cvc: pendingText(card.cvc, 8),
        pin: pendingText(card.pin, 12),
        brand: pendingText(card.brand, 40),
      },
    }
  } else if (kind === 'identity') {
    const identity = message.identity ?? {}
    const firstName = pendingText(identity.firstName, 200)
    const lastName = pendingText(identity.lastName, 200)
    const fullName = pendingText(identity.fullName, 400)
    const email = pendingText(identity.email, 500)
    const name = [firstName, lastName].filter(Boolean).join(' ').trim() || fullName
    if (!name && !email) return { prompt: false }
    pending = {
      ...base,
      label: name || email,
      detail: email,
      identity: {
        fullName,
        firstName,
        lastName,
        email,
        phone: pendingText(identity.phone, 100),
        address: pendingText(identity.address, 500),
        city: pendingText(identity.city, 200),
        postalCode: pendingText(identity.postalCode, 40),
        country: pendingText(identity.country, 200),
      },
    }
  } else {
    const username = pendingText(message.username, 500)
    const password = typeof message.password === 'string' ? message.password : ''
    if (!password) return { prompt: false }
    pending = {
      ...base,
      label: username || host,
      detail: '',
      username,
      password,
    }
  }

  const status = await readStatus()
  const canSave =
    status.mode === 'native'
      ? Boolean(status.paired && status.unlocked)
      : Boolean(status.appOpen && status.unlocked)
  if (!canSave) return { prompt: false }

  if (kind === 'login') {
    const state = await loginSaveState(
      status,
      serviceFor(host, url),
      pending.username,
      pending.password,
    )
    if (state === 'same') return { prompt: false }
    if (state === 'different') pending.update = true
    const assessment = await assessHost({
      host,
      url,
      username: pending.username,
      mode: 'save',
    })
    if (assessment && assessment.signals.length > 0) {
      pending.phishing = assessment
    }
  }

  const saved = await setPendingSave(
    saveKey(tabId as number, frameId as number),
    pending,
  )
  // E2 : après une redirection, la page d’arrivée a pu demander le bandeau
  // avant la fin de cette vérification. Le cadre principal le redemande ; il
  // ne l’affiche que si l’hôte correspond (GET_PENDING_BANNER).
  void api.tabs
    .sendMessage(tabId as number, { type: 'COFFRE_REFRESH_SAVE_BANNER' }, {
      frameId: 0,
    })
    .catch(() => undefined)
  return { prompt: true, offerId: saved.id }
}

async function saveCredentials(
  input: {
    host: string
    username: string
    password: string
    overridePhishing?: boolean
  },
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
                overridePhishing?: boolean
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

async function saveCard(
  input: ExtensionCardSaveInput,
): Promise<{ ok?: boolean; updated?: boolean; itemId?: string; error?: string }> {
  const status = await readStatus()
  if (status.mode === 'native') {
    if (!status.paired) return { error: 'needs-pairing' }
    if (!status.unlocked) return { error: 'locked' }
    return nativeSaveCard(input)
  }
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }

  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: async (values: {
        title?: string
        cardholder: string
        number: string
        expiry: string
        cvc?: string
        pin?: string
        brand?: string
      }) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              saveCard?: (input: {
                title?: string
                cardholder: string
                number: string
                expiry: string
                cvc?: string
                pin?: string
                brand?: string
              }) => Promise<{ id: string; updated: boolean } | null>
            }
          }
        ).__coffreExtension
        if (!bridge?.saveCard) return null
        return bridge.saveCard(values)
      },
      args: [input],
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

async function saveIdentity(
  input: ExtensionIdentitySaveInput,
): Promise<{ ok?: boolean; updated?: boolean; itemId?: string; error?: string }> {
  const status = await readStatus()
  if (status.mode === 'native') {
    if (!status.paired) return { error: 'needs-pairing' }
    if (!status.unlocked) return { error: 'locked' }
    return nativeSaveIdentity(input)
  }
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }

  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: async (values: {
        title?: string
        fullName: string
        firstName: string
        lastName: string
        email: string
        phone: string
        address: string
        city: string
        postalCode: string
        country: string
      }) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              saveIdentity?: (input: {
                title?: string
                fullName: string
                firstName: string
                lastName: string
                email: string
                phone: string
                address: string
                city: string
                postalCode: string
                country: string
              }) => Promise<{ id: string; updated: boolean } | null>
            }
          }
        ).__coffreExtension
        if (!bridge?.saveIdentity) return null
        return bridge.saveIdentity(values)
      },
      args: [input],
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

async function savePendingEntry(
  pending: StoredPendingSave,
  username = pending.username,
  overridePhishing = false,
): Promise<{
  ok?: boolean
  updated?: boolean
  error?: string
  phishing?: PhishingAssessment
}> {
  if (!(await saveAllowedForHost(pending.host))) {
    await clearPendingSave(pending.key)
    return { error: 'excluded' }
  }
  if (pending.phishing && pending.phishing.signals.length > 0) {
    if (!overridePhishing) {
      return { error: 'phishing-warning', phishing: pending.phishing }
    }
    void recordPhishingChoice({
      host: pending.host,
      signals: pending.phishing.signals.map((signal) => signal.code),
      choice: 'continue',
    })
  }
  const result =
    pending.kind === 'card' && pending.card
      ? await saveCard(pending.card)
      : pending.kind === 'identity' && pending.identity
        ? await saveIdentity(pending.identity)
        : await saveCredentials({
            host: serviceFor(pending.host, pending.url),
            username,
            password: pending.password,
            overridePhishing,
          })
  if (result.ok) {
    await clearPendingSave(pending.key)
  }
  return result
}

async function menuSave(
  tabId: number,
  frameId: number,
  overridePhishing = false,
): Promise<{
  ok?: boolean
  updated?: boolean
  error?: string
  phishing?: PhishingAssessment
}> {
  if (!validTabFrame(tabId, frameId)) return { error: 'invalid' }
  const pending = await pendingSaveStore.get(saveKey(tabId, frameId))
  if (!pending) return { error: 'no-pending' }
  return savePendingEntry(pending, pending.username, overridePhishing)
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

function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return (
    typeof sender.url === 'string' &&
    sender.url.startsWith(api.runtime.getURL(''))
  )
}

function isSaveBannerPage(sender: chrome.runtime.MessageSender): boolean {
  const page = api.runtime.getURL('save-banner.html')
  return (
    typeof sender.url === 'string' &&
    (sender.url === page || sender.url.startsWith(`${page}?`))
  )
}

function isMenuPage(sender: chrome.runtime.MessageSender): boolean {
  const page = api.runtime.getURL('menu.html')
  return (
    typeof sender.url === 'string' &&
    (sender.url === page || sender.url.startsWith(`${page}?`))
  )
}

const OFFER_ID_PATTERN = /^[a-f0-9-]{8,64}$/i

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
): Promise<{
  tabId: number
  frameId: number
  host: string
  topHost: string
  url: string
} | null> {
  const tabId = sender.tab?.id
  const frameId = sender.frameId
  if (!Number.isInteger(tabId) || !Number.isInteger(frameId)) return null
  const url = sender.url ?? sender.tab?.url ?? ''
  const host = hostFromUrl(url)
  if (!host) return null
  return {
    tabId: tabId as number,
    frameId: frameId as number,
    host,
    topHost: sender.tab?.url ? hostFromUrl(sender.tab.url) : '',
    url: url.slice(0, 2048),
  }
}

/**
 * Déverrouillage demandé depuis l’extension.
 *
 * Le mot de passe maître n’est jamais demandé ni transmis ici : l’application
 * desktop affiche sa propre fenêtre (Touch ID ou saisie), ou l’onglet Coffre
 * Web est ouvert. L’extension se contente ensuite d’interroger l’état.
 */
async function requestUnlock(): Promise<{
  ok?: boolean
  pending?: boolean
  mode?: 'native' | 'tab'
  error?: string
}> {
  const nativeEnabled = usesNativeBridge((await loadSettings()).appMode)
  const native = nativeEnabled ? await nativeStatus() : null
  if (native) {
    if (!native.paired) return { error: 'needs-pairing' }
    if (native.unlocked) return { ok: true, mode: 'native' }
    const result = await nativeUnlock()
    if (result.error === 'needs-pairing') return result
    if (!result.error) {
      return { ok: true, pending: result.pending === true, mode: 'native' }
    }
    await openApp()
    return { ok: true, pending: true, mode: 'tab' }
  }

  const tabStatus = await readTabStatus()
  if (tabStatus.appOpen && tabStatus.unlocked) {
    return { ok: true, mode: 'tab' }
  }

  // L’application desktop peut être fermée : l’hôte natif la démarre
  // uniquement sur ce clic explicite (drapeau `launch`), jamais pour une
  // simple lecture d’état. Le mode Web n’y touche jamais.
  if (nativeEnabled) {
    const launched = await nativeUnlock()
    if (launched.ok || launched.pending) {
      return { ok: true, pending: launched.pending === true, mode: 'native' }
    }
    if (launched.error === 'needs-pairing') return launched
  }

  await openApp()
  return { ok: true, pending: true, mode: 'tab' }
}

const WELCOME_NOTICE_VERSION = '0.9.0'

async function openWelcome(mode: 'install' | 'update'): Promise<void> {
  try {
    await api.tabs.create({
      url: api.runtime.getURL(`welcome.html?mode=${mode}`),
    })
  } catch {
    // L’accueil reste accessible depuis les réglages.
  }
}

async function openApp(): Promise<{ ok: boolean }> {
  if (usesNativeBridge((await loadSettings()).appMode)) {
    const native = await nativeStatus()
    if (native) {
      await nativeFocus()
      return { ok: true }
    }
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

async function aliasForHost(
  host: string,
): Promise<{ alias?: string; error?: string }> {
  const status = await readStatus()
  if (status.mode === 'native') return { error: 'unsupported' }
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }
  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: async (site: string) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              generateAlias?: (site: string) => Promise<string | null>
            }
          }
        ).__coffreExtension
        return bridge?.generateAlias ? bridge.generateAlias(site) : null
      },
      args: [host],
    })
    const alias = result?.result as string | null | undefined
    return alias ? { alias } : { error: 'alias' }
  } catch {
    return { error: 'permission' }
  }
}

let contextMenuQueue: Promise<void> = Promise.resolve()
let lastContextMenuModel: ContextMenuEntry[] = []

function contextMenuTitle(entry: ContextMenuEntry): string {
  return entry.title || (entry.titleKey ? t(entry.titleKey) : '')
}

async function rebuildContextMenus(): Promise<void> {
  try {
    await api.contextMenus.removeAll()
  } catch {
    // Le navigateur peut ne pas exposer l’API malgré la permission.
    return
  }
  const status = await readStatus()
  const settings = await loadSettings()
  const [tab] = await api.tabs.query({ active: true, currentWindow: true })
  const host = tab?.url ? hostFromUrl(tab.url) : ''
  const fillAllowed = !isSiteExcluded(settings.neverFillSites, host)
  const available =
    status.unlocked &&
    !(status.mode === 'native' && status.paired === false)

  let logins: ExtensionAutofillSummary[] = []
  let cards: ExtensionAutofillSummary[] = []
  let identities: ExtensionAutofillSummary[] = []
  if (available) {
    if (host) {
      const result = await search(host, 'login')
      logins = result.items ?? []
    }
    const cardResult = await search('', 'card')
    cards = cardResult.items ?? []
    const identityResult = await search('', 'identity')
    identities = identityResult.items ?? []
  }

  const model = buildContextMenuModel({
    unlocked: available,
    fillAllowed,
    host,
    logins,
    cards,
    identities,
  })
  lastContextMenuModel = model
  for (const entry of model) {
    try {
      const properties = {
        id: entry.id,
        title: contextMenuTitle(entry),
        ...(entry.parentId
          ? { parentId: entry.parentId }
          : { contexts: entry.contexts ?? ['all'] }),
        enabled: entry.enabled !== false,
      } as unknown as chrome.contextMenus.CreateProperties
      api.contextMenus.create(properties)
    } catch {
      // Un identifiant en double ne doit pas interrompre tout le menu.
    }
  }
}

function scheduleContextMenus(): void {
  contextMenuQueue = contextMenuQueue
    .then(() => rebuildContextMenus())
    .catch(() => undefined)
}

const CONTEXT_ITEM_ID = /^[A-Za-z0-9_-]{1,128}$/

async function contextMenuFill(
  tab: chrome.tabs.Tab,
  frameId: number,
  pageUrl: string,
  itemId: string,
  kind: ExtensionAutofillKind,
): Promise<boolean> {
  // L’hôte est celui du cadre cliqué, pas celui de l’onglet : un remplissage
  // dans une iframe est vérifié contre l’origine de l’iframe.
  const host = pageUrl ? hostFromUrl(pageUrl) : ''
  if (!tab.id || !host || !CONTEXT_ITEM_ID.test(itemId)) {
    flashActionBadge()
    return false
  }
  if (!(await ensureContentScript(tab.id, frameId))) {
    flashActionBadge()
    return false
  }
  const response = await menuFill(tab.id, frameId, host, pageUrl, itemId, kind)
  if (response.ok) return true
  if (response.error === 'phishing-warning') {
    // Q1 : le menu dans le champ affiche l’avertissement et laisse choisir.
    if (await openMenuInTab(tab.id, kind, frameId)) return true
  }
  flashActionBadge()
  return false
}

async function insertAliasInTab(
  tab: chrome.tabs.Tab,
  frameId: number,
): Promise<boolean> {
  if (!tab.id) {
    flashActionBadge()
    return false
  }
  const host = tab.url ? hostFromUrl(tab.url) : ''
  if (!host) {
    flashActionBadge()
    return false
  }
  const result = await aliasForHost(host)
  if (!result.alias) {
    flashActionBadge()
    return false
  }
  if (!(await ensureContentScript(tab.id, frameId))) {
    flashActionBadge()
    return false
  }
  try {
    const response = (await api.tabs.sendMessage(
      tab.id,
      { type: 'COFFRE_FILL_TEXT', text: result.alias },
      { frameId },
    )) as { ok?: boolean } | undefined
    if (response?.ok) return true
  } catch {
    // Le badge ci-dessous signale l’échec.
  }
  flashActionBadge()
  return false
}

async function onContextMenuClicked(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  const id = String(info.menuItemId)
  const frameId = info.frameId ?? 0
  if (id === 'unlock') {
    const result = await requestUnlock()
    if (result.error) flashActionBadge()
    scheduleContextMenus()
    void updateActionBadge()
    return
  }
  if (id === 'open-app' || id === 'add-site') {
    await openApp()
    return
  }
  if (!tab) return flashActionBadge()
  const pageUrl = (info.frameUrl || info.pageUrl || tab.url || '').slice(0, 2048)

  if (id === 'fill-login-choose') {
    if (!(await openMenuInTab(tab.id ?? -1, 'login', frameId))) {
      flashActionBadge()
    }
    return
  }
  if (id === 'fill-card') {
    if (!(await openMenuInTab(tab.id ?? -1, 'card', frameId))) {
      flashActionBadge()
    }
    return
  }
  if (id === 'fill-identity') {
    if (!(await openMenuInTab(tab.id ?? -1, 'identity', frameId))) {
      flashActionBadge()
    }
    return
  }
  if (id === 'generate-password') {
    if (tab.id) {
      await generateAndFillPassword(tab.id, tab.url ?? '', frameId)
    }
    return
  }
  if (id === 'insert-alias') {
    await insertAliasInTab(tab, frameId)
    return
  }
  if (id.startsWith('fill-login:')) {
    await contextMenuFill(
      tab,
      frameId,
      pageUrl,
      id.slice('fill-login:'.length),
      'login',
    )
    return
  }
  if (id.startsWith('fill-card:')) {
    await contextMenuFill(
      tab,
      frameId,
      pageUrl,
      id.slice('fill-card:'.length),
      'card',
    )
    return
  }
  if (id.startsWith('fill-identity:')) {
    await contextMenuFill(
      tab,
      frameId,
      pageUrl,
      id.slice('fill-identity:'.length),
      'identity',
    )
  }
}

const CONTENT_SCRIPT_MESSAGES = new Set<string>([
  'CONTENT_CONTEXT',
  'FORM_SUBMITTED',
  'GET_PENDING_BANNER',
  'MENU_REGISTER',
  'PASSKEY_CANCEL',
  'PASSKEY_REQUEST',
])

interface MenuTokenContext {
  tabId: number
  frameId: number
  host: string
  topHost: string
  url: string
  kind: ExtensionAutofillKind
  mode: string
  expiresAt: number
}

const MENU_TOKEN_TTL_MS = 120_000
const MENU_TOKEN_PATTERN = /^[a-f0-9]{32}$/
const menuTokens = new Map<string, MenuTokenContext>()

function pruneMenuTokens(): void {
  const now = Date.now()
  for (const [token, context] of menuTokens) {
    if (context.expiresAt < now) menuTokens.delete(token)
  }
}

function menuContextFor(
  sender: chrome.runtime.MessageSender,
  token: unknown,
): MenuTokenContext | null {
  if (!isMenuPage(sender) || typeof token !== 'string') return null
  if (!MENU_TOKEN_PATTERN.test(token)) return null
  const context = menuTokens.get(token)
  if (!context || context.expiresAt < Date.now()) {
    if (context) menuTokens.delete(token)
    return null
  }
  // Dans le cas normal, le menu est une iframe de l’onglet cible : son
  // `sender.tab` est celui de la page. Un menu ouvert dans son propre onglet
  // (parcours de test) est une page d’extension de confiance et peut utiliser
  // le contexte enregistré.
  const topLevelMenu =
    sender.tab?.url?.startsWith(api.runtime.getURL('menu.html')) ?? false
  if (!topLevelMenu && sender.tab?.id !== context.tabId) return null
  return context
}

async function handle(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  // Les content scripts ne peuvent envoyer que les messages liés à leur page.
  // Tout le reste (recherche, détails, appairage, sauvegarde…) est réservé aux
  // pages de l’extension.
  if (!isExtensionPage(sender)) {
    if (!sender.tab || !CONTENT_SCRIPT_MESSAGES.has(message.type ?? '')) {
      return { error: 'forbidden' }
    }
  }
  const menuContext = menuContextFor(sender, message.token)
  if (isMenuPage(sender) && !menuContext) {
    return { error: 'forbidden' }
  }
  switch (message.type) {
    case 'GET_STATUS':
      return readStatus()
    case 'SEARCH':
      return search(message.query ?? '')
    case 'FILL':
      return fill(message.itemId ?? '', message.tabId)
    case 'DETAILS':
      return itemDetails(
        message.itemId ?? '',
        menuContext?.host ?? message.host ?? '',
        menuContext?.url ?? message.url ?? '',
      )
    case 'OPEN_APP':
    case 'FOCUS_APP':
      return openApp()
    case 'UNLOCK_REQUEST':
      return requestUnlock().finally(() => {
        scheduleContextMenus()
        void updateActionBadge()
      })
    case 'OPEN_SHORTCUTS': {
      // Firefox refuse d’ouvrir about:addons depuis une extension : il
      // fournit openShortcutSettings() (Firefox 137+).
      const commands = api.commands as
        | (typeof api.commands & { openShortcutSettings?: () => Promise<void> })
        | undefined
      if (commands?.openShortcutSettings) {
        try {
          await commands.openShortcutSettings()
          return { ok: true }
        } catch {
          return { error: 'shortcuts-page' }
        }
      }
      if (/Firefox/i.test(navigator.userAgent)) {
        return { error: 'shortcuts-page' }
      }
      try {
        await api.tabs.create({ url: 'chrome://extensions/shortcuts' })
        return { ok: true }
      } catch {
        return { error: 'shortcuts-page' }
      }
    }
    case 'RUN_COMMAND': {
      // Canal interne des tests de bout en bout : l’API `commands` ne permet
      // pas de déclencher une commande depuis Playwright. Il reste limité aux
      // pages d’extension et n’expose aucune opération nouvelle.
      // Seuls la popup et les pages d’extension ouvertes dans leur propre
      // onglet l’utilisent : jamais le menu ni le bandeau intégrés à un site.
      if (
        !isExtensionPage(sender) ||
        (sender.tab !== undefined &&
          !(sender.tab.url ?? '').startsWith(api.runtime.getURL('')))
      ) {
        return { error: 'forbidden' }
      }
      const command =
        typeof message.command === 'string' ? message.command : ''
      if (
        command !== 'fill-login' &&
        command !== 'generate-password' &&
        command !== 'fill-totp'
      ) {
        return { error: 'invalid' }
      }
      return { ok: await handleCommand(command) }
    }
    case 'CONTEXT_MENU_SNAPSHOT': {
      if (!isExtensionPage(sender)) return { error: 'forbidden' }
      await rebuildContextMenus()
      return { model: lastContextMenuModel }
    }
    case 'RUN_CONTEXT_MENU': {
      // Même limite que RUN_COMMAND : les menus natifs ne sont pas
      // cliquables depuis Playwright. Ce canal reste réservé aux pages
      // d’extension et appelle le gestionnaire réel.
      if (!isExtensionPage(sender)) return { error: 'forbidden' }
      const menuItemId =
        typeof message.menuItemId === 'string' ? message.menuItemId : ''
      const tabId = Number(message.tabId)
      const frameId = Number(message.frameId)
      if (!menuItemId || !Number.isInteger(tabId) || tabId < 0) {
        return { error: 'invalid' }
      }
      const tab = await api.tabs.get(tabId).catch(() => undefined)
      if (!tab) return { error: 'no-tab' }
      await onContextMenuClicked(
        {
          menuItemId,
          frameId: Number.isInteger(frameId) && frameId >= 0 ? frameId : 0,
        } as unknown as chrome.contextMenus.OnClickData,
        tab,
      )
      return { ok: true }
    }
    case 'FILL_SIGNUP': {
      const context = menuContext!
      const password =
        typeof message.password === 'string' ? message.password : ''
      if (password.length < 4 || password.length > 128) {
        return { error: 'invalid' }
      }
      const { tabId, frameId, host } = context
      const tab = await api.tabs.get(tabId).catch(() => undefined)
      if (!tab) return { error: 'no-tab' }
      if (!(await fillAllowedForHost(host))) return { error: 'excluded' }
      if (!(await ensureContentScript(tabId, frameId))) {
        return { error: 'permission' }
      }
      try {
        const response = (await api.tabs.sendMessage(
          tabId,
          { type: 'COFFRE_FILL_SIGNUP', password, host },
          { frameId },
        )) as { ok?: boolean; filled?: number; error?: string } | undefined
        if (!response?.ok) return { error: response?.error ?? 'no-fields' }
        // Q3 : l’historique chiffré du générateur vit dans le coffre, via
        // l’application ; l’extension ne conserve pas le mot de passe.
        void recordGeneratedPassword(host, password).catch(() => undefined)
        return { ok: true, filled: response.filled ?? 0 }
      } catch {
        return { error: 'no-tab' }
      }
    }
    case 'SET_SITE_EXCLUSION': {
      if (!isExtensionPage(sender)) return { error: 'forbidden' }
      const host = siteKey(menuContext?.host ?? message.host ?? '')
      const kind = message.kind === 'save' ? 'save' : 'fill'
      if (!host) return { error: 'invalid' }
      const excluded = message.excluded !== false
      const settings = await loadSettings()
      const current =
        kind === 'save' ? settings.neverSaveSites : settings.neverFillSites
      const next = excluded
        ? [...new Set([...current, host])]
        : current.filter((entry) => siteKey(entry) !== host)
      await saveSettings(
        kind === 'save'
          ? { neverSaveSites: next }
          : { neverFillSites: next },
      )
      if (excluded && kind === 'save') {
        await pendingSaveStore.removeWhere((entry) =>
          isSiteExcluded([host], entry.host),
        )
        await updateActionBadge()
      }
      scheduleContextMenus()
      void updateActionBadge()
      return {
        ok: true,
        host,
        kind,
        excluded: next.includes(host),
      }
    }
    case 'PAIR':
      return nativePair()
    case 'ENABLE_INLINE':
      await syncContentScriptRegistration()
      void updateActionBadge()
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
    case 'RECORD_GENERATED_PASSWORD':
      return recordGeneratedPassword(
        message.host ?? '',
        message.password ?? '',
      )
    case 'ALIAS_GENERATE':
      return aliasForHost(message.host ?? '')
    case 'MENU_REGISTER': {
      // Le content script enregistre le menu qu’il crée ; une page de
      // l’extension peut aussi le faire pour les parcours de test. Une page
      // web ne peut pas envoyer de message runtime.
      if (
        typeof message.token !== 'string' ||
        !MENU_TOKEN_PATTERN.test(message.token)
      ) {
        return { error: 'invalid' }
      }
      const tabId = Number(message.tabId)
      const frameId = Number(message.frameId)
      const host =
        typeof message.host === 'string' ? message.host.slice(0, 253) : ''
      if (
        !Number.isInteger(tabId) ||
        tabId < 0 ||
        !Number.isInteger(frameId) ||
        frameId < 0 ||
        !host
      ) {
        return { error: 'invalid' }
      }
      const kind: ExtensionAutofillKind =
        message.kind === 'card' ||
        message.kind === 'identity' ||
        message.kind === 'custom'
          ? message.kind
          : 'login'
      pruneMenuTokens()
      menuTokens.set(message.token, {
        tabId,
        frameId,
        host,
        topHost:
          typeof message.topHost === 'string'
            ? message.topHost.slice(0, 253)
            : '',
        url:
          typeof message.url === 'string' ? message.url.slice(0, 2048) : '',
        kind,
        mode:
          typeof message.mode === 'string' ? message.mode.slice(0, 16) : 'badge',
        expiresAt: Date.now() + MENU_TOKEN_TTL_MS,
      })
      return { ok: true }
    }
    case 'MENU_SEARCH': {
      const context = menuContext!
      return menuSearch(
        context.tabId,
        context.host,
        message.query ?? '',
        context.kind,
      )
    }
    case 'MENU_FILL': {
      const context = menuContext!
      return menuFill(
        context.tabId,
        context.frameId,
        context.host,
        context.url,
        message.itemId ?? '',
        context.kind,
        message.includeSensitive === true,
        message.overridePhishing === true,
      )
    }
    case 'FORM_SUBMITTED':
      return formSubmitted(sender, message)
    case 'GET_PENDING_BANNER': {
      const context = await contentContext(sender)
      if (!context || context.frameId !== 0) return { offer: null }
      if (!(await pendingSessionUnlocked())) return { offer: null }
      const pending = await latestPendingForTab(context.tabId)
      if (
        !pending ||
        !(
          pending.host === context.host ||
          hostMatches(pending.host, context.host)
        )
      ) {
        return { offer: null }
      }
      if (!(await saveAllowedForHost(pending.host))) {
        await clearPendingSave(pending.key)
        return { offer: null }
      }
      const view = saveBannerView(pending)
      return view ? { offer: { id: view.offerId } } : { offer: null }
    }
    case 'GET_SAVE_BANNER': {
      if (!isSaveBannerPage(sender)) return { error: 'forbidden' }
      if (!(await pendingSessionUnlocked())) return { error: 'locked' }
      const offerId =
        typeof message.offerId === 'string' ? message.offerId : ''
      if (!OFFER_ID_PATTERN.test(offerId)) return { error: 'invalid' }
      const pending = await pendingSaveStore.find(offerId)
      if (!pending) return { error: 'no-pending' }
      if (!(await saveAllowedForHost(pending.host))) {
        await clearPendingSave(pending.key)
        return { error: 'no-pending' }
      }
      const view = saveBannerView(pending)
      return view ? { banner: view } : { error: 'no-pending' }
    }
    case 'SAVE_BANNER_NOW': {
      if (!isSaveBannerPage(sender)) return { error: 'forbidden' }
      const offerId =
        typeof message.offerId === 'string' ? message.offerId : ''
      if (!OFFER_ID_PATTERN.test(offerId)) return { error: 'invalid' }
      const pending = await pendingSaveStore.find(offerId)
      if (!pending) return { error: 'no-pending' }
      const username =
        pending.kind === 'login'
          ? pendingText(message.username, 500) || pending.username
          : pending.username
      return savePendingEntry(
        pending,
        username,
        message.overridePhishing === true,
      )
    }
    case 'SAVE_STATUS': {
      if (!(await pendingSessionUnlocked())) return { pending: null }
      const context = menuContext!
      const key = saveKey(context.tabId, context.frameId)
      const pending = await pendingSaveStore.get(key)
      if (!pending) return { pending: null }
      if (!(await saveAllowedForHost(pending.host))) {
        await clearPendingSave(pending.key)
        return { pending: null }
      }
      return {
        pending: {
          username: pending.label,
          host: pending.host,
          kind: pending.kind,
          detail: pending.detail,
          phishing: pending.phishing,
        },
      }
    }
    case 'SAVE_NOW': {
      const context = menuContext!
      return menuSave(
        context.tabId,
        context.frameId,
        message.overridePhishing === true,
      )
    }
    case 'GET_PENDING_SAVE': {
      if (!(await pendingSessionUnlocked())) return { pending: null }
      const tabId = Number(message.tabId)
      const pending = await latestPendingForTab(tabId)
      if (!pending) return { pending: null }
      if (!(await saveAllowedForHost(pending.host))) {
        await clearPendingSave(pending.key)
        return { pending: null }
      }
      return {
        pending: {
          id: pending.id,
          username: pending.label,
          host: pending.host,
          kind: pending.kind,
          detail: pending.detail,
          update: pending.update === true,
          tabId,
          frameId: pending.frameId,
        },
      }
    }
    case 'SAVE_PENDING_NOW': {
      const tabId = Number(message.tabId)
      const pending = await latestPendingForTab(tabId)
      if (!pending) return { error: 'no-pending' }
      return menuSave(
        pending.tabId,
        pending.frameId,
        message.overridePhishing === true,
      )
    }
    case 'PHISHING_CHOICE': {
      const host = menuContext?.host ?? message.host ?? ''
      const choice =
        message.choice === 'continue'
          ? 'continue'
          : message.choice === 'cancel'
            ? 'cancel'
            : null
      const signals = Array.isArray(message.signals)
        ? message.signals
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.slice(0, 40))
            .slice(0, 20)
        : []
      if (!host || !choice) return { error: 'invalid' }
      await recordPhishingChoice({ host, signals, choice })
      return { ok: true }
    }
    case 'SAVE_DISMISS': {
      const context = menuContext!
      const key = saveKey(context.tabId, context.frameId)
      await clearPendingSave(key)
      return { ok: true }
    }
    case 'SAVE_DISMISS_PENDING': {
      const pending = await latestPendingForTab(Number(message.tabId))
      if (pending) await clearPendingSave(pending.key)
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

api.commands?.onCommand.addListener((command) => {
  void handleCommand(command).catch(() => flashActionBadge())
})

api.contextMenus?.onClicked.addListener((info, tab) => {
  void onContextMenuClicked(info, tab).catch(() => flashActionBadge())
})

api.runtime.onInstalled.addListener((details) => {
  scheduleContextMenus()
  const version = api.runtime.getManifest().version
  if (details.reason === 'install') {
    void openWelcome('install')
    return
  }
  if (
    details.reason === 'update' &&
    details.previousVersion &&
    details.previousVersion !== version &&
    version === WELCOME_NOTICE_VERSION
  ) {
    void openWelcome('update')
  }
})
api.runtime.onStartup.addListener(() => scheduleContextMenus())
api.tabs.onActivated.addListener(() => {
  scheduleContextMenus()
  void updateActionBadge()
})
// Une navigation dans l’onglet actif change le site : le menu ne doit pas
// garder les noms des connexions du site précédent, et le badge suit le site.
api.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (!tab.active) return
  if (
    change.url !== undefined ||
    change.status === 'loading' ||
    change.status === 'complete'
  ) {
    scheduleContextMenus()
    void updateActionBadge()
  }
})
api.windows.onFocusChanged.addListener(() => {
  scheduleContextMenus()
  void updateActionBadge()
})

api.windows.onRemoved.addListener((windowId) => {
  for (const request of [...pendingPasskeys.values()]) {
    if (request.windowId === windowId) decidePasskey(request.id, 'decline')
  }
})

api.tabs.onRemoved.addListener((tabId) => {
  for (const request of [...pendingPasskeys.values()]) {
    if (request.tabId === tabId) decidePasskey(request.id, 'decline')
  }
  void Promise.all([
    pendingSaveStore.removeTab(tabId),
    recentSelectionStore.removeTab(tabId),
  ])
    .then(() => updateActionBadge())
    .catch(() => undefined)
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
