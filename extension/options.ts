interface AppStatus {
  appOpen: boolean
  unlocked: boolean
  paired?: boolean
  mode?: 'native' | 'tab'
  appUrl: string
}

import { localizeDocument } from './i18n'
import { loadTheme } from './theme'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

localizeDocument()
void loadTheme()

const input = document.getElementById('app-url') as HTMLInputElement
const saveButton = document.getElementById('save') as HTMLButtonElement
const testButton = document.getElementById('test') as HTMLButtonElement
const openButton = document.getElementById('open') as HTMLButtonElement
const status = document.getElementById('status') as HTMLParagraphElement

function send<T>(payload: Record<string, unknown>): Promise<T> {
  return api.runtime.sendMessage(payload) as Promise<T>
}

function setStatus(text: string, kind: 'ok' | 'error' | 'info' = 'info') {
  status.textContent = text
  status.className = kind === 'info' ? 'status' : `status status--${kind}`
}

function normalize(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

async function describeStatus() {
  const response = await send<AppStatus>({ type: 'GET_STATUS' })
  if (response.mode === 'native') {
    if (!response.unlocked) {
      setStatus('Coffre desktop est ouvert mais verrouillé.', 'error')
      return
    }
    if (response.paired === false) {
      setStatus(
        'Coffre desktop est ouvert. Ouvrez le popup de l’extension pour l’associer.',
        'info',
      )
      return
    }
    setStatus('Coffre desktop est déverrouillé. Pont natif prêt.', 'ok')
    return
  }
  if (!response.appOpen) {
    setStatus('Coffre n’est pas ouvert dans un onglet.', 'error')
    return
  }
  if (!response.unlocked) {
    setStatus('Coffre est ouvert mais verrouillé.', 'error')
    return
  }
  setStatus('Coffre est ouvert et déverrouillé. Prêt à remplir.', 'ok')
}

async function load() {
  const response = await send<{ appUrl: string }>({ type: 'GET_APP_URL' })
  input.value = response.appUrl
}

saveButton.addEventListener('click', () => {
  void (async () => {
    const url = normalize(input.value)
    if (!url) {
      setStatus('Indiquez une adresse http:// ou https:// valide.', 'error')
      return
    }

    const granted = await api.permissions.request({
      origins: [`${url}/*`],
    })
    if (!granted) {
      setStatus('Permission refusée : l’extension ne peut pas lire cet onglet.', 'error')
      return
    }

    const saved = await send<{ ok?: boolean; appUrl?: string; error?: string }>({
      type: 'SET_APP_URL',
      appUrl: url,
    })
    if (!saved.ok) {
      setStatus('Enregistrement impossible.', 'error')
      return
    }

    input.value = saved.appUrl ?? url
    setStatus('Adresse enregistrée. Ouvrez Coffre dans cet onglet.', 'ok')
  })()
})

testButton.addEventListener('click', () => {
  void describeStatus()
})

openButton.addEventListener('click', () => {
  void send({ type: 'OPEN_APP' })
})

void load()
