/**
 * Content script isolé : détecte les formulaires, affiche le menu dans une
 * iframe d’extension et remplit les champs après un clic utilisateur.
 *
 * Le menu vit dans une iframe d’origine `chrome-extension://` placée dans un
 * shadow root fermé. La page ne peut ni lire son contenu ni envoyer de messages
 * valides : le content script vérifie `event.source` et `event.origin`.
 */

import {
  detectAutofillFields,
  detectCardFields,
  detectIdentityFields,
  detectLoginFields,
  detectSignupFields,
  fillDetectedCard,
  fillDetectedIdentity,
  fillDetectedLogin,
  fillFieldsByLabel,
  fillOtpField,
  fillPasswordField,
  fillSignupPasswords,
  canFillCard,
  isVisible,
  readCardValues,
  readIdentityValues,
  type DetectedAutofill,
} from './detect'
import { hostFromUrl, hostMatches } from '../src/lib/extensionProtocol'
import { submitLoginForm } from './loginSubmit'
import { loadSettings } from './settings'
import { isSiteExcluded } from './siteExclusions'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome
const MENU_ORIGIN = new URL(api.runtime.getURL('menu.html')).origin

/** Jeton imprévisible liant un menu à son onglet et à son cadre. */
function menuToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Le script du monde MAIN peut ainsi vérifier que le relais est déjà à
// l’écoute avant d’intercepter une requête WebAuthn très précoce.
document.documentElement.setAttribute('data-coffre-webauthn-ready', '')

interface ContentContext {
  tabId: number
  frameId: number
  host: string
  topHost: string
  url: string
}

type AutofillKind = 'login' | 'card' | 'identity'

interface MenuHandle {
  host: HTMLDivElement
  iframe: HTMLIFrameElement
  mode: 'badge' | 'save' | 'open'
  kind: AutofillKind
  signup: boolean
  anchor: HTMLInputElement
  width: number
  height: number
}

interface SaveBannerHandle {
  host: HTMLDivElement
  iframe: HTMLIFrameElement
  offerId: string
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
let saveBanner: SaveBannerHandle | null = null
let lastFocusedInput: HTMLInputElement | null = null
let detectTimer: number | undefined
let dismissedUntil = 0
let inlineMenuEnabled = true
let saveBannerEnabled = true
let neverFillSites: string[] = []
let neverSaveSites: string[] = []
const dismissedBanners = new Set<string>()

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
  const availableWidth = Math.max(40, window.innerWidth - 16)
  const availableHeight = Math.max(40, window.innerHeight - 16)
  const boundedWidth = Math.min(360, availableWidth, Math.max(40, width))
  const boundedHeight = Math.min(520, availableHeight, Math.max(40, height))
  menu.width = boundedWidth
  menu.height = boundedHeight
  menu.host.style.width = `${boundedWidth}px`
  menu.host.style.height = `${boundedHeight}px`
  positionMenu()
}

function isTopFrame(): boolean {
  try {
    return window.top === window
  } catch {
    return false
  }
}

function removeSaveBanner(): void {
  if (!saveBanner) return
  saveBanner.host.remove()
  saveBanner = null
}

function positionSaveBanner(): void {
  if (!saveBanner) return
  const margin = 12
  const width = Math.min(saveBanner.width, Math.max(40, window.innerWidth - margin * 2))
  saveBanner.host.style.width = `${width}px`
  saveBanner.host.style.left = `${Math.max(margin, window.innerWidth - width - margin)}px`
  saveBanner.host.style.top = `${margin}px`
}

function setSaveBannerSize(width: number, height: number): void {
  if (!saveBanner) return
  saveBanner.width = Math.max(40, Math.min(420, Number(width) || 380))
  saveBanner.height = Math.max(40, Math.min(480, Number(height) || 200))
  saveBanner.host.style.height = `${saveBanner.height}px`
  positionSaveBanner()
}

/**
 * Bandeau d’enregistrement dans une iframe d’origine extension, placée dans un
 * shadow root fermé. La page ne reçoit que l’identifiant opaque de l’offre.
 */
