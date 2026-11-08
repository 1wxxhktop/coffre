/**
 * Fenêtre de confirmation d’une demande passkey.
 *
 * La page ne reçoit que le domaine, le compte et le nombre d’identifiants
 * autorisés. Les clés et les signatures restent dans l’application Coffre.
 */

import { localizeDocument } from './i18n'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

localizeDocument()

interface PasskeyInfo {
  kind: 'create' | 'get'
  host: string
  rpId: string
  userName: string
  credentialCount: number
}

interface RequestResponse {
  request?: PasskeyInfo
  error?: string
}

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Élément ${id} absent`)
  return element as T
}

const hostLabel = $<HTMLElement>('host')
const eyebrow = $<HTMLParagraphElement>('eyebrow')
const title = $<HTMLHeadingElement>('title')
const detail = $<HTMLParagraphElement>('detail')
const error = $<HTMLParagraphElement>('error')
const approve = $<HTMLButtonElement>('approve')
const decline = $<HTMLButtonElement>('decline')

const requestId = new URLSearchParams(window.location.search).get('id') ?? ''
let current: PasskeyInfo | null = null
let busy = false

function send<T>(payload: Record<string, unknown>): Promise<T> {
  return api.runtime.sendMessage(payload) as Promise<T>
}

function showError(message: string): void {
  error.hidden = false
  error.textContent = message
}

function setBusy(value: boolean): void {
  busy = value
  approve.disabled = value
  decline.disabled = value
}

function render(info: PasskeyInfo): void {
  current = info
  hostLabel.textContent = info.host
  if (info.kind === 'create') {
    eyebrow.textContent = 'Création de passkey'
    title.textContent = `Créer une passkey pour ${info.host} ?`
    detail.textContent = info.userName
      ? `Compte : ${info.userName}`
      : `Domaine technique : ${info.rpId}`
    approve.textContent = 'Créer avec Coffre'
  } else {
    eyebrow.textContent = 'Connexion sans mot de passe'
    title.textContent = `Se connecter à ${info.host} ?`
    detail.textContent =
      info.credentialCount > 0
        ? 'Coffre utilisera la passkey autorisée pour ce site.'
        : 'Coffre utilisera la passkey la plus récente enregistrée pour ce site.'
    approve.textContent = 'Se connecter avec Coffre'
  }
  approve.focus()
}

async function load(): Promise<void> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) {
    showError('Demande invalide.')
    setBusy(true)
    return
  }
  try {
    const response = await send<RequestResponse>({
      type: 'GET_PASSKEY_REQUEST',
      requestId,
    })
    if (!response.request) {
      showError(
        response.error === 'expired'
          ? 'Cette demande a expiré. Relancez-la depuis le site.'
          : 'Demande indisponible.',
      )
      setBusy(true)
      return
    }
    render(response.request)
  } catch {
    showError('Coffre ne répond pas.')
    setBusy(true)
  }
}

function decide(decision: 'approve' | 'decline'): void {
  if (busy || !current) return
  setBusy(true)
  approve.textContent = decision === 'approve' ? 'Validation…' : 'Fermeture…'
  void send({ type: 'PASSKEY_DECISION', requestId, decision })
    .then(() => window.close())
    .catch(() => {
      setBusy(false)
      showError('Décision impossible. Réessayez.')
    })
}

approve.addEventListener('click', () => decide('approve'))
decline.addEventListener('click', () => decide('decline'))

void load()
