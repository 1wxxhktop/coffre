/**
 * Content script isolé : détecte les formulaires, affiche le menu dans une
 * iframe d’extension et remplit les champs après un clic utilisateur.
 *
 * Le menu vit dans une iframe d’origine `chrome-extension://` placée dans un
 * shadow root fermé. La page ne peut ni lire son contenu ni envoyer de messages
 * valides : le content script vérifie `event.source` et `event.origin`.
 */

import {
  detectLoginFields,
  fillDetectedLogin,
  isVisible,
  type DetectedLoginFields,
} from './detect'
import { hostFromUrl, hostMatches } from '../src/lib/extensionProtocol'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome
const MENU_ORIGIN = new URL(api.runtime.getURL('menu.html')).origin

// Le script du monde MAIN peut ainsi vérifier que le relais est déjà à
// l’écoute avant d’intercepter une requête WebAuthn très précoce.
document.documentElement.setAttribute('data-coffre-webauthn-ready', '')

interface ContentContext {
  tabId: number
  frameId: number
  host: string
}

interface MenuHandle {
  host: HTMLDivElement
  iframe: HTMLIFrameElement
  mode: 'badge' | 'save'
  anchor: HTMLInputElement
  width: number
  height: number
}

interface PasskeyRelayMessage {
  source?: string
  type?: string
  requestId?: string
  kind?: string
  payload?: unknown
  fallback?: boolean
  error?: string
  result?: unknown
}

const PASSKEY_REQUEST_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

let context: ContentContext | null = null
let menu: MenuHandle | null = null
let detectTimer: number | undefined
let dismissedUntil = 0

function send<T>(payload: Record<string, unknown>): Promise<T> {
  return api.runtime.sendMessage(payload) as Promise<T>
}

/**
 * Repli pour les navigateurs qui ne savent pas enregistrer un content script
 * dans le monde MAIN. Si le script est déjà présent, son garde-fou l’empêche
 * de s’installer deux fois.
 */
function injectMainWorldScript(): void {
  try {
    const script = document.createElement('script')
    script.src = api.runtime.getURL('webauthn-main.js')
    script.async = false
    script.dataset.coffre = 'webauthn'
    script.addEventListener('load', () => script.remove())
    script.addEventListener('error', () => script.remove())
    ;(document.head ?? document.documentElement).append(script)
  } catch {
    // La politique CSP de la page peut bloquer l’injection : la passkey reste
    // disponible depuis l’application Coffre elle-même.
  }
}

function removeMenu() {
  if (!menu) return
  menu.host.remove()
  menu = null
}

function positionMenu() {
  if (!menu) return
  const rect = menu.anchor.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0 || !isVisible(menu.anchor)) {
    removeMenu()
    return
  }
  const width = menu.width
  const height = menu.height
  let left = rect.left + rect.width - width
  let top = rect.top + 8
  if (left < 8) left = 8
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - width - 8)
  }
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 8)
  }
  menu.host.style.left = `${Math.round(left)}px`
  menu.host.style.top = `${Math.round(top)}px`
}

function setMenuSize(width: number, height: number) {
  if (!menu) return
  const boundedWidth = Math.min(360, Math.max(40, width))
  const boundedHeight = Math.min(520, Math.max(40, height))
  menu.width = boundedWidth
  menu.height = boundedHeight
  menu.host.style.width = `${boundedWidth}px`
  menu.host.style.height = `${boundedHeight}px`
  positionMenu()
}

function showMenu(
  anchor: HTMLInputElement,
  mode: 'badge' | 'save' = 'badge',
): void {
  if (!context) return
  removeMenu()

  const host = document.createElement('div')
  host.setAttribute('data-coffre-menu', '')
  host.style.cssText = [
    'all: initial',
    'position: fixed',
    'z-index: 2147483647',
    'width: 40px',
    'height: 40px',
    'border: 0',
    'padding: 0',
    'margin: 0',
    'background: transparent',
    'color-scheme: light dark',
  ].join(';')

  const shadow = host.attachShadow({ mode: 'closed' })
  const iframe = document.createElement('iframe')
  iframe.title = 'Coffre'
  iframe.setAttribute('allowtransparency', 'true')
  iframe.referrerPolicy = 'no-referrer'
  iframe.style.cssText =
    'width:100%;height:100%;border:0;padding:0;margin:0;background:transparent;color-scheme:light dark;'
  const url = new URL(api.runtime.getURL('menu.html'))
  url.searchParams.set('tab', String(context.tabId))
  url.searchParams.set('frame', String(context.frameId))
  url.searchParams.set('host', context.host)
  url.searchParams.set('mode', mode)
  iframe.src = url.toString()
  shadow.append(iframe)
  host.style.width = mode === 'badge' ? '40px' : '340px'
  host.style.height = mode === 'badge' ? '40px' : '430px'
  document.documentElement.append(host)

  menu = {
    host,
    iframe,
    mode,
    anchor,
    width: mode === 'badge' ? 40 : 340,
    height: mode === 'badge' ? 40 : 430,
  }
  positionMenu()
}

function refreshDetection(): void {
  if (Date.now() < dismissedUntil) return
  const fields = detectLoginFields(document)
  if (!fields.password) {
    removeMenu()
    return
  }
  if (menu && menu.mode === 'badge') {
    menu.anchor = fields.password
    positionMenu()
  } else if (!menu) {
    showMenu(fields.password)
  }
}

