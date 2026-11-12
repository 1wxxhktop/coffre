import { hostFromUrl, type ExtensionLoginSummary } from '../src/lib/extensionProtocol'
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
  generatedEntropy,
  type PasswordOptions,
} from '../src/lib/password'
import { detailsNotice, renderLoginDetails, type LoginDetails } from './details'
import { localizeDocument, t } from './i18n'
import { itemIconSvg, itemInitial, stateIconSvg } from './itemIcon'
import { mountLogos } from './logo'
import { groupLogins, type PopupGroup } from './popupModel'
import {
  loadSettings as loadExtensionSettings,
  saveSettings as saveExtensionSettings,
  type ActivationMode,
} from './settings'
import { isSiteExcluded } from './siteExclusions'
import { readSelfUpdateState } from './selfUpdate'
import { loadTheme, nextTheme, saveTheme, type ThemePreference } from './theme'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

localizeDocument()
mountLogos()

// Une version plus récente attend sur le disque mais le rechargement
// automatique n’a pas suffi : l’extension vient d’un autre dossier.
void readSelfUpdateState().then((state) => {
  const notice = document.getElementById('update-notice')
  if (notice) notice.hidden = !state?.manual
})

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
const results = $<HTMLDivElement>('results')
const state = $<HTMLElement>('state')
const stateIcon = $<HTMLSpanElement>('state-icon')
const stateTitle = $<HTMLHeadingElement>('state-title')
const stateText = $<HTMLParagraphElement>('state-text')
const stateAction = $<HTMLButtonElement>('state-action')
const mainElement = $<HTMLElement>('main')
const mainView = $<HTMLDivElement>('main-view')
const settingsView = $<HTMLElement>('settings-view')
const settingsBackButton = $<HTMLButtonElement>('settings-back')
const settingsAppUrl = $<HTMLInputElement>('settings-app-url')
const settingsSaveButton = $<HTMLButtonElement>('settings-save')
const settingsTestButton = $<HTMLButtonElement>('settings-test')
const settingsStatus = $<HTMLParagraphElement>('settings-status')
const settingsOpenAppButton = $<HTMLButtonElement>('settings-open-app')
const settingsOpenOptionsButton = $<HTMLButtonElement>('settings-open-options')
const settingsExclusionHost = $<HTMLParagraphElement>('settings-exclusion-host')
const copyTotpInput = $<HTMLInputElement>('copy-totp-setting')
const excludeFillInput = $<HTMLInputElement>('exclude-fill')
const excludeSaveInput = $<HTMLInputElement>('exclude-save')
const shortcutsList = $<HTMLUListElement>('shortcuts-list')
const settingsShortcutsButton = $<HTMLButtonElement>('settings-shortcuts')
const themeChoices = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]'),
)
const savePrompt = $<HTMLDivElement>('save-prompt')
const saveText = $<HTMLParagraphElement>('save-text')
const saveNowButton = $<HTMLButtonElement>('save-now')
const saveIgnoreButton = $<HTMLButtonElement>('save-ignore')
const settingsButton = $<HTMLButtonElement>('settings')
const themeButton = $<HTMLButtonElement>('theme')
const themeIcon = $<HTMLSpanElement>('theme-icon')
const footerStatus = $<HTMLSpanElement>('footer-status')
const footerHint = $<HTMLParagraphElement>('footer-hint')
const bottomDock = $<HTMLDivElement>('bottom-dock')
const inlineStatusDot = $<HTMLSpanElement>('inline-status-dot')

let currentTab: chrome.tabs.Tab | null = null
let status: AppStatus = { appOpen: false, unlocked: false, appUrl: '' }
let entries: ExtensionLoginSummary[] = []
let initialHost = ''
let activeIndex = -1
let stateKind: 'closed' | 'pair' | 'locked' | 'site' | 'empty' | 'search' | null =
  null
let siteBlocked = false
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
let unlocking = false
let unlockPoll: number | undefined
let unlockHintTimer: number | undefined
let activationMode: ActivationMode = 'site'

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
  'shortcuts-page': 'error_shortcutsPage',
  excluded: 'error_excluded',
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

