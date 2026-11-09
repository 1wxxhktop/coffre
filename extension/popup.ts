import { hostFromUrl, type ExtensionLoginSummary } from '../src/lib/extensionProtocol'
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
  generatedEntropy,
  type PasswordOptions,
} from '../src/lib/password'
import { detailsNotice, renderLoginDetails, type LoginDetails } from './details'
import { localizeDocument, t } from './i18n'
import { mountLogos } from './logo'
import { loadTheme, nextTheme, saveTheme, type ThemePreference } from './theme'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

localizeDocument()
mountLogos()

interface AppStatus {
  appOpen: boolean
  unlocked: boolean
  paired?: boolean
  hostAccess?: boolean
  mode?: 'native' | 'tab'
  tabId?: number
  appUrl: string
}

interface SearchResponse {
  items?: ExtensionLoginSummary[]
  error?: string
}

interface FillResponse {
  ok?: boolean
  filled?: number
  error?: string
}

interface DetailsResponse {
  details?: LoginDetails
  error?: string
}

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Élément ${id} absent`)
  return element as T
}

const site = $<HTMLParagraphElement>('site')
const message = $<HTMLParagraphElement>('message')
const searchWrap = $<HTMLDivElement>('search-wrap')
const searchInput = $<HTMLInputElement>('search')
const generateButton = $<HTMLButtonElement>('generate')
const generatorPanel = $<HTMLElement>('generator')
const generatedPassword = $<HTMLOutputElement>('generated-password')
const regenerateButton = $<HTMLButtonElement>('regenerate')
const copyGeneratedButton = $<HTMLButtonElement>('copy-generated')
const generatorCloseButton = $<HTMLButtonElement>('generator-close')
const generatorLengthInput = $<HTMLInputElement>('generator-length')
const generatorLengthValue = $<HTMLElement>('generator-length-value')
const generatorEntropy = $<HTMLElement>('generator-entropy')
const generatorLowercaseInput = $<HTMLInputElement>('generator-lowercase')
const generatorUppercaseInput = $<HTMLInputElement>('generator-uppercase')
const generatorDigitsInput = $<HTMLInputElement>('generator-digits')
const generatorSymbolsInput = $<HTMLInputElement>('generator-symbols')
const generatorAmbiguousInput = $<HTMLInputElement>('generator-ambiguous')

const generatorClassToggles = [
  { input: generatorLowercaseInput, key: 'lowercase' as const },
  { input: generatorUppercaseInput, key: 'uppercase' as const },
  { input: generatorDigitsInput, key: 'digits' as const },
  { input: generatorSymbolsInput, key: 'symbols' as const },
]
const results = $<HTMLUListElement>('results')
const empty = $<HTMLParagraphElement>('empty')
const showAllButton = $<HTMLButtonElement>('show-all')
const actions = $<HTMLDivElement>('actions')
const mainElement = $<HTMLElement>('main')
const mainView = $<HTMLDivElement>('main-view')
const settingsView = $<HTMLElement>('settings-view')
const settingsBackButton = $<HTMLButtonElement>('settings-back')
const settingsAppUrl = $<HTMLInputElement>('settings-app-url')
const settingsSaveButton = $<HTMLButtonElement>('settings-save')
const settingsTestButton = $<HTMLButtonElement>('settings-test')
const settingsStatus = $<HTMLParagraphElement>('settings-status')
const settingsOpenAppButton = $<HTMLButtonElement>('settings-open-app')
const themeChoices = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]'),
)
const pairButton = $<HTMLButtonElement>('pair')
const activateInlineButton = $<HTMLButtonElement>('activate-inline')
const savePrompt = $<HTMLDivElement>('save-prompt')
const saveText = $<HTMLParagraphElement>('save-text')
const saveNowButton = $<HTMLButtonElement>('save-now')
const saveIgnoreButton = $<HTMLButtonElement>('save-ignore')
const openAppButton = $<HTMLButtonElement>('open-app')
const focusAppButton = $<HTMLButtonElement>('focus-app')
const settingsButton = $<HTMLButtonElement>('settings')
const themeButton = $<HTMLButtonElement>('theme')
const themeIcon = $<HTMLSpanElement>('theme-icon')
const footerStatus = $<HTMLSpanElement>('footer-status')
const bottomDock = $<HTMLDivElement>('bottom-dock')
const inlineStatusDot = $<HTMLSpanElement>('inline-status-dot')

let currentTab: chrome.tabs.Tab | null = null
let status: AppStatus = { appOpen: false, unlocked: false, appUrl: '' }
let entries: ExtensionLoginSummary[] = []
let generatedValue = ''
let passwordOptions: PasswordOptions = { ...DEFAULT_PASSWORD_OPTIONS }
let generatorOptionsLoaded = false
let busy = false
let searchTimer: number | undefined
let searchListenerReady = false
let themePreference: ThemePreference = 'system'
let themeInitialized = false
let settingsOpen = false
let inlineReady = false

const THEME_ICONS: Record<ThemePreference, string> = {
  system:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>',
  light:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>',
  dark:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5z"/></svg>',
}

const FILL_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13"/><path d="m13 6 6 6-6 6"/></svg>'

const GENERATOR_OPTIONS_KEY = 'generatorOptions'

const ERROR_MESSAGES: Record<string, string> = {
  'app-closed': 'error_appClosed',
  locked: 'error_locked',
  'needs-pairing': 'error_needsPairing',
  'pair-rejected': 'error_pairRejected',
  'pair-protocol': 'error_pairProtocol',
  'domain-mismatch': 'error_domainMismatch',
  permission: 'error_permission',
  'no-fields': 'error_noFields',
  'no-tab': 'error_noTab',
  'not-found': 'error_notFound',
  'invalid-url': 'error_invalidUrl',
  'native-timeout': 'error_nativeTimeout',
  'native-unavailable': 'error_nativeUnavailable',
}

function send<T>(payload: Record<string, unknown>): Promise<T> {
  return api.runtime.sendMessage(payload) as Promise<T>
}

function showMessage(text: string, kind: 'info' | 'error' | 'success' = 'info') {
  message.hidden = false
  message.textContent = text
  message.className = kind === 'info' ? 'message' : `message message--${kind}`
}

function hideMessage() {
  message.hidden = true
  message.textContent = ''
}

function errorText(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code] && t(ERROR_MESSAGES[code])) || t('error_generic')
}

function setBusy(value: boolean) {
  busy = value
  for (const button of results.querySelectorAll('button')) {
    button.disabled = value
  }
}

function renderThemeChoices(): void {
  for (const button of themeChoices) {
    const active = button.dataset.themeChoice === themePreference
    button.classList.toggle('theme-choice--active', active)
    button.setAttribute('aria-pressed', String(active))
  }
}

function renderTheme(): void {
  const label = t(`theme_${themePreference}`)
  themeButton.title = `${t('theme_toggle')} — ${label}`
  themeButton.setAttribute('aria-label', themeButton.title)
  themeIcon.innerHTML = THEME_ICONS[themePreference]
  renderThemeChoices()
}

async function initTheme(): Promise<void> {
  if (themeInitialized) return
  themeInitialized = true
  themePreference = await loadTheme()
  renderTheme()
}

function updateDockHeight(): void {
  const height = Math.ceil(bottomDock.getBoundingClientRect().height)
  document.documentElement.style.setProperty('--dock-height', `${height}px`)
}

function normalizeAppUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function setSettingsStatus(text: string, tone: 'info' | 'ok' | 'error' = 'info'): void {
  settingsStatus.textContent = text
  settingsStatus.className =
    tone === 'info' ? 'settings-status' : `settings-status settings-status--${tone}`
}

async function loadSettings(): Promise<void> {
  try {
    const response = await send<{ appUrl: string }>({ type: 'GET_APP_URL' })
    settingsAppUrl.value = response.appUrl
  } catch {
    settingsAppUrl.value = status.appUrl || ''
  }
}

function openSettings(): void {
  settingsOpen = true
  mainView.hidden = true
  settingsView.hidden = false
  setSettingsStatus('')
  renderThemeChoices()
  void loadSettings()
  updateDockHeight()
}

function closeSettings(): void {
  settingsOpen = false
  settingsView.hidden = true
  mainView.hidden = false
  updateDockHeight()
  void init()
}

async function saveSettings(): Promise<void> {
  const value = normalizeAppUrl(settingsAppUrl.value)
  if (!value) {
    setSettingsStatus(t('settings_invalid'), 'error')
    return
  }

  settingsSaveButton.disabled = true
  try {
    // Enregistrer l’adresse immédiatement : si le navigateur ferme le popup
    // pendant la demande de permission, le réglage est déjà persisté.
    const savePromise = send<{ ok?: boolean; appUrl?: string; error?: string }>({
      type: 'SET_APP_URL',
      appUrl: value,
    })
    const permissionGranted = await requestHostPermission([`${value}/*`])
    const saved = await savePromise
    if (!saved.ok) {
      setSettingsStatus(t('settings_saveError'), 'error')
      return
    }
    settingsAppUrl.value = saved.appUrl ?? value
    setSettingsStatus(
      permissionGranted === false
        ? t('settings_savedNoPermission')
        : t('settings_saved'),
      permissionGranted === false ? 'info' : 'ok',
    )
    await refreshStatus()
  } catch {
    setSettingsStatus(t('settings_saveError'), 'error')
  } finally {
    settingsSaveButton.disabled = false
  }
}

async function testSettings(): Promise<void> {
  settingsTestButton.disabled = true
  try {
    const response = await send<AppStatus>({ type: 'GET_STATUS' })
    if (response.mode === 'native') {
      if (!response.unlocked) setSettingsStatus(t('settings_status_locked'), 'error')
      else if (response.paired === false) {
        setSettingsStatus(t('settings_status_pair'), 'error')
      } else {
        setSettingsStatus(t('settings_status_native'), 'ok')
      }
    } else if (!response.appOpen) {
      setSettingsStatus(t('settings_status_closed'), 'error')
    } else if (!response.unlocked) {
      setSettingsStatus(t('settings_status_locked'), 'error')
    } else {
      setSettingsStatus(t('settings_status_ready'), 'ok')
    }
    await refreshStatus()
  } catch {
    setSettingsStatus(t('error_generic'), 'error')
  } finally {
    settingsTestButton.disabled = false
  }
}

function renderStatus() {
  actions.hidden = true
  pairButton.hidden = true
  activateInlineButton.hidden = true
  focusAppButton.hidden = true
  inlineStatusDot.hidden = true
  searchWrap.hidden = false
  searchInput.disabled = true
  results.replaceChildren()
  empty.hidden = true
  showAllButton.hidden = true

  if (status.mode === 'native' && !status.unlocked) {
    showMessage('Coffre est verrouillé. Déverrouillez l’application pour continuer.')
    actions.hidden = false
    openAppButton.hidden = true
    focusAppButton.hidden = false
    footerStatus.textContent = 'Coffre desktop verrouillé'
    return
  }

  if (status.mode === 'native' && status.paired === false) {
    showMessage(
      'Associez cette extension à Coffre : le code s’affichera ici et dans l’application.',
    )
    actions.hidden = false
    pairButton.hidden = false
    openAppButton.hidden = true
    footerStatus.textContent = 'Coffre desktop · non associé'
    return
  }

  if (!status.appOpen) {
    showMessage('Ouvrez Coffre pour remplir vos identifiants.')
    actions.hidden = false
    openAppButton.hidden = false
    footerStatus.textContent = 'Coffre n’est pas ouvert'
    return
  }

  if (!status.unlocked) {
    showMessage('Coffre est verrouillé. Déverrouillez-le dans son onglet.')
    actions.hidden = false
    openAppButton.hidden = true
    focusAppButton.hidden = false
    footerStatus.textContent =
      status.mode === 'native' ? 'Coffre desktop verrouillé' : 'Coffre verrouillé'
    return
  }

  searchWrap.hidden = false
  searchInput.disabled = false
  if (status.hostAccess === false && !inlineReady) {
    showMessage(
      'Activez le remplissage dans les champs pour remplir les formulaires directement.',
      'info',
    )
  } else {
    hideMessage()
  }
  actions.hidden = inlineReady
  openAppButton.hidden = true
  activateInlineButton.hidden = inlineReady
  inlineStatusDot.hidden = !inlineReady
  footerStatus.textContent =
    status.mode === 'native'
      ? 'Coffre desktop · pont natif local'
      : 'Coffre déverrouillé · local'
}

async function toggleDetails(
  entry: ExtensionLoginSummary,
  row: HTMLLIElement,
  panel: HTMLDivElement,
  toggle: HTMLButtonElement,
): Promise<void> {
  const expanded = row.dataset.expanded === 'true'
  if (expanded) {
    row.dataset.expanded = 'false'
    toggle.setAttribute('aria-expanded', 'false')
    panel.hidden = true
    return
  }

  row.dataset.expanded = 'true'
  toggle.setAttribute('aria-expanded', 'true')
  panel.hidden = false
  panel.replaceChildren(detailsNotice(t('details_loading')))

  const host = currentTab?.url ? hostFromUrl(currentTab.url) : ''
  if (!host) {
    panel.replaceChildren(detailsNotice(t('details_error')))
    return
  }

  try {
    const response = await send<DetailsResponse>({
      type: 'DETAILS',
      itemId: entry.id,
      host,
    })
    if (panel.hidden) return
    if (response.error || !response.details) {
      panel.replaceChildren(detailsNotice(t('details_error')))
      return
    }
    renderLoginDetails(panel, response.details, () => {
      void fillEntry(entry.id)
    })
  } catch {
    if (!panel.hidden) panel.replaceChildren(detailsNotice(t('details_error')))
  }
}

function renderResults() {
  results.replaceChildren()
  empty.hidden = entries.length > 0

  for (const entry of entries) {
    const item = document.createElement('li')
    item.className = 'result'
    item.dataset.expanded = 'false'

    const head = document.createElement('div')
    head.className = 'result__head'

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'result__toggle'
    toggle.setAttribute('aria-expanded', 'false')
    toggle.title = t('details_expand')
    toggle.setAttribute('aria-label', `${t('details_expand')} — ${entry.title}`)

    const icon = document.createElement('span')
    icon.className = 'result__icon'
    icon.textContent = (entry.title.trim()[0] ?? '?').toUpperCase()

    const text = document.createElement('div')
    text.className = 'result__text'
    const title = document.createElement('div')
    title.className = 'result__title'
    title.textContent = entry.title
    title.title = entry.title
    const sub = document.createElement('div')
    sub.className = 'result__sub'
    sub.textContent = entry.username || entry.host || t('menu_noLogin')
    sub.title = sub.textContent
    text.append(title, sub)

    const chevron = document.createElement('span')
    chevron.className = 'result__chevron'
    chevron.setAttribute('aria-hidden', 'true')
    chevron.textContent = '›'

    toggle.append(icon, text, chevron)

    const fillButton = document.createElement('button')
    fillButton.type = 'button'
    fillButton.className = 'button button--primary result__fill'
    fillButton.title = t('details_fill')
    fillButton.setAttribute('aria-label', `${t('details_fill')} — ${entry.title}`)
    fillButton.innerHTML = FILL_ICON
    const fillLabel = document.createElement('span')
    fillLabel.className = 'result__fill-label'
    fillLabel.textContent = t('details_fill')
    fillButton.append(fillLabel)
    fillButton.addEventListener('click', () => void fillEntry(entry.id))

    head.append(toggle, fillButton)

    const details = document.createElement('div')
    details.className = 'result__details'
    details.hidden = true
    details.setAttribute('aria-live', 'polite')

    toggle.addEventListener('click', () => {
      void toggleDetails(entry, item, details, toggle)
    })

    item.append(head, details)
    results.append(item)
  }
}

async function refreshPendingSave(): Promise<void> {
  if (!currentTab?.id) {
    savePrompt.hidden = true
    saveNowButton.textContent = t('popup_save')
    return
  }
  try {
    const response = await send<{
      pending?: { username: string; host: string; update?: boolean } | null
    }>({ type: 'GET_PENDING_SAVE', tabId: currentTab.id })
    if (!response.pending) {
      savePrompt.hidden = true
      saveNowButton.textContent = t('popup_save')
      return
    }
    const label =
      response.pending.username || t('menu_noLogin')
    const update = response.pending.update === true
    saveText.textContent = t(
      update ? 'popup_updatePrompt' : 'popup_savePrompt',
      [label, response.pending.host],
    )
    saveNowButton.textContent = update ? t('popup_update') : t('popup_save')
    savePrompt.hidden = false
  } catch {
    savePrompt.hidden = true
    saveNowButton.textContent = t('popup_save')
  }
}

async function detectInlineReady(): Promise<boolean> {
  if (!currentTab?.id || !currentTab.url) return false
  if (!/^https?:/i.test(currentTab.url)) return false
  try {
    const response = (await api.tabs.sendMessage(currentTab.id, {
      type: 'COFFRE_PING',
    })) as { ok?: boolean } | undefined
    return response?.ok === true
  } catch {
    return false
  }
}

async function refreshStatus(): Promise<boolean> {
  status = await send<AppStatus>({ type: 'GET_STATUS' })
  inlineReady = status.unlocked ? await detectInlineReady() : false
  renderStatus()
  return (
    status.appOpen &&
    status.unlocked &&
    (status.mode !== 'native' || status.paired !== false)
  )
}

async function loadResults(query: string) {
  const response = await send<SearchResponse>({ type: 'SEARCH', query })
  if (response.error) {
    showMessage(errorText(response.error), 'error')
    await refreshStatus()
    return
  }
  entries = response.items ?? []
  renderResults()
  mainElement.scrollTop = 0
  showAllButton.hidden = true

  if (entries.length === 0 && query) {
    empty.textContent = 'Aucun identifiant pour ce site.'
    empty.hidden = false
    showAllButton.hidden = false
  } else if (entries.length === 0) {
    empty.textContent = 'Aucune connexion dans le coffre.'
    empty.hidden = false
  }
}

async function loadAll() {
  const response = await send<SearchResponse>({ type: 'SEARCH', query: '' })
  entries = response.items ?? []
  renderResults()
  mainElement.scrollTop = 0
  showAllButton.hidden = true
  empty.textContent =
    entries.length > 0 ? 'Toutes vos connexions :' : 'Aucune connexion dans le coffre.'
  empty.hidden = false
}

async function fillEntry(itemId: string) {
  if (busy) return
  setBusy(true)
  hideMessage()
  try {
    const response = await send<FillResponse>({
      type: 'FILL',
      itemId,
      tabId: currentTab?.id,
    })
    if (response.ok) {
      showMessage('Identifiants remplis dans la page.', 'success')
      window.setTimeout(() => window.close(), 700)
    } else {
      showMessage(errorText(response.error), 'error')
    }
  } finally {
    setBusy(false)
  }
}

function sanitizePasswordOptions(value: unknown): PasswordOptions {
  const source =
    value && typeof value === 'object' ? (value as Partial<PasswordOptions>) : {}
  const rawLength = Number(source.length)
  const options: PasswordOptions = {
    length: Number.isFinite(rawLength)
      ? Math.min(64, Math.max(8, Math.round(rawLength)))
      : DEFAULT_PASSWORD_OPTIONS.length,
    lowercase: source.lowercase !== false,
    uppercase: source.uppercase !== false,
    digits: source.digits !== false,
    symbols: source.symbols !== false,
    excludeAmbiguous: source.excludeAmbiguous !== false,
  }
  if (
    !options.lowercase &&
    !options.uppercase &&
    !options.digits &&
    !options.symbols
  ) {
    options.lowercase = true
  }
  return options
}

function syncGeneratorToggleStates(): void {
  const active = generatorClassToggles.filter(({ input }) => input.checked)
  for (const { input } of generatorClassToggles) {
    input.disabled = input.checked && active.length === 1
    input
      .closest('label')
      ?.classList.toggle('generator__toggle--active', input.checked)
  }
  generatorAmbiguousInput
    .closest('label')
    ?.classList.toggle(
      'generator__toggle--active',
      generatorAmbiguousInput.checked,
    )
}

function syncGeneratorControls(): void {
  generatorLengthInput.value = String(passwordOptions.length)
  generatorLengthValue.textContent = String(passwordOptions.length)
  generatorLowercaseInput.checked = passwordOptions.lowercase
  generatorUppercaseInput.checked = passwordOptions.uppercase
  generatorDigitsInput.checked = passwordOptions.digits
  generatorSymbolsInput.checked = passwordOptions.symbols
  generatorAmbiguousInput.checked = passwordOptions.excludeAmbiguous
  syncGeneratorToggleStates()
}

function readGeneratorControls(): void {
  const rawLength = Number(generatorLengthInput.value)
  passwordOptions = {
    length: Number.isFinite(rawLength)
      ? Math.min(64, Math.max(8, Math.round(rawLength)))
      : DEFAULT_PASSWORD_OPTIONS.length,
    lowercase: generatorLowercaseInput.checked,
    uppercase: generatorUppercaseInput.checked,
    digits: generatorDigitsInput.checked,
    symbols: generatorSymbolsInput.checked,
    excludeAmbiguous: generatorAmbiguousInput.checked,
  }
  if (
    !passwordOptions.lowercase &&
    !passwordOptions.uppercase &&
    !passwordOptions.digits &&
    !passwordOptions.symbols
  ) {
    passwordOptions.lowercase = true
  }
  syncGeneratorControls()
}

function saveGeneratorOptions(): void {
  void (async () => {
    try {
      await api.storage.local.set({
        [GENERATOR_OPTIONS_KEY]: passwordOptions,
      })
    } catch {
      // Stockage indisponible : les options restent valables pour la session.
    }
  })()
}

async function loadGeneratorOptions(): Promise<void> {
  if (generatorOptionsLoaded) return
  generatorOptionsLoaded = true
  try {
    const stored = await api.storage.local.get(GENERATOR_OPTIONS_KEY)
    passwordOptions = sanitizePasswordOptions(stored[GENERATOR_OPTIONS_KEY])
  } catch {
    passwordOptions = { ...DEFAULT_PASSWORD_OPTIONS }
  }
  syncGeneratorControls()
}

function regeneratePassword(): void {
  try {
    generatedValue = generatePassword(passwordOptions)
    generatedPassword.textContent = generatedValue
    generatorEntropy.textContent = `${generatedEntropy(passwordOptions)} bits`
  } catch {
    generatedValue = ''
    generatedPassword.textContent = ''
    generatorEntropy.textContent = '—'
    showMessage(t('error_generic'), 'error')
  }
}

function updateGeneratorOptions(save: boolean): void {
  readGeneratorControls()
  if (save) saveGeneratorOptions()
  regeneratePassword()
}

async function openGenerator(): Promise<void> {
  await loadGeneratorOptions()
  generatorPanel.hidden = false
  mainElement.scrollTop = 0
  regeneratePassword()
}

async function copyGeneratedPassword(): Promise<void> {
  if (!generatedValue) return
  try {
    await navigator.clipboard.writeText(generatedValue)
    showMessage(t('popup_copied'), 'success')
  } catch {
    showMessage(t('error_generic'), 'error')
  }
}

async function init() {
  await initTheme()
  const [tab] = await api.tabs.query({ active: true, currentWindow: true })
  currentTab = tab ?? null
  const host = currentTab?.url ? hostFromUrl(currentTab.url) : ''
  site.textContent = host || 'Page non prise en charge'
  searchInput.placeholder = host
    ? `Rechercher pour ${host}…`
    : 'Rechercher un identifiant…'

  const unlocked = await refreshStatus()
  await refreshPendingSave()
  if (!unlocked) return

  const query = host || ''
  await loadResults(query)
  searchInput.value = query
  if (!settingsOpen) searchInput.focus({ preventScroll: true })

  if (!searchListenerReady) {
    searchListenerReady = true
    searchInput.addEventListener('input', () => {
      window.clearTimeout(searchTimer)
      searchTimer = window.setTimeout(() => {
        void loadResults(searchInput.value.trim())
      }, 150)
    })
  }
}

generateButton.addEventListener('click', () => {
  if (generatorPanel.hidden) void openGenerator()
  else generatorPanel.hidden = true
})

generatorCloseButton.addEventListener('click', () => {
  generatorPanel.hidden = true
})

regenerateButton.addEventListener('click', regeneratePassword)
generatorLengthInput.addEventListener('input', () => {
  updateGeneratorOptions(false)
})
generatorLengthInput.addEventListener('change', () => {
  updateGeneratorOptions(true)
})
for (const { input } of generatorClassToggles) {
  input.addEventListener('change', () => {
    updateGeneratorOptions(true)
  })
}
generatorAmbiguousInput.addEventListener('change', () => {
  updateGeneratorOptions(true)
})
copyGeneratedButton.addEventListener('click', () => {
  void copyGeneratedPassword()
})

openAppButton.addEventListener('click', () => {
  void send({ type: 'OPEN_APP' }).then(() => window.close())
})

focusAppButton.addEventListener('click', () => {
  void send({ type: 'FOCUS_APP' }).then(() => window.close())
})

async function requestHostPermission(
  origins: string[],
): Promise<boolean | null> {
  try {
    if (typeof api.permissions?.request !== 'function') return null
    return await api.permissions.request({ origins })
  } catch {
    return null
  }
}

async function injectInlineScripts(tabId: number): Promise<void> {
  let lastError: unknown = null

  try {
    await api.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    })
  } catch (error) {
    lastError = error
    try {
      await api.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      })
    } catch (secondError) {
      lastError = secondError
      const tabsApi = api.tabs as unknown as {
        executeScript?: (
          tabId: number,
          details: { file: string; allFrames?: boolean },
        ) => Promise<unknown> | void
      }
      if (typeof tabsApi.executeScript !== 'function') throw lastError
      await tabsApi.executeScript(tabId, {
        file: 'content.js',
        allFrames: true,
      })
    }
  }

  try {
    await api.scripting.executeScript({
      target: { tabId },
      files: ['webauthn-main.js'],
      world: 'MAIN',
    })
  } catch {
    // Le content script injecte le script de repli si `world` manque.
  }

  const ready = (await api.tabs
    .sendMessage(tabId, { type: 'COFFRE_PING' })
    .catch(() => null)) as { ok?: boolean } | null
  if (!ready?.ok) throw lastError ?? new Error('content script indisponible')
}

activateInlineButton.addEventListener('click', () => {
  if (busy) return
  void (async () => {
    activateInlineButton.disabled = true
    let granted: boolean | null = null
    try {
      granted = await requestHostPermission(['http://*/*', 'https://*/*'])
      try {
        await send({ type: 'ENABLE_INLINE' })
      } catch {
        // Orion/WebKit : l’enregistrement dynamique peut échouer ; l’injection
        // manuelle dans l’onglet courant reste tentée ci-dessous.
      }
      const [tab] = await api.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('onglet actif introuvable')
      await injectInlineScripts(tab.id)
      await init()
      showMessage('Remplissage dans les champs activé. Rechargez les autres onglets.', 'success')
    } catch (error) {
      console.error('Activation du remplissage impossible', error)
      showMessage(
        granted === false
          ? 'Permission refusée pour le remplissage dans les champs.'
          : 'Activation impossible sur cette page.',
        'error',
      )
    } finally {
      activateInlineButton.disabled = false
    }
  })()
})

