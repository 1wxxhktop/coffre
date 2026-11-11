import { localizeDocument, t } from './i18n'
import { mountLogos } from './logo'
import {
  loadSettings,
  normalizeAppUrl,
  saveSettings,
  type ActivationMode,
  type AppMode,
} from './settings'
import { loadTheme } from './theme'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

localizeDocument()
mountLogos()
void loadTheme()

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Élément ${id} absent`)
  return element as T
}

const mode = new URLSearchParams(window.location.search).get('mode') === 'update'
  ? 'update'
  : 'install'
const updateNote = $<HTMLElement>('update-note')
const installFlow = $<HTMLDivElement>('install-flow')
const desktopPanel = $<HTMLDivElement>('desktop-panel')
const webPanel = $<HTMLDivElement>('web-panel')
const modeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="app-mode"]'),
)
const activationInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="activation"]'),
)
const requestAllButton = $<HTMLButtonElement>('request-all')
const activationStatus = $<HTMLParagraphElement>('activation-status')
const webUrlInput = $<HTMLInputElement>('web-url')
const webStatus = $<HTMLParagraphElement>('web-status')
const pairCode = $<HTMLParagraphElement>('pair-code')
const pairStatus = $<HTMLParagraphElement>('pair-status')
const pairButton = $<HTMLButtonElement>('pair')
const openAppButton = $<HTMLButtonElement>('open-app')
const webSaveButton = $<HTMLButtonElement>('web-save')
const webTestButton = $<HTMLButtonElement>('web-test')
const shortcutsList = $<HTMLUListElement>('welcome-shortcuts')
const shortcutsButton = $<HTMLButtonElement>('shortcuts')
const finishButton = $<HTMLButtonElement>('finish')
const advancedButton = $<HTMLButtonElement>('advanced')
const finishLabel = finishButton.querySelector('span')

const SHORTCUT_LABELS: Record<string, string> = {
  _execute_action: 'shortcut_openPopup',
  'fill-login': 'shortcut_fillLogin',
  'generate-password': 'shortcut_generatePassword',
  'fill-totp': 'shortcut_fillTotp',
}

let appMode: AppMode = 'desktop'
let activationMode: ActivationMode = 'site'
let pairedCode = ''

function setStatus(
  element: HTMLElement,
  text: string,
  tone: 'info' | 'ok' | 'error' = 'info',
): void {
  element.textContent = text
  element.className =
    tone === 'info' ? 'status' : `status status--${tone}`
}

function selectedMode(): AppMode {
  const value = modeInputs.find((input) => input.checked)?.value
  return value === 'web' ? 'web' : 'desktop'
}

function selectedActivation(): ActivationMode {
  return activationInputs.find((input) => input.checked)?.value === 'all'
    ? 'all'
    : 'site'
}

function renderPanels(): void {
  appMode = selectedMode()
  desktopPanel.hidden = appMode !== 'desktop'
  webPanel.hidden = appMode !== 'web'
}

function renderActivation(): void {
  activationMode = selectedActivation()
  requestAllButton.hidden = activationMode !== 'all'
}

async function loadShortcuts(): Promise<void> {
  shortcutsList.replaceChildren()
  let commands: chrome.commands.Command[] = []
  try {
    commands = await api.commands.getAll()
  } catch {
    // La liste reste vide si l’API n’est pas disponible.
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

async function pair(): Promise<void> {
  pairButton.disabled = true
  pairCode.hidden = true
  setStatus(pairStatus, t('welcome_pairing'))
  try {
    const response = await api.runtime.sendMessage({ type: 'PAIR' }) as {
      ok?: boolean
      error?: string
    }
    if (!response?.ok) {
      setStatus(pairStatus, t('welcome_pairFailed'), 'error')
      return
    }
    setStatus(
      pairStatus,
      pairedCode
        ? t('welcome_paired')
        : t('welcome_pairedNoCode'),
      'ok',
    )
  } catch {
    setStatus(pairStatus, t('welcome_pairFailed'), 'error')
  } finally {
    pairButton.disabled = false
  }
}

async function saveWebUrl(): Promise<void> {
  const url = normalizeAppUrl(webUrlInput.value)
  if (!url) {
    setStatus(webStatus, t('welcome_invalidUrl'), 'error')
    return
  }
  webSaveButton.disabled = true
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
      setStatus(webStatus, t('welcome_saveFailed'), 'error')
      return
    }
    webUrlInput.value = response.appUrl ?? url
    await saveSettings({ appUrl: response.appUrl ?? url, appMode: 'web' })
    setStatus(
      webStatus,
      granted === false ? t('welcome_savedNoPermission') : t('welcome_saved'),
      granted === false ? 'info' : 'ok',
    )
  } catch {
    setStatus(webStatus, t('welcome_saveFailed'), 'error')
  } finally {
    webSaveButton.disabled = false
  }
}

async function testWeb(): Promise<void> {
  webTestButton.disabled = true
  try {
    const status = await api.runtime.sendMessage({ type: 'GET_STATUS' }) as {
      appOpen?: boolean
      unlocked?: boolean
      mode?: 'native' | 'tab'
    }
    if (status.mode === 'native') {
      setStatus(
        webStatus,
        status.unlocked ? t('welcome_testOk') : t('welcome_testLocked'),
        status.unlocked ? 'ok' : 'error',
      )
    } else if (!status.appOpen) {
      setStatus(webStatus, t('welcome_testClosed'), 'error')
    } else if (!status.unlocked) {
      setStatus(webStatus, t('welcome_testLocked'), 'error')
    } else {
      setStatus(webStatus, t('welcome_testOk'), 'ok')
    }
  } catch {
    setStatus(webStatus, t('welcome_testFailed'), 'error')
  } finally {
    webTestButton.disabled = false
  }
}

async function requestAllSites(): Promise<void> {
  requestAllButton.disabled = true
  try {
    const granted = await api.permissions.request({
      origins: ['http://*/*', 'https://*/*'],
    })
    if (!granted) {
      setStatus(
        activationStatus,
        t('welcome_allDenied'),
        'error',
      )
      return
    }
    await api.runtime.sendMessage({ type: 'ENABLE_INLINE' })
    setStatus(activationStatus, t('welcome_allEnabled'), 'ok')
  } catch {
    setStatus(activationStatus, t('welcome_allFailed'), 'error')
  } finally {
    requestAllButton.disabled = false
  }
}

async function applySettings(): Promise<void> {
  await saveSettings({
    appMode,
    activationMode,
  })
}

async function finish(): Promise<void> {
  finishButton.disabled = true
  try {
    await applySettings()
    window.close()
  } catch {
    setStatus(activationStatus, t('welcome_saveFailed'), 'error')
  } finally {
    finishButton.disabled = false
  }
}

api.runtime.onMessage.addListener((message: unknown) => {
  if (
    message &&
    typeof message === 'object' &&
    (message as { type?: string }).type === 'PAIRING_CODE' &&
    typeof (message as { code?: unknown }).code === 'string'
  ) {
    pairedCode = (message as { code: string }).code
    const fingerprint = (message as { fingerprint?: unknown }).fingerprint
    pairCode.textContent =
      typeof fingerprint === 'string'
        ? `${t('welcome_pairCode', [pairedCode])} · ${t('welcome_pairFingerprint', [fingerprint])}`
        : t('welcome_pairCode', [pairedCode])
    pairCode.hidden = false
    setStatus(pairStatus, t('welcome_pairConfirm'), 'info')
  }
  return false
})

for (const input of modeInputs) {
  input.addEventListener('change', () => {
    renderPanels()
    void saveSettings({ appMode: selectedMode() })
  })
}

for (const input of activationInputs) {
  input.addEventListener('change', () => {
    renderActivation()
    void saveSettings({ activationMode: selectedActivation() })
  })
}

pairButton.addEventListener('click', () => void pair())
openAppButton.addEventListener('click', () => {
  void api.runtime.sendMessage({ type: 'OPEN_APP' })
})
webSaveButton.addEventListener('click', () => void saveWebUrl())
webTestButton.addEventListener('click', () => void testWeb())
requestAllButton.addEventListener('click', () => void requestAllSites())
shortcutsButton.addEventListener('click', () => {
  void api.runtime.sendMessage({ type: 'OPEN_SHORTCUTS' })
})
advancedButton.addEventListener('click', () => {
  void api.runtime.openOptionsPage()
})
finishButton.addEventListener('click', () => void finish())

async function init(): Promise<void> {
  if (mode === 'update') {
    updateNote.hidden = false
    installFlow.hidden = true
    if (finishLabel) finishLabel.textContent = t('welcome_close')
  }
  const settings = await loadSettings()
  appMode = settings.appMode === 'web' ? 'web' : 'desktop'
  activationMode = settings.activationMode
  for (const input of modeInputs) input.checked = input.value === appMode
  for (const input of activationInputs) {
    input.checked = input.value === activationMode
  }
  webUrlInput.value = settings.appUrl
  renderPanels()
  renderActivation()
  await loadShortcuts()
}

void init()