function scheduleDetection() {
  window.clearTimeout(detectTimer)
  detectTimer = window.setTimeout(refreshDetection, 250)
}

function handleFocus(event: FocusEvent) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (target.type !== 'password' && target.type !== 'text' && target.type !== 'email') {
    return
  }
  scheduleDetection()
}

function fieldsForSave(): DetectedLoginFields | null {
  const fields = detectLoginFields(document)
  if (!fields.password || !fields.username) return null
  if (!fields.password.value) return null
  return fields
}

function handleSubmit() {
  const fields = fieldsForSave()
  if (!fields || !context) return
  void send<{ prompt?: boolean }>({
    type: 'FORM_SUBMITTED',
    host: context.host,
    username: fields.username?.value ?? '',
    password: fields.password?.value ?? '',
    url: location.href,
  })
    .then((response) => {
      if (response?.prompt && fields.password) {
        showMenu(fields.password, 'save')
      }
    })
    .catch(() => undefined)
}

api.runtime.onMessage.addListener(
  (
    message: {
      type?: string
      host?: string
      credentials?: { username?: string; password?: string; totp?: string }
    },
    _sender,
    sendResponse,
  ) => {
    if (message?.type !== 'COFFRE_FILL_CREDENTIALS') return
    const pageHost = hostFromUrl(location.href)
    const expected = hostFromUrl(message.host ?? '') || message.host || ''
    if (
      !pageHost ||
      !expected ||
      !(pageHost === expected || hostMatches(pageHost, expected))
    ) {
      sendResponse({ ok: false, error: 'domain-mismatch' })
      return
    }
    const values = message.credentials
    if (!values?.password) {
      sendResponse({ ok: false, error: 'credentials' })
      return
    }
    const fields = detectLoginFields(document)
    if (!fields.password) {
      sendResponse({ ok: false, error: 'no-password' })
      return
    }
    const filled = fillDetectedLogin(fields, {
      username: values.username ?? '',
      password: values.password,
      totp: values.totp ?? '',
    })
    sendResponse(filled > 0 ? { ok: true, filled } : { ok: false, error: 'no-fields' })
  },
)

window.addEventListener('message', (event) => {
  if (!menu || event.source !== menu.iframe.contentWindow) return
  if (event.origin !== MENU_ORIGIN) return
  const data = event.data as {
    type?: string
    width?: number
    height?: number
  }
  if (data?.type === 'coffre-menu-resize') {
    setMenuSize(Number(data.width), Number(data.height))
  }
  if (data?.type === 'coffre-menu-close') {
    dismissedUntil = Date.now() + 5_000
    removeMenu()
  }
})

function passkeyPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const strings = (input: unknown, max: number): string[] =>
    Array.isArray(input)
      ? input
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.slice(0, max))
          .slice(0, 50)
      : []
  return {
    rpId: typeof source.rpId === 'string' ? source.rpId.slice(0, 253) : '',
    challenge:
      typeof source.challenge === 'string' ? source.challenge.slice(0, 2048) : '',
    userName:
      typeof source.userName === 'string' ? source.userName.slice(0, 500) : '',
    userHandle:
      typeof source.userHandle === 'string' ? source.userHandle.slice(0, 500) : '',
    allowCredentials: strings(source.allowCredentials, 1024),
    excludeCredentials: strings(source.excludeCredentials, 1024),
  }
}

function answerPasskey(
  requestId: string,
  response: { error?: string; result?: unknown; fallback?: boolean },
): void {
  window.postMessage(
    {
      source: 'coffre-webauthn',
      type: 'response',
      requestId,
      ...response,
    },
    location.origin,
  )
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return
  const data = event.data as PasskeyRelayMessage
  if (!data || data.source !== 'coffre-webauthn') return
  const requestId =
    typeof data.requestId === 'string' ? data.requestId : ''
  if (!PASSKEY_REQUEST_PATTERN.test(requestId)) return

  if (data.type === 'cancel') {
    void send({ type: 'PASSKEY_CANCEL', requestId }).catch(() => undefined)
    return
  }
  if (data.type !== 'request') return
  const kind =
    data.kind === 'create' || data.kind === 'get' ? data.kind : null
  const payload = passkeyPayload(data.payload)
  if (!kind || !payload) return

  void send<{ error?: string; result?: unknown; fallback?: boolean }>({
    type: 'PASSKEY_REQUEST',
    kind,
    requestId,
    payload,
  })
    .then((response) => {
      answerPasskey(requestId, {
        error: response?.error,
        result: response?.result,
        fallback: response?.fallback,
      })
    })
    .catch(() => {
      answerPasskey(requestId, { error: 'passkey-failed' })
    })
})

document.addEventListener('focusin', handleFocus, true)
document.addEventListener('submit', handleSubmit, true)
window.addEventListener('scroll', positionMenu, true)
window.addEventListener('resize', positionMenu)

const observer = new MutationObserver(scheduleDetection)
observer.observe(document.documentElement, { childList: true, subtree: true })

injectMainWorldScript()

void send<ContentContext | null>({ type: 'CONTENT_CONTEXT' })
  .then((value) => {
    if (!value || !Number.isInteger(value.tabId) || !value.host) return
    context = value
    scheduleDetection()
  })
  .catch(() => undefined)

window.addEventListener('pagehide', () => {
  observer.disconnect()
  removeMenu()
})
