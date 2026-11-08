import {
  credentialsMatchPage,
  hostFromUrl,
  type ExtensionCredentials,
  type ExtensionLoginSummary,
} from '../src/lib/extensionProtocol'

const DEFAULT_APP_URL = 'http://localhost:1420'
const APP_URL_KEY = 'appUrl'

interface ExtensionMessage {
  type?: string
  query?: string
  itemId?: string
  tabId?: number
  appUrl?: string
  /** Confirmation explicite de l’utilisateur malgré un domaine différent. */
  force?: boolean
}

interface AppStatus {
  appOpen: boolean
  unlocked: boolean
  tabId?: number
  appUrl: string
}

async function getAppUrl(): Promise<string> {
  const stored = await chrome.storage.local.get(APP_URL_KEY)
  const value = stored[APP_URL_KEY]
  const url = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_APP_URL
  return url.replace(/\/+$/, '')
}

async function findAppTab(appUrl: string): Promise<chrome.tabs.Tab | undefined> {
  // Le filtre `url` s’appuie sur la permission d’hôte de l’application, ce qui
  // évite d’accorder la permission `tabs` (accès aux URL de tous les onglets).
  const tabs = await chrome.tabs.query({ url: [`${appUrl}/*`] })
  return tabs[0]
}

async function readStatus(): Promise<AppStatus> {
  const appUrl = await getAppUrl()
  const tab = await findAppTab(appUrl)
  if (!tab?.id) return { appOpen: false, unlocked: false, appUrl }

  try {
    const [result] = await chrome.scripting.executeScript({
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
    }
  } catch {
    return { appOpen: true, unlocked: false, tabId: tab.id, appUrl }
  }
}

async function search(query: string): Promise<{
  items?: ExtensionLoginSummary[]
  error?: string
}> {
  const status = await readStatus()
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }

  try {
    const [result] = await chrome.scripting.executeScript({
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

async function credentials(itemId: string): Promise<{
  credentials?: ExtensionCredentials | null
  error?: string
}> {
  const status = await readStatus()
  if (!status.appOpen || !status.tabId) return { error: 'app-closed' }
  if (!status.unlocked) return { error: 'locked' }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: status.tabId },
      world: 'MAIN',
      func: async (id: string) => {
        const bridge = (
          window as unknown as {
            __coffreExtension?: {
              fill: (itemId: string) => Promise<ExtensionCredentials | null>
            }
          }
        ).__coffreExtension
        if (!bridge) return null
        return bridge.fill(id)
      },
      args: [itemId],
    })
    return {
      credentials: (result?.result as ExtensionCredentials | null | undefined) ?? null,
    }
  } catch {
    return { error: 'permission' }
  }
}

interface FillResult {
  ok?: boolean
  filled?: number
  error?: string
  pageHost?: string
  itemHosts?: string[]
}

async function fill(
  itemId: string,
  tabId: number | undefined,
  force = false,
): Promise<FillResult> {
  let targetId = tabId
  if (!targetId) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
    targetId = active?.id
  }
  if (!targetId) return { error: 'no-tab' }

  // L’URL de l’onglet visé est lisible grâce à `activeTab` (clic sur l’icône).
  let pageUrl = ''
  try {
    pageUrl = (await chrome.tabs.get(targetId)).url ?? ''
  } catch {
    return { error: 'no-tab' }
  }

  const fetched = await credentials(itemId)
  if (fetched.error) return { error: fetched.error }
  const data = fetched.credentials
  if (!data) return { error: 'not-found' }

  // Défense contre l’hameçonnage : on ne remplit pas une page dont le domaine
  // ne correspond à aucune adresse de l’élément, sauf confirmation explicite.
  if (!force && !credentialsMatchPage(data.hosts, pageUrl)) {
    return {
      error: 'domain-mismatch',
      pageHost: hostFromUrl(pageUrl),
      itemHosts: data.hosts ?? [],
    }
  }

  try {
    const [result] = await chrome.scripting.executeScript({
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

async function openApp(): Promise<{ ok: boolean }> {
  const appUrl = await getAppUrl()
  const tab = await findAppTab(appUrl)
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true })
    if (typeof tab.windowId === 'number') {
      await chrome.windows.update(tab.windowId, { focused: true })
    }
    return { ok: true }
  }
  await chrome.tabs.create({ url: appUrl })
  return { ok: true }
}

async function handle(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'GET_STATUS':
      return readStatus()
    case 'SEARCH':
      return search(message.query ?? '')
    case 'FILL':
      return fill(message.itemId ?? '', message.tabId, message.force === true)
    case 'OPEN_APP':
    case 'FOCUS_APP':
      return openApp()
    case 'GET_APP_URL':
      return { appUrl: await getAppUrl() }
    case 'SET_APP_URL': {
      const value = (message.appUrl ?? '').trim().replace(/\/+$/, '')
      if (!/^https?:\/\/[^/\s]+$/i.test(value)) {
        return { error: 'invalid-url' }
      }
      await chrome.storage.local.set({ [APP_URL_KEY]: value })
      return { ok: true, appUrl: value }
    }
    default:
      return { error: 'unknown-message' }
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    // Seules nos propres pages (popup, options, service worker) peuvent
    // demander des identifiants ; aucun content script n’est exposé.
    if (sender.id !== chrome.runtime.id) return
    void handle(message)
      .then((result) => sendResponse(result))
      .catch((error: unknown) =>
        sendResponse({
          error: error instanceof Error ? error.message : 'unknown-error',
        }),
      )
    return true
  },
)
