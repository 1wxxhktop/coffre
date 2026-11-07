import { hostFromUrl, type ExtensionLoginSummary } from '../src/lib/extensionProtocol'

interface AppStatus {
  appOpen: boolean
  unlocked: boolean
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

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Élément ${id} absent`)
  return element as T
}

const site = $<HTMLParagraphElement>('site')
const message = $<HTMLParagraphElement>('message')
const searchWrap = $<HTMLDivElement>('search-wrap')
const searchInput = $<HTMLInputElement>('search')
const results = $<HTMLUListElement>('results')
const empty = $<HTMLParagraphElement>('empty')
const showAllButton = $<HTMLButtonElement>('show-all')
const actions = $<HTMLDivElement>('actions')
const openAppButton = $<HTMLButtonElement>('open-app')
const focusAppButton = $<HTMLButtonElement>('focus-app')
const settingsButton = $<HTMLButtonElement>('settings')
const footerStatus = $<HTMLSpanElement>('footer-status')

let currentTab: chrome.tabs.Tab | null = null
let status: AppStatus = { appOpen: false, unlocked: false, appUrl: '' }
let entries: ExtensionLoginSummary[] = []
let busy = false
let searchTimer: number | undefined

const ERROR_MESSAGES: Record<string, string> = {
  'app-closed': 'Ouvrez Coffre pour vous connecter.',
  locked: 'Coffre est verrouillé. Déverrouillez-le dans son onglet.',
  permission:
    'Autorisez l’extension à accéder à l’onglet Coffre depuis les réglages.',
  'no-fields': 'Aucun champ de connexion détecté sur cette page.',
  'no-tab': 'Cette page ne permet pas le remplissage automatique.',
  'not-found': 'Cet identifiant n’existe plus dans le coffre.',
  'invalid-url': 'L’adresse de Coffre est invalide.',
}

function send<T>(payload: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(payload) as Promise<T>
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
  return (code && ERROR_MESSAGES[code]) || 'Opération impossible.'
}

function setBusy(value: boolean) {
  busy = value
  for (const button of results.querySelectorAll('button')) {
    button.disabled = value
  }
}

function renderStatus() {
  actions.hidden = true
  focusAppButton.hidden = true
  searchWrap.hidden = true
  results.replaceChildren()
  empty.hidden = true
  showAllButton.hidden = true

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
    footerStatus.textContent = 'Coffre verrouillé'
    return
  }

  hideMessage()
  searchWrap.hidden = false
  footerStatus.textContent = 'Coffre déverrouillé · local'
}

function renderResults() {
  results.replaceChildren()
  empty.hidden = entries.length > 0

  for (const entry of entries) {
    const item = document.createElement('li')
    item.className = 'result'

    const icon = document.createElement('span')
    icon.className = 'result__icon'
    icon.textContent = (entry.title.trim()[0] ?? '?').toUpperCase()

    const text = document.createElement('div')
    text.className = 'result__text'
    const title = document.createElement('div')
    title.className = 'result__title'
    title.textContent = entry.title
    const sub = document.createElement('div')
    sub.className = 'result__sub'
    sub.textContent = entry.username || entry.host || 'Sans identifiant'
    text.append(title, sub)

    const actionsCell = document.createElement('div')
    actionsCell.className = 'result__actions'

    const fillButton = document.createElement('button')
    fillButton.type = 'button'
    fillButton.className = 'button button--primary'
    fillButton.textContent = 'Remplir'
    fillButton.addEventListener('click', () => void fillEntry(entry.id))

    actionsCell.append(fillButton)

    item.append(icon, text, actionsCell)
    results.append(item)
  }
}

async function refreshStatus(): Promise<boolean> {
  status = await send<AppStatus>({ type: 'GET_STATUS' })
  renderStatus()
  return status.appOpen && status.unlocked
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

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  currentTab = tab ?? null
  const host = currentTab?.url ? hostFromUrl(currentTab.url) : ''
  site.textContent = host || 'Page non prise en charge'
  searchInput.placeholder = host
    ? `Rechercher pour ${host}…`
    : 'Rechercher un identifiant…'

  const unlocked = await refreshStatus()
  if (!unlocked) return

  const query = host || ''
  await loadResults(query)
  searchInput.value = query

  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      void loadResults(searchInput.value.trim())
    }, 150)
  })
}

openAppButton.addEventListener('click', () => {
  void send({ type: 'OPEN_APP' }).then(() => window.close())
})

focusAppButton.addEventListener('click', () => {
  void send({ type: 'FOCUS_APP' }).then(() => window.close())
})

settingsButton.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage()
})

showAllButton.addEventListener('click', () => {
  void loadAll()
})

void init()