/** Convertit un SVG constant en nœud, sans affecter de HTML à un élément. */
function iconNode(markup: string): SVGElement {
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  return parsed.body.firstElementChild as unknown as SVGElement
}

function showState(
  kind: NonNullable<typeof stateKind>,
  title: string,
  text: string,
  action?: { label: string; run: () => void },
): void {
  stateKind = kind
  stateIcon.replaceChildren(iconNode(stateIconSvg(kind)))
  stateTitle.textContent = title
  stateText.textContent = text
  stateAction.hidden = !action
  stateAction.textContent = action?.label ?? ''
  stateAction.onclick = action
    ? () => {
        action.run()
      }
    : null
  state.hidden = false
}

function hideState(): void {
  stateKind = null
  state.hidden = true
  stateAction.onclick = null
}

function openApp(): void {
  void send({ type: 'OPEN_APP' }).then(() => window.close())
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
  themeIcon.replaceChildren(iconNode(THEME_ICONS[themePreference]))
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

const SHORTCUT_LABELS: Record<string, string> = {
  _execute_action: 'shortcut_openPopup',
  'fill-login': 'shortcut_fillLogin',
  'generate-password': 'shortcut_generatePassword',
  'fill-totp': 'shortcut_fillTotp',
}

async function loadShortcuts(): Promise<void> {
  shortcutsList.replaceChildren()
  let commands: chrome.commands.Command[] = []
  try {
    commands = await api.commands.getAll()
  } catch {
    // L’API peut manquer sur un navigateur ancien : la liste reste vide.
  }
  for (const [name, label] of Object.entries(SHORTCUT_LABELS)) {
    const command = commands.find((entry) => entry.name === name)
    const item = document.createElement('li')
    const text = document.createElement('span')
    text.textContent = t(label)
    const key = document.createElement('kbd')
    key.textContent = command?.shortcut || t('shortcut_notSet')
    item.append(text, key)
    shortcutsList.append(item)
  }
}

async function loadExclusions(): Promise<void> {
  const host = currentTab?.url ? hostFromUrl(currentTab.url) : ''
  const settings = await loadExtensionSettings()
  copyTotpInput.checked = settings.copyTotpAfterFill
  const supported = Boolean(host) && /^https?:/i.test(currentTab?.url ?? '')
  settingsExclusionHost.textContent = supported
    ? t('settings_exclusionHost', [host])
    : t('settings_exclusionNoSite')
  excludeFillInput.disabled = !supported
  excludeSaveInput.disabled = !supported
  excludeFillInput.checked =
    supported && isSiteExcluded(settings.neverFillSites, host)
  excludeSaveInput.checked =
    supported && isSiteExcluded(settings.neverSaveSites, host)
}

async function updateExclusion(
  kind: 'fill' | 'save',
  input: HTMLInputElement,
): Promise<void> {
  const host = currentTab?.url ? hostFromUrl(currentTab.url) : ''
  if (!host) return
  try {
    const response = await send<{ ok?: boolean; error?: string }>({
      type: 'SET_SITE_EXCLUSION',
      host,
      kind,
      excluded: input.checked,
    })
    if (!response?.ok) {
      input.checked = !input.checked
      setSettingsStatus(errorText(response?.error), 'error')
      return
    }
    if (kind === 'save' && input.checked) savePrompt.hidden = true
  } catch {
    input.checked = !input.checked
    setSettingsStatus(t('error_generic'), 'error')
  }
}

async function loadSettings(): Promise<void> {
  try {
    const response = await send<{ appUrl: string }>({ type: 'GET_APP_URL' })
    settingsAppUrl.value = response.appUrl
  } catch {
    settingsAppUrl.value = status.appUrl || ''
  }
  await loadExclusions()
  await loadShortcuts()
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

function unlockButtonLabel(): string {
  return status.mode === 'native'
    ? t('popup_unlockApp')
    : t('popup_openUnlock')
}

function bindLockedAction(): void {
  if (stateKind !== 'locked') return
  stateAction.textContent = t('popup_unlockCancel')
  stateAction.onclick = () => stopUnlock(true)
}

function stopUnlock(cancelled = false): void {
  unlocking = false
  if (unlockPoll !== undefined) window.clearInterval(unlockPoll)
  unlockPoll = undefined
  if (unlockHintTimer !== undefined) window.clearTimeout(unlockHintTimer)
  unlockHintTimer = undefined
  if (stateKind === 'locked') {
    showState('locked', t('state_lockedTitle'), t('state_lockedText'), {
      label: unlockButtonLabel(),
      run: () => void startUnlock(),
    })
  }
  if (cancelled) showMessage(t('popup_unlockCancelled'), 'info')
}

async function pollUnlock(deadline: number): Promise<void> {
  if (!unlocking) return
  let response: AppStatus | null = null
  try {
    response = await send<AppStatus>({ type: 'GET_STATUS' })
  } catch {
    response = null
  }
  if (!unlocking) return
  if (
    response?.unlocked &&
    (response.mode !== 'native' || response.paired !== false)
  ) {
    stopUnlock()
    await init()
    showMessage(t('popup_unlocked'), 'success')
    return
  }
  if (Date.now() >= deadline) {
    stopUnlock()
    showMessage(t('popup_unlockTimeout'), 'error')
  }
}

async function startUnlock(): Promise<void> {
  if (unlocking) return
  unlocking = true
  bindLockedAction()
  showMessage(t('popup_unlocking'), 'info')
  const deadline = Date.now() + 120_000
  unlockHintTimer = window.setTimeout(() => {
    if (unlocking) showMessage(t('popup_unlockHint'), 'info')
  }, 12_000)
  unlockPoll = window.setInterval(() => {
    void pollUnlock(deadline)
  }, 1_200)
  void pollUnlock(deadline)
  try {
    const response = await send<{
      ok?: boolean
      pending?: boolean
      mode?: 'native' | 'tab'
      error?: string
    }>({ type: 'UNLOCK_REQUEST' })
    if (!unlocking) return
    if (response.error) {
      stopUnlock()
      showMessage(errorText(response.error), 'error')
      await init()
      return
    }
    if (response.ok && !response.pending) {
      stopUnlock()
      await init()
      showMessage(t('popup_unlocked'), 'success')
      return
    }
    if (response.mode === 'tab') {
      showMessage(t('popup_unlockTab'), 'info')
    }
  } catch {
    stopUnlock()
    showMessage(t('error_generic'), 'error')
  }
}

function activateLabel(): string {
  return t(
    activationMode === 'all' ? 'popup_activateInline' : 'popup_activateSite',
  )
}

function renderStatus(): void {
  hideMessage()
  hideState()
  inlineStatusDot.hidden = true
  searchWrap.hidden = true
  searchInput.disabled = true
  footerHint.hidden = true
  results.replaceChildren()
  activeIndex = -1
  siteBlocked = false

  if (status.mode === 'native' && status.paired === false) {
    showState('pair', t('state_pairTitle'), t('state_pairText'), {
      label: t('popup_pair'),
      run: () => void pairExtension(),
    })
    footerStatus.textContent = t('popup_footerPairing')
    return
  }

  if (!status.appOpen) {
    showState('closed', t('state_closedTitle'), t('state_closedText'), {
      label: t('popup_openApp'),
      run: openApp,
    })
    footerStatus.textContent = t('popup_footerClosed')
    return
  }

  if (!status.unlocked) {
    showState('locked', t('state_lockedTitle'), t('state_lockedText'), {
      label: unlockButtonLabel(),
      run: () => void startUnlock(),
    })
    footerStatus.textContent =
      status.mode === 'native'
        ? t('popup_footerLockedNative')
        : t('popup_footerLocked')
    return
  }

  searchWrap.hidden = false
  searchInput.disabled = false
  footerHint.hidden = false
  siteBlocked = status.siteAccess === false && !inlineReady
  if (siteBlocked) {
    showState('site', t('state_siteTitle'), t('popup_activateHint'), {
      label: activateLabel(),
      run: () => void activateInline(),
    })
  }
  inlineStatusDot.hidden = !inlineReady
  footerStatus.textContent =
    status.mode === 'native'
      ? t('popup_footerNative')
      : t('popup_footerReady')
}

async function toggleDetails(
  entry: ExtensionLoginSummary,
  row: HTMLLIElement,
  panel: HTMLDivElement,
  toggle: HTMLElement,
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
      url: currentTab?.url ?? '',
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

function optionElements(): HTMLElement[] {
  return Array.from(
    results.querySelectorAll<HTMLElement>('[role="option"]'),
  )
}

function setActive(index: number, focus = false): void {
  const options = optionElements()
  activeIndex = index >= 0 && index < options.length ? index : -1
  options.forEach((element, position) => {
    const active = position === activeIndex
    element.tabIndex = active ? 0 : -1
    element.setAttribute('aria-selected', String(active))
    element.classList.toggle('result--active', active)
  })
  const current = options[activeIndex]
  if (current) {
    current.scrollIntoView({ block: 'nearest' })
    if (focus) current.focus({ preventScroll: true })
  }
}

function createResult(
  entry: ExtensionLoginSummary,
  index: number,
): HTMLLIElement {
  const item = document.createElement('li')
  item.className = 'result'
  item.dataset.expanded = 'false'
  item.dataset.index = String(index)
  item.setAttribute('role', 'option')
  item.setAttribute('aria-selected', 'false')
  item.setAttribute('tabindex', '-1')
  const subtitle = entry.username || entry.host || t('menu_noLogin')
  item.setAttribute('aria-label', `${entry.title} — ${subtitle}`)

  item.addEventListener('focus', () => setActive(index))

  const head = document.createElement('div')
  head.className = 'result__head'
  head.setAttribute('aria-hidden', 'true')

  const toggle = document.createElement('div')
  toggle.className = 'result__toggle'
  toggle.dataset.expanded = 'false'

  const icon = document.createElement('span')
  icon.className = 'result__icon'
  icon.append(iconNode(itemIconSvg(entry.kind)))
  const initial = document.createElement('span')
  initial.className = 'result__initial'
  initial.textContent = itemInitial(entry.title)
  icon.append(initial)

  const text = document.createElement('div')
  text.className = 'result__text'
  const title = document.createElement('div')
  title.className = 'result__title'
  title.textContent = entry.title
  title.title = entry.title
  const sub = document.createElement('div')
  sub.className = 'result__sub'
  sub.textContent = subtitle
  sub.title = subtitle
  text.append(title, sub)

  const chevron = document.createElement('span')
  chevron.className = 'result__chevron'
  chevron.setAttribute('aria-hidden', 'true')
  chevron.textContent = '›'

  toggle.append(icon, text, chevron)

  const fillButton = document.createElement('button')
  fillButton.type = 'button'
  fillButton.tabIndex = -1
  fillButton.className = 'button button--primary result__fill'
  fillButton.title = t('details_fill')
  fillButton.setAttribute('aria-label', `${t('details_fill')} — ${entry.title}`)
  fillButton.replaceChildren(iconNode(FILL_ICON))
  const fillLabel = document.createElement('span')
  fillLabel.className = 'result__fill-label'
  fillLabel.textContent = t('details_fill')
  fillButton.append(fillLabel)
  fillButton.addEventListener('click', (event) => {
    event.stopPropagation()
    void fillEntry(entry.id)
  })

  head.append(toggle, fillButton)

  const details = document.createElement('div')
  details.className = 'result__details'
  details.hidden = true
  details.setAttribute('aria-live', 'polite')

  toggle.addEventListener('click', (event) => {
    event.stopPropagation()
    setActive(index)
    void toggleDetails(entry, item, details, toggle)
  })

  item.append(head, details)
  return item
}

function renderGroups(groups: PopupGroup[]): void {
  results.replaceChildren()
  activeIndex = -1
  entries = groups.flatMap((group) => group.entries)
  let index = 0

  for (const group of groups) {
    if (group.entries.length === 0) continue
    const section = document.createElement('section')
    section.className = 'result-group'
    const heading = document.createElement('h2')
    heading.className = 'result-group__title'
    heading.textContent = group.title
    const list = document.createElement('ul')
    list.className = 'results'
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-label', group.title)
    for (const entry of group.entries) {
      list.append(createResult(entry, index))
      index += 1
    }
    section.append(heading, list)
    results.append(section)
  }

  if (entries.length > 0) {
    setActive(-1)
    const first = optionElements()[0]
    if (first) first.tabIndex = 0
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

function showAddSiteState(): void {
  showState('empty', t('popup_noSiteTitle'), t('popup_noSiteText'), {
    label: t('popup_addSite'),
    run: openApp,
  })
}

function showEmptySearchState(query: string): void {
  showState(
    'search',
    t('popup_noResultsTitle'),
    t('popup_noResultsText', [query]),
    {
      label: t('popup_clearSearch'),
      run: () => {
        searchInput.value = initialHost
        void loadInitial(initialHost)
        searchInput.focus()
      },
    },
  )
}

async function loadInitial(host: string): Promise<void> {
  const [siteResponse, allResponse] = await Promise.all([
    send<SearchResponse>({ type: 'SEARCH', query: host }),
    send<SearchResponse>({ type: 'SEARCH', query: '' }),
  ])
  const error = siteResponse.error ?? allResponse.error
  if (error) {
    await refreshStatus()
    showMessage(errorText(error), 'error')
    return
  }

  const siteEntries = siteResponse.items ?? []
  const allEntries = allResponse.items ?? []
  renderGroups(
    groupLogins(siteEntries, allEntries, {
      site: t('popup_siteSection'),
      favorites: t('popup_favorites'),
      recents: t('popup_recents'),
    }),
  )
  mainElement.scrollTop = 0
  if (!siteBlocked && siteEntries.length === 0) showAddSiteState()
  else if (!siteBlocked) hideState()
}

async function loadSearch(query: string): Promise<void> {
  const response = await send<SearchResponse>({ type: 'SEARCH', query })
  if (response.error) {
    await refreshStatus()
    showMessage(errorText(response.error), 'error')
    return
  }
  const found = response.items ?? []
  renderGroups([
    {
      title: query ? t('popup_searchResults') : t('popup_allItems'),
      entries: found,
    },
  ])
  mainElement.scrollTop = 0
  if (found.length === 0 && !siteBlocked) showEmptySearchState(query)
  else if (!siteBlocked) hideState()
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
      showMessage(t('popup_filledSubmitted'), 'success')
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
    void send({
      type: 'RECORD_GENERATED_PASSWORD',
      host: currentTab?.url ? hostFromUrl(currentTab.url) : '',
      password: generatedValue,
    }).catch(() => undefined)
  } catch {
    showMessage(t('error_generic'), 'error')
  }
}

async function init() {
  await initTheme()
  try {
    activationMode = (await loadExtensionSettings()).activationMode
  } catch {
    activationMode = 'site'
  }
  const [tab] = await api.tabs.query({ active: true, currentWindow: true })
  currentTab = tab ?? null
  const host = currentTab?.url ? hostFromUrl(currentTab.url) : ''
  initialHost = host
  site.textContent = host || t('popup_pageUnsupported')
  searchInput.placeholder = host
    ? t('popup_searchFor', [host])
    : t('popup_searchPlaceholder')

  const unlocked = await refreshStatus()
  await refreshPendingSave()
  if (!unlocked) return

  searchInput.value = host
  if (host) await loadInitial(host)
  else await loadSearch('')
  if (!settingsOpen) searchInput.focus({ preventScroll: true })

  if (!searchListenerReady) {
    searchListenerReady = true
    searchInput.addEventListener('input', () => {
      window.clearTimeout(searchTimer)
      searchTimer = window.setTimeout(() => {
        const query = searchInput.value.trim()
        if (host && query.toLowerCase() === host.toLowerCase()) {
          void loadInitial(host)
        } else {
          void loadSearch(query)
        }
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

async function activateInline(): Promise<void> {
  if (busy) return
  stateAction.disabled = true
  let granted: boolean | null = null
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
      throw new Error('onglet actif sans site HTTP')
    }
    const origins =
      activationMode === 'all'
        ? ['http://*/*', 'https://*/*']
        : [`${new URL(tab.url).origin}/*`]
    granted = await requestHostPermission(origins)
    if (granted === false) {
      showMessage(t('popup_activateDenied'), 'error')
      return
    }
    try {
      await send({ type: 'ENABLE_INLINE' })
    } catch {
      // Orion/WebKit : l’enregistrement dynamique peut échouer ; l’injection
      // manuelle dans l’onglet courant reste tentée ci-dessous.
    }
    await injectInlineScripts(tab.id)
    await init()
    showMessage(
      activationMode === 'all'
        ? t('popup_activatedAll')
        : t('popup_activatedSite'),
      'success',
    )
  } catch (error) {
    console.error('Activation du remplissage impossible', error)
    showMessage(
      granted === false
        ? t('popup_activateDenied')
        : t('popup_activateFailed'),
      'error',
    )
  } finally {
    stateAction.disabled = false
  }
}

async function pairExtension(): Promise<void> {
  if (busy) return
  setBusy(true)
  stateAction.disabled = true
  showMessage(t('popup_pairRequested'), 'info')
  try {
    const response = await send<{ ok?: boolean; error?: string }>({
      type: 'PAIR',
    })
    if (!response.ok) {
      showMessage(errorText(response.error), 'error')
      return
    }
    await init()
    showMessage(t('popup_paired'), 'success')
  } catch {
    showMessage(t('popup_pairFailed'), 'error')
  } finally {
    stateAction.disabled = false
    setBusy(false)
  }
}

api.runtime.onMessage.addListener((message: unknown) => {
  if (
    message &&
    typeof message === 'object' &&
    (message as { type?: string }).type === 'PAIRING_CODE' &&
    typeof (message as { code?: unknown }).code === 'string'
  ) {
    const code = (message as { code: string }).code
    const fingerprint = (message as { fingerprint?: unknown }).fingerprint
    showMessage(
      typeof fingerprint === 'string'
        ? `${t('popup_pairCode', [code])} · ${t('popup_pairFingerprint', [fingerprint])}`
        : t('popup_pairCode', [code]),
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
          response.updated ? t('popup_updated') : t('popup_saved'),
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

settingsOpenOptionsButton.addEventListener('click', () => {
  void api.runtime.openOptionsPage()
})

copyTotpInput.addEventListener('change', () => {
  void saveExtensionSettings({ copyTotpAfterFill: copyTotpInput.checked })
})
excludeFillInput.addEventListener('change', () => {
  void updateExclusion('fill', excludeFillInput)
})
excludeSaveInput.addEventListener('change', () => {
  void updateExclusion('save', excludeSaveInput)
})

settingsShortcutsButton.addEventListener('click', () => {
  void send<{ ok?: boolean; error?: string }>({ type: 'OPEN_SHORTCUTS' }).then(
    (response) => {
      if (response.error) setSettingsStatus(errorText(response.error), 'error')
    },
  )
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

function selectedEntry(): ExtensionLoginSummary | null {
  return activeIndex >= 0 ? (entries[activeIndex] ?? null) : null
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  )
}

function hasSelection(): boolean {
  if ((window.getSelection()?.toString() ?? '').length > 0) return true
  const active = document.activeElement
  return (
    active instanceof HTMLInputElement &&
    active.selectionStart !== null &&
    active.selectionStart !== active.selectionEnd
  )
}

function collapseDetails(row: HTMLElement): void {
  row.dataset.expanded = 'false'
  const panel = row.querySelector<HTMLElement>('.result__details')
  if (panel) panel.hidden = true
  const toggle = row.querySelector<HTMLElement>('.result__toggle')
  toggle?.setAttribute('aria-expanded', 'false')
}

async function copyField(
  field: 'password' | 'username' | 'totp',
): Promise<void> {
  const entry = selectedEntry()
  if (!entry) return
  const host = currentTab?.url ? hostFromUrl(currentTab.url) : ''
  try {
    const response = await send<DetailsResponse>({
      type: 'DETAILS',
      itemId: entry.id,
      host,
      url: currentTab?.url ?? '',
    })
    if (response.error || !response.details) {
      showMessage(t('details_error'), 'error')
      return
    }
    const value =
      field === 'password'
        ? response.details.password
        : field === 'username'
          ? response.details.username
          : response.details.totp
    if (!value) {
      showMessage(t(field === 'totp' ? 'popup_noTotp' : 'popup_copyFailed'), 'info')
      return
    }
    await navigator.clipboard.writeText(value)
    showMessage(
      t(
        field === 'password'
          ? 'popup_copiedPassword'
          : field === 'username'
            ? 'popup_copiedUsername'
            : 'popup_copiedTotp',
      ),
      'success',
    )
  } catch {
    showMessage(t('popup_copyFailed'), 'error')
  }
}

function resetToSite(): void {
  searchInput.value = initialHost
  if (initialHost) void loadInitial(initialHost)
  else void loadSearch('')
  searchInput.focus()
}

document.addEventListener('keydown', (event) => {
  if (settingsOpen) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSettings()
    }
    return
  }
  if (searchInput.disabled || searchWrap.hidden) return

  const target = event.target
  const editable = isEditable(target)
  const inSearch = target === searchInput
  const inResults =
    target instanceof HTMLElement &&
    Boolean(target.closest('[role="option"]'))
  const mod = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()

  if (mod && key === 'c') {
    if (event.shiftKey && !event.altKey) {
      event.preventDefault()
      void copyField('username')
      return
    }
    if (event.altKey && !event.shiftKey) {
      event.preventDefault()
      void copyField('totp')
      return
    }
    if (!event.shiftKey && !event.altKey && selectedEntry() && !hasSelection()) {
      event.preventDefault()
      void copyField('password')
      return
    }
  }

  if (event.key === 'Escape') {
    if (!generatorPanel.hidden) {
      event.preventDefault()
      generatorPanel.hidden = true
      searchInput.focus()
      return
    }
    const expanded = results.querySelector<HTMLElement>(
      '.result[data-expanded="true"]',
    )
    if (expanded) {
      event.preventDefault()
      collapseDetails(expanded)
      return
    }
    if (searchInput.value.trim() !== initialHost) {
      event.preventDefault()
      resetToSite()
      return
    }
    setActive(-1)
    return
  }

  if (
    (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
    (inSearch || inResults || !editable)
  ) {
    const options = optionElements()
    if (options.length === 0) return
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const next =
      activeIndex < 0
        ? delta > 0
          ? 0
          : options.length - 1
        : Math.max(0, Math.min(options.length - 1, activeIndex + delta))
    setActive(next, true)
    return
  }

  if (inResults && event.key === 'Home') {
    event.preventDefault()
    setActive(0, true)
    return
  }
  if (inResults && event.key === 'End') {
    event.preventDefault()
    setActive(optionElements().length - 1, true)
    return
  }

  if (inResults && event.key === 'ArrowRight') {
    const row = target.closest<HTMLElement>('[role="option"]')
    if (row && row.dataset.expanded !== 'true') {
      const toggle = row.querySelector<HTMLElement>('.result__toggle')
      toggle?.click()
      event.preventDefault()
    }
    return
  }
  if (inResults && event.key === 'ArrowLeft') {
    const row = target.closest<HTMLElement>('[role="option"]')
    if (row && row.dataset.expanded === 'true') {
      event.preventDefault()
      collapseDetails(row)
    }
    return
  }

  if (event.key === 'Enter' && (inResults || (inSearch && activeIndex >= 0))) {
    const entry = selectedEntry()
    if (entry) {
      event.preventDefault()
      void fillEntry(entry.id)
    }
    return
  }

  if (event.key === '/' && !editable && !mod && !event.altKey) {
    event.preventDefault()
    searchInput.focus()
    searchInput.select()
    return
  }

  if (editable || mod || event.altKey) return
  if (event.key.length !== 1 || event.key === ' ') return

  searchInput.focus()
  searchInput.value = event.key
  event.preventDefault()
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    void loadSearch(searchInput.value.trim())
  }, 150)
})

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(updateDockHeight).observe(bottomDock)
} else {
  window.addEventListener('resize', updateDockHeight)
}
updateDockHeight()

void init().catch((error) => {
  console.error('Coffre popup', error)
  showMessage(t('error_generic'), 'error')
})
