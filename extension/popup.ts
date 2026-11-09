import { hostFromUrl, type ExtensionLoginSummary } from '../src/lib/extensionProtocol'
import { DEFAULT_PASSWORD_OPTIONS, generatePassword } from '../src/lib/password'
import { detailsNotice, renderLoginDetails, type LoginDetails } from './details'
import { localizeDocument, t } from './i18n'
import { loadTheme, nextTheme, saveTheme, type ThemePreference } from './theme'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

localizeDocument()

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
const results = $<HTMLUListElement>('results')
const empty = $<HTMLParagraphElement>('empty')
const showAllButton = $<HTMLButtonElement>('show-all')
const actions = $<HTMLDivElement>('actions')
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

let currentTab: chrome.tabs.Tab | null = null
let status: AppStatus = { appOpen: false, unlocked: false, appUrl: '' }
let entries: ExtensionLoginSummary[] = []
let generatedValue = ''
let busy = false
let searchTimer: number | undefined
let searchListenerReady = false
let themePreference: ThemePreference = 'system'
let themeInitialized = false

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

function renderTheme(): void {
  const label = t(`theme_${themePreference}`)
  themeButton.title = `${t('theme_toggle')} — ${label}`
  themeButton.setAttribute('aria-label', themeButton.title)
  themeIcon.innerHTML = THEME_ICONS[themePreference]
}

async function initTheme(): Promise<void> {
  if (themeInitialized) return
  themeInitialized = true
  themePreference = await loadTheme()
  renderTheme()
}

function renderStatus() {
  actions.hidden = true
  pairButton.hidden = true
  activateInlineButton.hidden = true
  focusAppButton.hidden = true
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
  if (status.hostAccess === false) {
    showMessage(
      'Activez le remplissage dans les champs pour remplir les formulaires directement.',
      'info',
    )
  } else {
    hideMessage()
  }
  actions.hidden = false
  openAppButton.hidden = true
  activateInlineButton.hidden = false
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
    return
  }
  try {
    const response = await send<{
      pending?: { username: string; host: string } | null
    }>({ type: 'GET_PENDING_SAVE', tabId: currentTab.id })
    if (!response.pending) {
      savePrompt.hidden = true
      return
    }
    saveText.textContent = `Enregistrer « ${
      response.pending.username || 'sans identifiant'
    } » pour ${response.pending.host} ?`
    savePrompt.hidden = false
  } catch {
    savePrompt.hidden = true
  }
}

async function refreshStatus(): Promise<boolean> {
  status = await send<AppStatus>({ type: 'GET_STATUS' })
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

function regeneratePassword(): void {
  try {
    generatedValue = generatePassword(DEFAULT_PASSWORD_OPTIONS)
    generatedPassword.textContent = generatedValue
  } catch {
    generatedValue = ''
    generatedPassword.textContent = ''
    showMessage(t('error_generic'), 'error')
  }
}

function openGenerator(): void {
  generatorPanel.hidden = false
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
  if (generatorPanel.hidden) openGenerator()
  else generatorPanel.hidden = true
})

generatorCloseButton.addEventListener('click', () => {
  generatorPanel.hidden = true
})

regenerateButton.addEventListener('click', regeneratePassword)
copyGeneratedButton.addEventListener('click', () => {
  void copyGeneratedPassword()
})

openAppButton.addEventListener('click', () => {
  void send({ type: 'OPEN_APP' }).then(() => window.close())
})

focusAppButton.addEventListener('click', () => {
  void send({ type: 'FOCUS_APP' }).then(() => window.close())
})

activateInlineButton.addEventListener('click', () => {
  if (busy) return
  void (async () => {
    activateInlineButton.disabled = true
    try {
      const granted = await api.permissions.request({
        origins: ['http://*/*', 'https://*/*'],
      })
      if (!granted) {
        showMessage('Permission refusée pour le remplissage dans les champs.', 'error')
        return
      }
      await send({ type: 'ENABLE_INLINE' })
      const [tab] = await api.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        const target = { tabId: tab.id, allFrames: true }
        await api.scripting.executeScript({
          target,
          files: ['content.js'],
        })
        try {
          await api.scripting.executeScript({
            target,
            files: ['webauthn-main.js'],
            world: 'MAIN',
          })
        } catch {
          // Le content script injecte le script de repli si `world` manque.
        }
      }
      showMessage('Remplissage dans les champs activé. Rechargez les autres onglets.', 'success')
      await init()
    } catch {
      showMessage('Activation impossible sur cette page.', 'error')
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
  void api.runtime.openOptionsPage()
})

themeButton.addEventListener('click', () => {
  themePreference = nextTheme(themePreference)
  void saveTheme(themePreference)
  renderTheme()
})

showAllButton.addEventListener('click', () => {
  void loadAll()
})

void init()
