import type {
  ExtensionAutofillKind,
  ExtensionAutofillSummary,
} from '../src/lib/extensionProtocol'
import { localizeDocument, t } from './i18n'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

localizeDocument()

interface MenuQuery {
  tabId: number
  frameId: number
  host: string
  topHost: string
  kind: ExtensionAutofillKind
  mode: 'badge' | 'save'
}

interface SearchResponse {
  items?: ExtensionAutofillSummary[]
  error?: string
  recentId?: string
}

interface FillResponse {
  ok?: boolean
  error?: string
}

interface SaveStatus {
  pending?: {
    username: string
    host: string
    kind?: ExtensionAutofillKind
    detail?: string
  }
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
const tabs = $<HTMLDivElement>('tabs')
const tabLogin = $<HTMLButtonElement>('tab-login')
const tabCard = $<HTMLButtonElement>('tab-card')
const tabIdentity = $<HTMLButtonElement>('tab-identity')
const tabCustom = $<HTMLButtonElement>('tab-custom')
const searchWrap = $<HTMLDivElement>('search-wrap')
const searchInput = $<HTMLInputElement>('search')
const aliasWrap = $<HTMLDivElement>('alias-wrap')
const aliasButton = $<HTMLButtonElement>('alias-button')
const sensitiveWrap = $<HTMLLabelElement>('sensitive-wrap')
const includeSensitive = $<HTMLInputElement>('include-sensitive')
const results = $<HTMLUListElement>('results')
const empty = $<HTMLParagraphElement>('empty')
const actions = $<HTMLDivElement>('actions')
const saveButton = $<HTMLButtonElement>('save')
const ignoreButton = $<HTMLButtonElement>('ignore')

const params = new URLSearchParams(window.location.search)
let searchTimer: number | undefined
let kind: ExtensionAutofillKind =
  params.get('kind') === 'card' ||
  params.get('kind') === 'identity' ||
  params.get('kind') === 'custom'
    ? (params.get('kind') as ExtensionAutofillKind)
    : 'login'
const query: MenuQuery = {
  tabId: Number(params.get('tab') ?? ''),
  frameId: Number(params.get('frame') ?? ''),
  host: params.get('host') ?? '',
  topHost: params.get('top') ?? '',
  kind,
  mode: params.get('mode') === 'save' ? 'save' : 'badge',
}

const ERROR_KEYS: Record<string, string> = {
  'app-closed': 'menu_errorAppClosed',
  locked: 'menu_errorLocked',
  'needs-pairing': 'menu_errorPairing',
  'domain-mismatch': 'menu_errorDomain',
  'no-password': 'menu_errorNoPassword',
  'no-fields': 'menu_errorNoFields',
  'not-found': 'menu_errorNotFound',
  permission: 'menu_errorPermission',
  'insecure-context': 'menu_errorInsecure',
  'cross-origin-frame': 'menu_errorFrame',
  cancelled: 'menu_errorCancelled',
}

function send<T>(payload: Record<string, unknown>): Promise<T> {
  return api.runtime.sendMessage(payload) as Promise<T>
}

function errorText(code: string | undefined): string {
  return t((code && ERROR_KEYS[code]) || 'menu_errorGeneric')
}

function showMessage(text: string, tone: 'info' | 'error' | 'success' = 'info') {
  message.hidden = false
  message.textContent = text
  message.className = tone === 'info' ? 'message' : `message message--${tone}`
}

function resize(width: number, height: number) {
  window.parent.postMessage({ type: 'coffre-menu-resize', width, height }, '*')
}

function close() {
  window.parent.postMessage({ type: 'coffre-menu-close' }, '*')
}

function expand() {
  badge.hidden = true
  panel.hidden = false
  resize(340, 460)
}

function updateTabs() {
  for (const [button, value] of [
    [tabLogin, 'login'],
    [tabCard, 'card'],
    [tabIdentity, 'identity'],
    [tabCustom, 'custom'],
  ] as Array<[HTMLButtonElement, ExtensionAutofillKind]>) {
    button.classList.toggle('tab--active', value === kind)
    button.setAttribute('aria-selected', String(value === kind))
  }
  sensitiveWrap.hidden = kind !== 'card'
}

function setKind(next: ExtensionAutofillKind) {
  if (kind === next) return
  kind = next
  updateTabs()
  void load(searchInput.value.trim())
}

function summaryText(entry: ExtensionAutofillSummary): string {
  if ('kind' in entry && entry.kind === 'card') {
    return [entry.brand, `•••• ${entry.last4}`, entry.expiry]
      .filter(Boolean)
      .join(' · ')
  }
  if ('kind' in entry && entry.kind === 'identity') {
    return entry.fullName || entry.email || t('menu_identityFallback')
  }
  if ('kind' in entry && entry.kind === 'custom') {
    return `${entry.fieldCount} ${t('menu_fieldCount')}`
  }
  return entry.username || entry.host || t('menu_noLogin')
}

function renderResults(items: ExtensionAutofillSummary[], recentId?: string) {
  results.replaceChildren()
  empty.hidden = items.length > 0
  empty.textContent = items.length
    ? ''
    : kind === 'card'
      ? t('menu_emptyCards')
      : kind === 'identity'
        ? t('menu_emptyIdentities')
        : kind === 'custom'
          ? t('menu_emptyCustom')
          : t('menu_emptyLogins')

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
    sub.textContent = summaryText(entry)
    text.append(title, sub)

    const fillButton = document.createElement('button')
    fillButton.type = 'button'
    fillButton.className = 'button button--primary'
    fillButton.textContent = t('menu_fill')
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
    kind,
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
      kind,
      includeSensitive: kind === 'card' && includeSensitive.checked,
    })
    if (!response.ok) {
      showMessage(errorText(response.error), 'error')
      return
    }
    showMessage(
      kind === 'card'
        ? t('menu_filledCard')
        : kind === 'identity'
          ? t('menu_filledIdentity')
          : t('menu_filledLogin'),
      'success',
    )
    window.setTimeout(close, 600)
  } catch {
    showMessage(t('menu_errorGeneric'), 'error')
  }
}

