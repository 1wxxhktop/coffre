import { localizeDocument, t } from './i18n'
import { mountLogos } from './logo'
import {
  loadSettings,
  normalizeAppUrl,
  saveSettings,
  type ActivationMode,
  type AppMode,
} from './settings'
import {
  loadTheme,
  saveTheme,
  type ThemePreference,
} from './theme'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

localizeDocument()
mountLogos()

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Élément ${id} absent`)
  return element as T
}

const input = $<HTMLInputElement>('app-url')
const saveButton = $<HTMLButtonElement>('save')
const testButton = $<HTMLButtonElement>('test')
const openButton = $<HTMLButtonElement>('open-app')
const pairButton = $<HTMLButtonElement>('pair')
const shortcutsButton = $<HTMLButtonElement>('shortcuts')
const status = $<HTMLParagraphElement>('status')
const pairingCode = $<HTMLParagraphElement>('pairing-code')
const inlineMenu = $<HTMLInputElement>('inline-menu')
const saveBanner = $<HTMLInputElement>('save-banner')
const autoSubmit = $<HTMLInputElement>('auto-submit')
const requestAllButton = $<HTMLButtonElement>('request-all')
const fillStatus = $<HTMLParagraphElement>('fill-status')
const shortcutsList = $<HTMLUListElement>('shortcuts-list')
const modeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="app-mode"]'),
)
const activationInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="activation-mode"]'),
)
const themeChoices = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]'),
)

let appMode: AppMode = 'desktop'
let activationMode: ActivationMode = 'site'
let themePreference: ThemePreference = 'dark'

const SHORTCUT_LABELS: Record<string, string> = {
  _execute_action: 'shortcut_openPopup',
  'fill-login': 'shortcut_fillLogin',
  'generate-password': 'shortcut_generatePassword',
  'fill-totp': 'shortcut_fillTotp',
}

function setStatus(
  element: HTMLElement,
  text: string,
  kind: 'ok' | 'error' | 'info' = 'info',
): void {
  element.textContent = text
  element.className = kind === 'info' ? 'status' : `status status--${kind}`
}

function selectedMode(): AppMode {
  return modeInputs.find((entry) => entry.checked)?.value === 'web'
    ? 'web'
    : 'desktop'
}

function selectedActivation(): ActivationMode {
  return activationInputs.find((entry) => entry.checked)?.value === 'all'
    ? 'all'
    : 'site'
}

function renderActivation(): void {
  activationMode = selectedActivation()
  requestAllButton.hidden = activationMode !== 'all'
}

function renderTheme(): void {
  for (const button of themeChoices) {
    const active = button.dataset.themeChoice === themePreference
    button.classList.toggle('theme-choice--active', active)
    button.setAttribute('aria-pressed', String(active))
  }
}

async function loadShortcuts(): Promise<void> {
  shortcutsList.replaceChildren()
  let commands: chrome.commands.Command[] = []
  try {
    commands = await api.commands.getAll()
  } catch {
    // L’API peut manquer sur un navigateur ancien.
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

async function describeStatus(): Promise<void> {
  const response = await api.runtime.sendMessage({ type: 'GET_STATUS' }) as {
    appOpen?: boolean
    unlocked?: boolean
    paired?: boolean
    mode?: 'native' | 'tab'
  }
  if (response.mode === 'native') {
    if (!response.unlocked) {
      setStatus(status, t('settings_status_locked'), 'error')
      return
    }
    if (response.paired === false) {
      setStatus(status, t('settings_status_pair'), 'info')
      return
    }
    setStatus(status, t('settings_status_native'), 'ok')
    return
  }
  if (!response.appOpen) {
    setStatus(status, t('settings_status_closed'), 'error')
    return
  }
  if (!response.unlocked) {
    setStatus(status, t('settings_status_locked'), 'error')
    return
  }
  setStatus(status, t('settings_status_ready'), 'ok')
}

async function load(): Promise<void> {
  await loadTheme().then((preference) => {
    themePreference = preference
    renderTheme()
  })
  const settings = await loadSettings()
  appMode = settings.appMode === 'web' ? 'web' : 'desktop'
  activationMode = settings.activationMode
  input.value = settings.appUrl
  inlineMenu.checked = settings.inlineMenu
  saveBanner.checked = settings.saveBanner
  autoSubmit.checked = settings.autoSubmitLogin
  for (const modeInput of modeInputs) {
    modeInput.checked = modeInput.value === appMode
  }
  for (const activationInput of activationInputs) {
    activationInput.checked = activationInput.value === activationMode
  }
  renderActivation()
  await loadShortcuts()
}

async function saveApp(): Promise<void> {
  const url = normalizeAppUrl(input.value)
  if (!url) {
    setStatus(status, t('settings_invalid'), 'error')
    return
  }
  saveButton.disabled = true
  try {
    let granted: boolean | null = null
    try {
      granted = await api.permissions.request({ origins: [`${url}/*`] })
    } catch {
      granted = null
    }
    const response = await api.runtime.sendMessage({
      type: 'SET_APP_URL',
      appUrl: url,
    }) as { ok?: boolean; appUrl?: string; error?: string }
    if (!response?.ok) {
      setStatus(status, t('settings_saveError'), 'error')
      return
    }
    input.value = response.appUrl ?? url
    await saveSettings({ appUrl: response.appUrl ?? url, appMode })
    setStatus(
      status,
      granted === false ? t('settings_savedNoPermission') : t('settings_saved'),
      granted === false ? 'info' : 'ok',
    )
  } catch {
    setStatus(status, t('settings_saveError'), 'error')
  } finally {
    saveButton.disabled = false
  }
}

async function pair(): Promise<void> {
  pairButton.disabled = true
  pairingCode.hidden = true
  setStatus(status, t('welcome_pairing'))
  try {
    const response = await api.runtime.sendMessage({ type: 'PAIR' }) as {
      ok?: boolean
    }
    setStatus(
      status,
      response?.ok ? t('welcome_pairedNoCode') : t('welcome_pairFailed'),
      response?.ok ? 'ok' : 'error',
    )
  } catch {
    setStatus(status, t('welcome_pairFailed'), 'error')
  } finally {
    pairButton.disabled = false
  }
}

async function requestAllSites(): Promise<void> {
  requestAllButton.disabled = true
  try {
    const granted = await api.permissions.request({
      origins: ['http://*/*', 'https://*/*'],
    })
    if (!granted) {
      setStatus(fillStatus, t('welcome_allDenied'), 'error')
      return
    }
    await api.runtime.sendMessage({ type: 'ENABLE_INLINE' })
    setStatus(fillStatus, t('welcome_allEnabled'), 'ok')
  } catch {
    setStatus(fillStatus, t('welcome_allFailed'), 'error')
  } finally {
    requestAllButton.disabled = false
  }
}

