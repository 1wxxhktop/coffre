import type { ExtensionLoginSummary } from '../src/lib/extensionProtocol'
import { localizeDocument } from './i18n'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

localizeDocument()

interface MenuQuery {
  tabId: number
  frameId: number
  host: string
  mode: 'badge' | 'save'
}

interface SearchResponse {
  items?: ExtensionLoginSummary[]
  error?: string
  recentId?: string
}

interface FillResponse {
  ok?: boolean
  error?: string
}

interface SaveStatus {
  pending?: { username: string; host: string }
  error?: string
}

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Élément ${id} absent`)
  return element as T
}

const badge = $<HTMLDivElement>('badge')
const badgeButton = $<HTMLButtonElement>('badge-button')
const panel = $<HTMLDivElement>('panel')
const closeButton = $<HTMLButtonElement>('close')
const hostLabel = $<HTMLElement>('host')
const message = $<HTMLParagraphElement>('message')
const searchWrap = $<HTMLDivElement>('search-wrap')
const searchInput = $<HTMLInputElement>('search')
const results = $<HTMLUListElement>('results')
const empty = $<HTMLParagraphElement>('empty')
const actions = $<HTMLDivElement>('actions')
const saveButton = $<HTMLButtonElement>('save')
const ignoreButton = $<HTMLButtonElement>('ignore')

const params = new URLSearchParams(window.location.search)
let searchTimer: number | undefined
const query: MenuQuery = {
  tabId: Number(params.get('tab') ?? ''),
  frameId: Number(params.get('frame') ?? ''),
  host: params.get('host') ?? '',
  mode: params.get('mode') === 'save' ? 'save' : 'badge',
}

const ERROR_MESSAGES: Record<string, string> = {  'app-closed': 'Ouvrez Coffre pour vous connecter.',
  locked: 'Coffre est verrouillé.',
  'needs-pairing': 'Associez l’extension à Coffre.',
  'domain-mismatch': 'Cet identifiant n’est pas enregistré pour ce site.',
  'no-password': 'Aucun champ de mot de passe détecté.',
  'no-fields': 'Aucun champ de connexion détecté.',
  'not-found': 'Cet identifiant n’existe plus.',
  permission: 'Autorisez l’extension à accéder à Coffre.',
}

function send<T>(payload: Record<string, unknown>): Promise<T> {
  return api.runtime.sendMessage(payload) as Promise<T>
}

function errorText(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code]) || 'Opération impossible.'
}

function showMessage(text: string, kind: 'info' | 'error' | 'success' = 'info') {
  message.hidden = false
  message.textContent = text
  message.className =
    kind === 'info' ? 'message' : `message message--${kind}`
}

function resize(width: number, height: number) {
  window.parent.postMessage(
    { type: 'coffre-menu-resize', width, height },
    '*',
  )
}

function close() {
  window.parent.postMessage({ type: 'coffre-menu-close' }, '*')
}

function expand() {
  badge.hidden = true
  panel.hidden = false
  resize(340, 430)
}

function renderResults(items: ExtensionLoginSummary[], recentId?: string) {
  results.replaceChildren()
  empty.hidden = items.length > 0
  empty.textContent = items.length
    ? ''
    : 'Aucune connexion pour ce site. Ouvrez Coffre pour en ajouter.'

  const ordered = [...items].sort((a, b) => {
    if (a.id === recentId) return -1
    if (b.id === recentId) return 1
    return a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })
  })

  for (const entry of ordered) {
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

    const fillButton = document.createElement('button')
    fillButton.type = 'button'
    fillButton.className = 'button button--primary'
    fillButton.textContent = 'Remplir'
    fillButton.addEventListener('click', () => void fill(entry.id))

    item.append(icon, text, fillButton)
    results.append(item)
  }
}

async function load(queryText: string): Promise<void> {
  const response = await send<SearchResponse>({
    type: 'MENU_SEARCH',
    tabId: query.tabId,
    frameId: query.frameId,
    host: query.host,
    query: queryText,
  })
  if (response.error) {
    showMessage(errorText(response.error), 'error')
    renderResults([])
    return
  }
  renderResults(response.items ?? [], response.recentId)
}

async function fill(itemId: string) {
  try {
    const response = await send<FillResponse>({
      type: 'MENU_FILL',
      tabId: query.tabId,
      frameId: query.frameId,
      host: query.host,
      itemId,
    })
    if (!response.ok) {
      showMessage(errorText(response.error), 'error')
      return
    }
    showMessage('Identifiants remplis.', 'success')
    window.setTimeout(close, 500)
  } catch {
    showMessage('Remplissage impossible.', 'error')
  }
}

async function loadSaveStatus() {
  expand()
  searchWrap.hidden = true
  const response = await send<SaveStatus>({
    type: 'SAVE_STATUS',
    tabId: query.tabId,
    frameId: query.frameId,
  })
  if (!response.pending) {
    showMessage('Aucune soumission en attente pour ce site.', 'info')
    actions.hidden = true
    return
  }
  showMessage(
    `Enregistrer « ${response.pending.username} » pour ${response.pending.host} ?`,
    'info',
  )
  actions.hidden = false
}

async function save() {
  saveButton.disabled = true
  try {
    const response = await send<{ ok?: boolean; updated?: boolean; error?: string }>({
      type: 'SAVE_NOW',
      tabId: query.tabId,
      frameId: query.frameId,
    })
    if (!response.ok) {
      showMessage(errorText(response.error), 'error')
      return
    }
    showMessage(
      response.updated ? 'Mot de passe mis à jour.' : 'Identifiant enregistré.',
      'success',
    )
    window.setTimeout(close, 600)
  } finally {
    saveButton.disabled = false
  }
}

async function ignore() {
  await send({
    type: 'SAVE_DISMISS',
    tabId: query.tabId,
    frameId: query.frameId,
  }).catch(() => undefined)
  close()
}

function init() {
  hostLabel.textContent = query.host || 'Site inconnu'

  if (query.mode === 'save') {
    void loadSaveStatus()
  } else {
    badge.hidden = false
    badgeButton.addEventListener('click', () => {
      expand()
      searchWrap.hidden = false
      searchInput.focus()
      void load('')
    })
    searchInput.addEventListener('input', () => {
      window.clearTimeout(searchTimer)
      searchTimer = window.setTimeout(() => {
        void load(searchInput.value.trim())
      }, 150)
    })
  }

  closeButton.addEventListener('click', close)
  saveButton.addEventListener('click', () => void save())
  ignoreButton.addEventListener('click', () => void ignore())
}

init()