async function loadSaveStatus() {
  expand()
  tabs.hidden = true
  searchWrap.hidden = true
  sensitiveWrap.hidden = true
  const response = await send<SaveStatus>({
    type: 'SAVE_STATUS',
    tabId: query.tabId,
    frameId: query.frameId,
  })
  if (!response.pending) {
    showMessage(t('menu_noPending'), 'info')
    actions.hidden = true
    return
  }
  const label = response.pending.username
  const detail = response.pending.detail ? ` (${response.pending.detail})` : ''
  showMessage(
    `${t('menu_savePrompt')} « ${label} »${detail} ${t('menu_saveFor')} ${response.pending.host} ?`,
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
      response.updated ? t('menu_updated') : t('menu_saved'),
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
  hostLabel.textContent = query.topHost && query.topHost !== query.host
    ? `${query.host} · ${query.topHost}`
    : query.host || t('menu_unknownSite')

  if (query.mode === 'save') {
    void loadSaveStatus()
  } else {
    badge.hidden = false
    badgeButton.addEventListener('click', () => {
      expand()
      tabs.hidden = false
      searchWrap.hidden = false
      aliasWrap.hidden = false
      updateTabs()
      searchInput.focus()
      void load('')
    })
    searchInput.addEventListener('input', () => {
      window.clearTimeout(searchTimer)
      searchTimer = window.setTimeout(() => {
        void load(searchInput.value.trim())
      }, 150)
    })
    aliasButton.addEventListener('click', async () => {
      const response = await send<{ alias?: string; error?: string }>({
        type: 'ALIAS_GENERATE',
        host: query.host,
      })
      if (response.alias) {
        await navigator.clipboard.writeText(response.alias).catch(() => undefined)
        showMessage(`${t('menu_aliasCopied')} ${response.alias}`, 'success')
      } else {
        showMessage(errorText(response.error), 'error')
      }
    })
    tabLogin.addEventListener('click', () => setKind('login'))
    tabCard.addEventListener('click', () => setKind('card'))
    tabIdentity.addEventListener('click', () => setKind('identity'))
    tabCustom.addEventListener('click', () => setKind('custom'))
  }

  closeButton.addEventListener('click', close)
  saveButton.addEventListener('click', () => void save())
  ignoreButton.addEventListener('click', () => void ignore())
}

init()
