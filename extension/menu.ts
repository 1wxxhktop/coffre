import type {
  ExtensionAutofillKind,
  ExtensionAutofillSummary,
} from '../src/lib/extensionProtocol'
import type { PhishingAssessment } from '../src/lib/phishing'
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
} from '../src/lib/password'
import { detailsNotice, renderLoginDetails, type LoginDetails } from './details'
import { localizeDocument, t } from './i18n'
import { mountLogos } from './logo'
import { loadTheme } from './theme'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

localizeDocument()
mountLogos()

interface MenuQuery {
  tabId: number
  frameId: number
  host: string
  topHost: string
  url: string
  kind: ExtensionAutofillKind
  mode: 'badge' | 'save' | 'open'
  signup: boolean
}

interface SearchResponse {
  items?: ExtensionAutofillSummary[]
  error?: string
  recentId?: string
}

interface FillResponse {
  ok?: boolean
  error?: string
  phishing?: PhishingAssessment
}

interface DetailsResponse {
  details?: LoginDetails
  error?: string
}

interface SaveStatus {
  pending?: {
    username: string
    host: string
    kind?: ExtensionAutofillKind
    detail?: string
    phishing?: PhishingAssessment
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
const phishing = $<HTMLDivElement>('phishing')
const phishingText = $<HTMLParagraphElement>('phishing-text')
const phishingCancel = $<HTMLButtonElement>('phishing-cancel')
const phishingContinue = $<HTMLButtonElement>('phishing-continue')
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
const signup = $<HTMLElement>('signup')
const signupPreview = $<HTMLOutputElement>('signup-preview')
const signupUseButton = $<HTMLButtonElement>('signup-use')
const signupRegenerateButton = $<HTMLButtonElement>('signup-regenerate')
const excludeSiteButton = $<HTMLButtonElement>('exclude-site')

const params = new URLSearchParams(window.location.search)
let searchTimer: number | undefined
let pendingPhishing:
  | { assessment: PhishingAssessment; action: 'fill' | 'save'; itemId?: string }
  | null = null
let strongPassword = ''
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
  url: (params.get('url') ?? '').slice(0, 2048),
  kind,
  mode:
    params.get('mode') === 'save'
      ? 'save'
      : params.get('mode') === 'open'
        ? 'open'
        : 'badge',
  signup: params.get('signup') === '1',
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
  excluded: 'menu_errorExcluded',
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

function phishingTextFor(assessment: PhishingAssessment): string {
  const signal = assessment.signals[0]
  if (!signal) return t('phishing_generic')
  if (signal.knownDomain) return t('phishing_imitates', signal.knownDomain)
  if (signal.code === 'unknown-domain') return t('phishing_unknownUsername')
  if (signal.code === 'ip') return t('phishing_ip')
  if (signal.code === 'http') return t('phishing_http')
  if (signal.code === 'port') return t('phishing_port')
  return t('phishing_generic')
}

function showPhishing(
  assessment: PhishingAssessment,
  action: 'fill' | 'save',
  itemId?: string,
) {
  pendingPhishing = { assessment, action, itemId }
  phishingText.textContent = phishingTextFor(assessment)
  phishing.hidden = false
  // Un remplissage sur un hôte qui n’est pas celui de l’élément est refusé
  // sans échappatoire : le bouton « Continuer » ne concerne que
  // l’enregistrement d’un mot de passe, qui n’expose aucun secret.
  phishingContinue.hidden = action === 'fill'
  actions.hidden = true
  if (action === 'save') results.hidden = true
}

function hidePhishing() {
  phishing.hidden = true
  pendingPhishing = null
  if (query.mode !== 'save') results.hidden = false
}

async function cancelPhishing() {
  const pending = pendingPhishing
  hidePhishing()
  if (pending) {
    await send({
      type: 'PHISHING_CHOICE',
      host: query.host,
      signals: pending.assessment.signals.map((signal) => signal.code),
      choice: 'cancel',
    }).catch(() => undefined)
  }
  if (pending?.action === 'save') {
    close()
  } else if (pending?.action === 'fill') {
    showMessage(t('phishing_cancelled'), 'info')
  }
}

function continuePhishing() {
  const pending = pendingPhishing
  if (!pending) return
  const { action } = pending
  hidePhishing()
  if (action === 'save') {
    void save(true)
  }
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
  signup.hidden = !query.signup || kind !== 'login'
}

function renderStrongPassword(): void {
  if (!strongPassword) {
    signupPreview.textContent = ''
    return
  }
  signupPreview.textContent = `${strongPassword.slice(0, 3)}…${strongPassword.slice(-2)}`
}

async function prepareStrongPassword(): Promise<void> {
  try {
    const { generatePasswordForRules, passwordRulesForUrl } = await import(
      '../src/lib/passwordRules'
    )
    const site = passwordRulesForUrl(query.host)
    strongPassword = site
      ? generatePasswordForRules(site.rules, DEFAULT_PASSWORD_OPTIONS.length)
      : generatePassword(DEFAULT_PASSWORD_OPTIONS)
  } catch {
    strongPassword = generatePassword(DEFAULT_PASSWORD_OPTIONS)
  }
  // Q3 : l’historique du générateur pourra être alimenté ici lorsque le lot
  // sera livré. Le mot de passe complet n’est jamais affiché ni persisté.
  renderStrongPassword()
}

async function excludeSite(): Promise<void> {
  excludeSiteButton.disabled = true
  try {
    const response = await send<{ ok?: boolean; error?: string }>({
      type: 'SET_SITE_EXCLUSION',
      host: query.host,
      kind: 'fill',
      excluded: true,
    })
    if (!response?.ok) {
      showMessage(errorText(response?.error), 'error')
      return
    }
    showMessage(t('menu_excluded'), 'success')
    window.setTimeout(close, 700)
  } catch {
    showMessage(t('menu_errorGeneric'), 'error')
  } finally {
    excludeSiteButton.disabled = false
  }
}

async function useStrongPassword(): Promise<void> {
  if (!strongPassword) await prepareStrongPassword()
  if (!strongPassword) return
  signupUseButton.disabled = true
  try {
    const response = await send<{ ok?: boolean; error?: string }>({
      type: 'FILL_SIGNUP',
      tabId: query.tabId,
      frameId: query.frameId,
      host: query.host,
      password: strongPassword,
    })
    if (!response?.ok) {
      showMessage(errorText(response?.error), 'error')
      return
    }
    strongPassword = ''
    showMessage(t('menu_signupFilled'), 'success')
    window.setTimeout(close, 700)
  } catch {
    showMessage(t('menu_errorGeneric'), 'error')
  } finally {
    signupUseButton.disabled = false
  }
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

async function toggleDetails(
  entry: ExtensionAutofillSummary,
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

  if (!query.host) {
    panel.replaceChildren(detailsNotice(t('details_error')))
    return
  }

  try {
    const response = await send<DetailsResponse>({
      type: 'DETAILS',
      itemId: entry.id,
      host: query.host,
      url: query.url,
    })
    if (panel.hidden) return
    if (response.error || !response.details) {
      panel.replaceChildren(detailsNotice(t('details_error')))
      return
    }
    renderLoginDetails(panel, response.details, () => {
      void fill(entry.id)
    })
  } catch {
    if (!panel.hidden) panel.replaceChildren(detailsNotice(t('details_error')))
  }
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
    item.dataset.expanded = 'false'

    const head = document.createElement('div')
    head.className = 'result__head'

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
    sub.textContent = summaryText(entry)
    sub.title = sub.textContent
    text.append(title, sub)

    const expandable = kind === 'login'
    let details: HTMLDivElement | null = null

    if (expandable) {
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'result__toggle'
      toggle.setAttribute('aria-expanded', 'false')
      toggle.title = t('details_expand')
      toggle.setAttribute('aria-label', `${t('details_expand')} — ${entry.title}`)

      const chevron = document.createElement('span')
      chevron.className = 'result__chevron'
      chevron.setAttribute('aria-hidden', 'true')
      chevron.textContent = '›'

      toggle.append(icon, text, chevron)
      head.append(toggle)

      details = document.createElement('div')
      details.className = 'result__details'
      details.hidden = true
      details.setAttribute('aria-live', 'polite')
      toggle.addEventListener('click', () => {
        if (details) void toggleDetails(entry, item, details, toggle)
      })
    } else {
      const main = document.createElement('div')
      main.className = 'result__main'
      main.append(icon, text)
      head.append(main)
    }

    const fillButton = document.createElement('button')
    fillButton.type = 'button'
    fillButton.className = 'button button--primary result__fill'
    fillButton.textContent = t('menu_fill')
    fillButton.title = `${t('menu_fill')} — ${entry.title}`
    fillButton.setAttribute('aria-label', `${t('menu_fill')} — ${entry.title}`)
    fillButton.addEventListener('click', () => void fill(entry.id))

    head.append(fillButton)
    item.append(head)
    if (details) item.append(details)
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

async function fill(itemId: string, overridePhishing = false) {
  try {
    const response = await send<FillResponse>({
      type: 'MENU_FILL',
      tabId: query.tabId,
      frameId: query.frameId,
      host: query.host,
      url: query.url,
      itemId,
      kind,
      includeSensitive: kind === 'card' && includeSensitive.checked,
      overridePhishing,
    })
    if (response.error === 'phishing-warning' && response.phishing) {
      showPhishing(response.phishing, 'fill', itemId)
      return
    }
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
  excludeSiteButton.hidden = true
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
  if (response.pending.phishing) {
    showPhishing(response.pending.phishing, 'save')
  } else {
    actions.hidden = false
  }
}

async function save(overridePhishing = false) {
  saveButton.disabled = true
  try {
    const response = await send<{
      ok?: boolean
      updated?: boolean
      error?: string
      phishing?: PhishingAssessment
    }>({
      type: 'SAVE_NOW',
      tabId: query.tabId,
      frameId: query.frameId,
      overridePhishing,
    })
    if (response.error === 'phishing-warning' && response.phishing) {
      showPhishing(response.phishing, 'save')
      return
    }
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
  const assessment = pendingPhishing?.assessment
  if (assessment) {
    await send({
      type: 'PHISHING_CHOICE',
      host: query.host,
      signals: assessment.signals.map((signal) => signal.code),
      choice: 'cancel',
    }).catch(() => undefined)
  }
  hidePhishing()
  await send({
    type: 'SAVE_DISMISS',
    tabId: query.tabId,
    frameId: query.frameId,
  }).catch(() => undefined)
  close()
}

function openPanel(): void {
  expand()
  tabs.hidden = false
  searchWrap.hidden = false
  aliasWrap.hidden = false
  excludeSiteButton.hidden = false
  updateTabs()
  if (query.signup) {
    void prepareStrongPassword()
    signupUseButton.focus()
  } else {
    searchInput.focus()
  }
  void load('')
}

function init() {
  hostLabel.textContent = query.topHost && query.topHost !== query.host
    ? `${query.host} · ${query.topHost}`
    : query.host || t('menu_unknownSite')

  if (query.mode === 'save') {
    void loadSaveStatus()
  } else {
    badge.hidden = query.mode === 'open'
    badgeButton.addEventListener('click', openPanel)
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
    if (query.mode === 'open') openPanel()
  }

  closeButton.addEventListener('click', close)
  saveButton.addEventListener('click', () => void save())
  ignoreButton.addEventListener('click', () => void ignore())
  phishingCancel.addEventListener('click', () => void cancelPhishing())
  phishingContinue.addEventListener('click', continuePhishing)
  signupUseButton.addEventListener('click', () => void useStrongPassword())
  signupRegenerateButton.addEventListener('click', () => {
    void prepareStrongPassword()
  })
  excludeSiteButton.addEventListener('click', () => void excludeSite())
}

void loadTheme()
init()