for (const modeInput of modeInputs) {
  modeInput.addEventListener('change', () => {
    appMode = selectedMode()
    void saveSettings({ appMode })
  })
}

for (const activationInput of activationInputs) {
  activationInput.addEventListener('change', () => {
    renderActivation()
    void saveSettings({ activationMode: selectedActivation() })
  })
}

for (const button of themeChoices) {
  button.addEventListener('click', () => {
    const value = button.dataset.themeChoice
    if (value !== 'dark' && value !== 'light' && value !== 'system') return
    themePreference = value
    void saveTheme(value)
    renderTheme()
  })
}

inlineMenu.addEventListener('change', () => {
  void saveSettings({ inlineMenu: inlineMenu.checked })
})
autoSubmit.addEventListener('change', () => {
  void saveSettings({ autoSubmitLogin: autoSubmit.checked })
})
saveBanner.addEventListener('change', () => {
  void saveSettings({ saveBanner: saveBanner.checked })
})
saveButton.addEventListener('click', () => void saveApp())
testButton.addEventListener('click', () => void describeStatus())
openButton.addEventListener('click', () => {
  void api.runtime.sendMessage({ type: 'OPEN_APP' })
})
pairButton.addEventListener('click', () => void pair())
shortcutsButton.addEventListener('click', () => {
  void api.runtime.sendMessage({ type: 'OPEN_SHORTCUTS' })
})
requestAllButton.addEventListener('click', () => void requestAllSites())

api.runtime.onMessage.addListener((message: unknown) => {
  if (
    message &&
    typeof message === 'object' &&
    (message as { type?: string }).type === 'PAIRING_CODE' &&
    typeof (message as { code?: unknown }).code === 'string'
  ) {
    pairingCode.textContent = t('welcome_pairCode', [
      (message as { code: string }).code,
    ])
    pairingCode.hidden = false
    setStatus(status, t('welcome_pairConfirm'), 'info')
  }
  return false
})

void load()