pairButton.addEventListener('click', () => {
  if (busy) return
  setBusy(true)
  pairButton.disabled = true
  showMessage('Demande envoyée. Confirmez le code affiché dans Coffre.')
  void send<{ ok?: boolean; error?: string }>({ type: 'PAIR' })
    .then(async (response) => {
      pairButton.disabled = false
      setBusy(false)
      if (!response.ok) {
        showMessage(errorText(response.error), 'error')
        return
      }
      showMessage('Extension associée à Coffre.', 'success')
      await init()
    })
    .catch(() => {
      pairButton.disabled = false
      setBusy(false)
      showMessage('Association impossible.', 'error')
    })
})

api.runtime.onMessage.addListener((message: unknown) => {
  if (
    message &&
    typeof message === 'object' &&
    (message as { type?: string }).type === 'PAIRING_CODE' &&
    typeof (message as { code?: unknown }).code === 'string'
  ) {
    showMessage(
      `Code ${(message as { code: string }).code} — confirmez-le dans Coffre.`,
      'info',
    )
  }
  return false
})

saveNowButton.addEventListener('click', () => {
  if (!currentTab?.id) return
  saveNowButton.disabled = true
  void send<{ ok?: boolean; updated?: boolean; error?: string }>({
    type: 'SAVE_PENDING_NOW',
    tabId: currentTab.id,
  })
    .then((response) => {
      savePrompt.hidden = true
      if (response.ok) {
        showMessage(
          response.updated ? 'Mot de passe mis à jour.' : 'Identifiant enregistré.',
          'success',
        )
      } else {
        showMessage(errorText(response.error), 'error')
      }
    })
    .finally(() => {
      saveNowButton.disabled = false
    })
})