function showSaveBanner(offerId: string): void {
  if (
    !context ||
    !isTopFrame() ||
    !saveBannerEnabled ||
    saveBlocked() ||
    dismissedBanners.has(offerId)
  ) {
    return
  }
  if (saveBanner?.offerId === offerId) return
  removeSaveBanner()

  const host = document.createElement('div')
  host.setAttribute('data-coffre-save-banner', '')
  host.style.cssText = [
    'all: initial',
    'position: fixed',
    'z-index: 2147483647',
    'width: 380px',
    'height: 210px',
    'border: 0',
    'padding: 0',
    'margin: 0',
    'background: transparent',
    'color-scheme: light dark',
    'pointer-events: auto',
  ].join(';')

  const shadow = host.attachShadow({ mode: 'closed' })
  const iframe = document.createElement('iframe')
  iframe.title = 'Coffre'
  iframe.setAttribute('allowtransparency', 'true')
  iframe.referrerPolicy = 'no-referrer'
  iframe.style.cssText =
    'width:100%;height:100%;border:0;padding:0;margin:0;background:transparent;color-scheme:light dark;'
  const url = new URL(api.runtime.getURL('save-banner.html'))
  url.searchParams.set('offer', offerId)
  iframe.src = url.toString()
  iframe.addEventListener('error', removeSaveBanner)
  shadow.append(iframe)
  document.documentElement.append(host)

  saveBanner = { host, iframe, offerId, width: 380, height: 210 }
  positionSaveBanner()
}

async function refreshSaveBanner(): Promise<void> {
  if (!context || !isTopFrame() || !saveBannerEnabled || saveBlocked()) {
    removeSaveBanner()
    return
  }
  try {
    const response = await send<{ offer?: { id?: string } | null }>({
      type: 'GET_PENDING_BANNER',
    })
    const offerId =
      typeof response?.offer?.id === 'string' ? response.offer.id : ''
    if (offerId) showSaveBanner(offerId)
    else removeSaveBanner()
  } catch {
    // Le service worker peut être indisponible pendant une navigation.
  }
}

function commandKind(value: unknown): AutofillKind {
  return value === 'card' || value === 'identity' ? value : 'login'
}

function fillActiveText(value: string): number {
  if (!value) return 0
  const active = document.activeElement
  const target =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.isContentEditable)
      ? active
      : lastFocusedInput
  if (!target) return 0

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const prototype =
      target instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(target, value)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    target.focus()
    return 1
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    target.textContent = value
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.focus()
    return 1
  }
  return 0
}

function openMenuAtActiveField(kind: AutofillKind): boolean {
  if (!context || fillBlocked()) return false
  const detected = detectAutofillFields(document)
  const anchor =
    lastFocusedInput && isVisible(lastFocusedInput)
      ? lastFocusedInput
      : detected?.anchor
  if (!anchor) return false
  const detectedKind =
    detected?.kind === 'card' || detected?.kind === 'identity'
      ? detected.kind
      : 'login'
  showMenu(anchor, kind || detectedKind, 'open', detected?.kind === 'signup')
  return true
}

function showMenu(
  anchor: HTMLInputElement,
  kind: AutofillKind,
  mode: 'badge' | 'save' | 'open' = 'badge',
  signup = false,
): void {
  if (!context || fillBlocked()) return
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
  url.searchParams.set('top', context.topHost)
  url.searchParams.set('url', location.href.slice(0, 2048))
  url.searchParams.set('kind', kind)
  url.searchParams.set('mode', mode)
  if (signup) url.searchParams.set('signup', '1')
  const token = menuToken()
  url.searchParams.set('token', token)
  // Le menu ne peut agir que si son jeton est enregistré pour cet onglet.
  // On attend l’enregistrement avant de charger l’iframe pour éviter que le
  // menu n’envoie sa première requête avant que le jeton soit connu.
  void api.runtime
    .sendMessage({
      type: 'MENU_REGISTER',
      token,
      tabId: context.tabId,
      frameId: context.frameId,
      host: context.host,
      topHost: context.topHost,
      url: location.href.slice(0, 2048),
      kind,
      mode,
    })
    .catch(() => undefined)
    .finally(() => {
      if (iframe.isConnected) iframe.src = url.toString()
    })
  shadow.append(iframe)
  const initialWidth =
    mode === 'badge' ? 40 : Math.min(340, Math.max(40, window.innerWidth - 16))
  const initialHeight =
    mode === 'badge' ? 40 : Math.min(430, Math.max(40, window.innerHeight - 16))
  host.style.width = `${initialWidth}px`
  host.style.height = `${initialHeight}px`
  document.documentElement.append(host)

  menu = {
    host,
    iframe,
    mode,
    kind,
    signup,
    anchor,
    width: initialWidth,
    height: initialHeight,
  }
  positionMenu()
}

function refreshDetection(): void {
  if (!inlineMenuEnabled || fillBlocked() || Date.now() < dismissedUntil) {
    if (fillBlocked()) removeMenu()
    return
  }
  const detected = detectAutofillFields(document)
  if (!detected) {
    removeMenu()
    return
  }
  const kind = detected.kind === 'signup' ? 'login' : detected.kind
  const signup = detected.kind === 'signup'
  if (menu && menu.mode === 'badge') {
    if (menu.kind !== kind || menu.signup !== signup) {
      removeMenu()
      showMenu(detected.anchor, kind, 'badge', signup)
      return
    }
    menu.anchor = detected.anchor
    positionMenu()
  } else if (!menu) {
    showMenu(detected.anchor, kind, 'badge', signup)
  }
}

function scheduleDetection() {
  window.clearTimeout(detectTimer)
  detectTimer = window.setTimeout(refreshDetection, 250)
}

function currentHost(): string {
  return context?.host ?? hostFromUrl(location.href)
}

function fillBlocked(): boolean {
  return isSiteExcluded(neverFillSites, currentHost())
}

function saveBlocked(): boolean {
  return isSiteExcluded(neverSaveSites, currentHost())
}

async function loadContentSettings(): Promise<void> {
  const settings = await loadSettings()
  inlineMenuEnabled = settings.inlineMenu
  saveBannerEnabled = settings.saveBanner
  neverFillSites = settings.neverFillSites
  neverSaveSites = settings.neverSaveSites
  if (!inlineMenuEnabled || fillBlocked()) removeMenu()
  else scheduleDetection()
  if (!saveBannerEnabled || saveBlocked()) removeSaveBanner()
  else void refreshSaveBanner()
}

function handleFocus(event: FocusEvent) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (
    ![
      'password',
      'text',
      'email',
      'tel',
      'number',
      'search',
      '',
    ].includes(target.type)
  ) {
    return
  }
  lastFocusedInput = target
  scheduleDetection()
}

function fieldsForSave(): DetectedAutofill | null {
  return detectAutofillFields(document)
}

function isCrossOriginFrame(): boolean {
  try {
    return window.top !== null && window.top.location.origin !== location.origin
  } catch {
    return true
  }
}

function cardFillAllowed(): boolean {
  return canFillCard(location.protocol, isCrossOriginFrame(), location.hostname)
}

function handleSubmit() {
  if (saveBlocked()) return
  const detected = fieldsForSave()
  if (!detected || !context) return
  const url = location.href
  const host = context.host
  if (detected.kind === 'signup') {
    const fields = detected.signup
    if (!fields.password.value) return
    void send<{ prompt?: boolean; offerId?: string }>({
      type: 'FORM_SUBMITTED',
      host,
      username: fields.username?.value ?? '',
      password: fields.password.value,
      url,
    })
      .then((response) => {
        if (response?.prompt && response.offerId) {
          showSaveBanner(response.offerId)
        }
      })
      .catch(() => undefined)
    return
  }
  if (detected.kind === 'login') {
    const fields = detected.login
    if (!fields.password || !fields.username || !fields.password.value) return
    void send<{ prompt?: boolean; offerId?: string }>({
      type: 'FORM_SUBMITTED',
      host,
      username: fields.username.value,
      password: fields.password.value,
      url,
    })
      .then((response) => {
        if (response?.prompt && response.offerId) {
          showSaveBanner(response.offerId)
        }
      })
      .catch(() => undefined)
    return
  }
  if (detected.kind === 'card') {
    const values = readCardValues(detected.card)
    if (!values.number) return
    void send<{ prompt?: boolean; offerId?: string }>({
      type: 'FORM_SUBMITTED',
      formKind: 'card',
      host,
      card: values,
      url,
    })
      .then((response) => {
        if (response?.prompt && response.offerId) {
          showSaveBanner(response.offerId)
        }
      })
      .catch(() => undefined)
    return
  }
  const values = readIdentityValues(detected.identity)
  if (!values.email && !values.firstName && !values.lastName && !values.fullName) {
    return
  }
  void send<{ prompt?: boolean; offerId?: string }>({
    type: 'FORM_SUBMITTED',
    formKind: 'identity',
    host,
    identity: values,
    url,
  })
    .then((response) => {
      if (response?.prompt && response.offerId) {
        showSaveBanner(response.offerId)
      }
    })
    .catch(() => undefined)
}