saveIgnoreButton.addEventListener('click', () => {
  if (!currentTab?.id) return
  void send({ type: 'SAVE_DISMISS_PENDING', tabId: currentTab.id })
  savePrompt.hidden = true
})

settingsButton.addEventListener('click', () => {
  if (settingsOpen) closeSettings()
  else openSettings()
})

settingsBackButton.addEventListener('click', () => {
  closeSettings()
})

settingsSaveButton.addEventListener('click', () => {
  void saveSettings()
})

settingsTestButton.addEventListener('click', () => {
  void testSettings()
})

settingsOpenAppButton.addEventListener('click', () => {
  void send({ type: 'OPEN_APP' }).then(() => window.close())
})

for (const button of themeChoices) {
  button.addEventListener('click', () => {
    const value = button.dataset.themeChoice
    if (value !== 'dark' && value !== 'light' && value !== 'system') return
    themePreference = value
    void saveTheme(value)
    renderTheme()
  })
}

themeButton.addEventListener('click', () => {
  themePreference = nextTheme(themePreference)
  void saveTheme(themePreference)
  renderTheme()
})

showAllButton.addEventListener('click', () => {
  void loadAll()
})

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return
  }
  if (settingsOpen || searchInput.disabled || searchWrap.hidden) return
  const target = event.target
  if (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable="true"]')
  ) {
    return
  }
  if (event.key.length !== 1 || event.key === ' ') return

  searchInput.focus()
  searchInput.value = event.key
  event.preventDefault()
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    void loadResults(searchInput.value.trim())
  }, 150)
})

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(updateDockHeight).observe(bottomDock)
} else {
  window.addEventListener('resize', updateDockHeight)
}
updateDockHeight()

void init()