api.runtime.onMessage.addListener(
  (
    message: {
      type?: string
      host?: string
      kind?: string
      password?: string
      code?: string
      text?: string
      values?: {
        kind?: string
        username?: string
        password?: string
        totp?: string
        cardholder?: string
        number?: string
        expiry?: string
        cvc?: string
        pin?: string
        brand?: string
        fullName?: string
        firstName?: string
        lastName?: string
        email?: string
        phone?: string
        address?: string
        city?: string
        postalCode?: string
        country?: string
      }
    },
    _sender,
    sendResponse,
  ) => {
    if (message?.type === 'COFFRE_PING') {
      sendResponse({ ok: true })
      return
    }
    if (message?.type === 'COFFRE_REFRESH_SAVE_BANNER') {
      // Envoyé quand une proposition vient d’être créée : la page d’arrivée
      // d’une redirection a pu demander le bandeau avant qu’elle existe.
      void refreshSaveBanner()
      sendResponse({ ok: true })
      return
    }
    if (message?.type === 'COFFRE_OPEN_MENU') {
      if (fillBlocked()) {
        sendResponse({ ok: false, error: 'excluded' })
        return
      }
      const opened = openMenuAtActiveField(commandKind(message.kind))
      sendResponse(opened ? { ok: true } : { ok: false, error: 'no-fields' })
      return
    }
    if (message?.type === 'COFFRE_FILL_GENERATED') {
      if (fillBlocked()) {
        sendResponse({ ok: false, error: 'excluded' })
        return
      }
      const filled = fillPasswordField(
        document,
        typeof message.password === 'string' ? message.password : '',
      )
      sendResponse(
        filled > 0 ? { ok: true, filled } : { ok: false, error: 'no-fields' },
      )
      return
    }
    if (message?.type === 'COFFRE_FILL_TOTP') {
      if (fillBlocked()) {
        sendResponse({ ok: false, error: 'excluded' })
        return
      }
      const filled = fillOtpField(
        document,
        typeof message.code === 'string' ? message.code : '',
      )
      sendResponse(
        filled > 0 ? { ok: true, filled } : { ok: false, error: 'no-fields' },
      )
      return
    }
    if (message?.type === 'COFFRE_FILL_TEXT') {
      if (fillBlocked()) {
        sendResponse({ ok: false, error: 'excluded' })
        return
      }
      const filled = fillActiveText(
        typeof message.text === 'string' ? message.text : '',
      )
      sendResponse(
        filled > 0 ? { ok: true, filled } : { ok: false, error: 'no-fields' },
      )
      return
    }
    if (message?.type === 'COFFRE_FILL_SIGNUP') {
      if (fillBlocked()) {
        sendResponse({ ok: false, error: 'excluded' })
        return
      }
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
      const fields = detectSignupFields(document)
      if (!fields) {
        sendResponse({ ok: false, error: 'no-fields' })
        return
      }
      const filled = fillSignupPasswords(
        fields,
        typeof message.password === 'string' ? message.password : '',
      )
      sendResponse(
        filled > 0 ? { ok: true, filled } : { ok: false, error: 'no-fields' },
      )
      return
    }
    if (message?.type !== 'COFFRE_FILL_ITEM') return
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
    if (fillBlocked()) {
      sendResponse({ ok: false, error: 'excluded' })
      return
    }
    const values = message.values
    if (!values) {
      sendResponse({ ok: false, error: 'credentials' })
      return
    }

    if (values.kind === 'custom') {
      const entries = Array.isArray((values as { values?: unknown }).values)
        ? ((values as { values: Array<{ label?: unknown; value?: unknown }> }).values)
        : []
      const filled = fillFieldsByLabel(
        entries
          .map((entry) => ({
            label: typeof entry.label === 'string' ? entry.label : '',
            value: typeof entry.value === 'string' ? entry.value : '',
          }))
          .filter((entry) => entry.label && entry.value),
      )
      sendResponse(
        filled > 0 ? { ok: true, filled } : { ok: false, error: 'no-fields' },
      )
      return
    }

    if (values.kind === 'card') {
      if (!cardFillAllowed()) {
        sendResponse({ ok: false, error: 'insecure-context' })
        return
      }
      const fields = detectCardFields(document)
      if (!fields) {
        sendResponse({ ok: false, error: 'no-fields' })
        return
      }
      const filled = fillDetectedCard(
        fields,
        {
          cardholder: values.cardholder ?? '',
          number: values.number ?? '',
          expiry: values.expiry ?? '',
          cvc: values.cvc ?? '',
          pin: values.pin ?? '',
          brand: values.brand ?? '',
        },
        Boolean(values.cvc || values.pin),
      )
      sendResponse(
        filled > 0 ? { ok: true, filled } : { ok: false, error: 'no-fields' },
      )
      return
    }

    if (values.kind === 'identity') {
      const fields = detectIdentityFields(document)
      if (!fields) {
        sendResponse({ ok: false, error: 'no-fields' })
        return
      }
      const filled = fillDetectedIdentity(fields, {
        fullName: values.fullName ?? '',
        firstName: values.firstName ?? '',
        lastName: values.lastName ?? '',
        email: values.email ?? '',
        phone: values.phone ?? '',
        address: values.address ?? '',
        city: values.city ?? '',
        postalCode: values.postalCode ?? '',
        country: values.country ?? '',
      })
      sendResponse(
        filled > 0 ? { ok: true, filled } : { ok: false, error: 'no-fields' },
      )
      return
    }

    if (!values.password) {
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
    // La validation automatique n’a lieu que si l’utilisateur l’a activée.
    if (filled > 0) {
      void loadSettings().then((settings) => {
        if (settings.autoSubmitLogin) submitLoginForm()
      })
    }
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

window.addEventListener('message', (event) => {
  if (!saveBanner || event.source !== saveBanner.iframe.contentWindow) return
  if (event.origin !== MENU_ORIGIN) return
  const data = event.data as {
    type?: string
    width?: number
    height?: number
  }
  if (data?.type === 'coffre-save-banner-resize') {
    setSaveBannerSize(Number(data.width), Number(data.height))
  }
  if (data?.type === 'coffre-save-banner-close') {
    dismissedBanners.add(saveBanner.offerId)
    removeSaveBanner()
  }
  if (data?.type === 'coffre-save-banner-saved') {
    removeSaveBanner()
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
window.addEventListener('resize', positionSaveBanner)
window.addEventListener('focus', () => void refreshSaveBanner())
void loadContentSettings()
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (
    changes.inlineMenu ||
    changes.saveBanner ||
    changes.neverFillSites ||
    changes.neverSaveSites
  ) {
    void loadContentSettings()
  }
})

const observer = new MutationObserver(scheduleDetection)
observer.observe(document.documentElement, { childList: true, subtree: true })

injectMainWorldScript()

void send<ContentContext | null>({ type: 'CONTENT_CONTEXT' })
  .then((value) => {
    if (!value || !Number.isInteger(value.tabId) || !value.host) return
    context = value
    scheduleDetection()
    void refreshSaveBanner()
  })
  .catch(() => undefined)

window.addEventListener('pagehide', () => {
  observer.disconnect()
  removeMenu()
  removeSaveBanner()
})
