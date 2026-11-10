/**
 * Bandeau d’enregistrement affiché après une soumission de formulaire.
 *
 * La page ne voit que l’identifiant opaque de la proposition. Le bandeau
 * demande lui-même les métadonnées au service worker : jamais de mot de passe,
 * jamais de champ secret dans l’URL ou dans le DOM de la page.
 */

import { localizeDocument, t } from './i18n'
import { mountLogos } from './logo'
import {
  saveBannerSubject,
  saveBannerTitleKey,
  type SaveBannerView,
} from './saveBannerState'
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

const hostLabel = $<HTMLElement>('banner-host')
const title = $<HTMLHeadingElement>('banner-title')
const detail = $<HTMLParagraphElement>('banner-detail')
const usernameWrap = $<HTMLLabelElement>('banner-username-wrap')
const usernameInput = $<HTMLInputElement>('banner-username')
const message = $<HTMLParagraphElement>('banner-message')
const saveButton = $<HTMLButtonElement>('banner-save')
const laterButton = $<HTMLButtonElement>('banner-later')
const closeButton = $<HTMLButtonElement>('banner-close')

const params = new URLSearchParams(window.location.search)
const offerId = params.get('offer') ?? ''
const CLOSE_DELAY_MS = 30_000

let closeTimer: number | undefined
let view: SaveBannerView | null = null
let saving = false

const ERROR_KEYS: Record<string, string> = {
  'app-closed': 'error_appClosed',
  locked: 'error_locked',
  'needs-pairing': 'error_needsPairing',
  'domain-mismatch': 'error_domainMismatch',
  permission: 'error_permission',
  'no-pending': 'saveBanner_errorNoPending',
  'save-failed': 'saveBanner_errorSave',
  forbidden: 'error_generic',
  invalid: 'error_generic',
}

function send<T>(payload: Record<string, unknown>): Promise<T> {
  return api.runtime.sendMessage(payload) as Promise<T>
}

function errorText(code: string | undefined): string {
  return t((code && ERROR_KEYS[code]) || 'error_generic')
}

function showMessage(text: string, tone: 'info' | 'success' | 'error'): void {
  message.hidden = false
  message.textContent = text
  message.className =
    tone === 'info' ? 'banner__message' : `banner__message banner__message--${tone}`
}

function resize(): void {
  window.parent.postMessage(
    {
      type: 'coffre-save-banner-resize',
      width: Math.max(280, Math.min(400, document.documentElement.scrollWidth || 380)),
      height: Math.max(120, document.body.scrollHeight),
    },
    '*',
  )
}

function close(): void {
  if (closeTimer !== undefined) window.clearTimeout(closeTimer)
  closeTimer = undefined
  window.parent.postMessage({ type: 'coffre-save-banner-close' }, '*')
}

function touchTimer(): void {
  if (closeTimer !== undefined) window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(close, CLOSE_DELAY_MS)
}

function render(next: SaveBannerView): void {
  view = next
  hostLabel.textContent = next.host
  title.textContent = t(saveBannerTitleKey(next), [saveBannerSubject(next)])
  detail.textContent = next.detail
  detail.hidden = !next.detail
  usernameWrap.hidden = next.kind !== 'login'
  usernameInput.value =
    next.kind === 'login' && next.label !== next.host ? next.label : ''
  if (next.risk === 'phishing') {
    // Q1 : « Enregistrer » cesse d’être l’action par défaut.
    showMessage(t('saveBanner_phishingWarning'), 'error')
    saveButton.textContent = t('phishing_continue')
    saveButton.classList.remove('button--primary')
    saveButton.removeAttribute('data-autofocus')
    laterButton.classList.add('button--primary')
    laterButton.focus()
  }
  requestAnimationFrame(resize)
}

async function load(): Promise<void> {
  if (!/^[a-f0-9-]{8,64}$/i.test(offerId)) {
    title.textContent = t('saveBanner_errorNoPending')
    saveButton.hidden = true
    return
  }
  try {
    const response = await send<{ banner?: SaveBannerView; error?: string }>({
      type: 'GET_SAVE_BANNER',
      offerId,
    })
    if (response.error || !response.banner) {
      title.textContent = errorText(response.error)
      saveButton.hidden = true
      return
    }
    render(response.banner)
  } catch {
    title.textContent = t('error_generic')
    saveButton.hidden = true
  }
}

async function save(): Promise<void> {
  if (!view || saving) return
  saving = true
  saveButton.disabled = true
  laterButton.disabled = true
  try {
    const response = await send<{
      ok?: boolean
      updated?: boolean
      error?: string
    }>({
      type: 'SAVE_BANNER_NOW',
      offerId: view.offerId,
      username:
        view.kind === 'login' ? usernameInput.value.trim() : undefined,
      overridePhishing: view.risk === 'phishing',
    })
    if (!response.ok) {
      showMessage(errorText(response.error), 'error')
      saveButton.disabled = false
      laterButton.disabled = false
      return
    }
    showMessage(
      t(response.updated ? 'saveBanner_updated' : 'saveBanner_saved'),
      'success',
    )
    if (closeTimer !== undefined) window.clearTimeout(closeTimer)
    window.parent.postMessage({ type: 'coffre-save-banner-saved' }, '*')
    window.setTimeout(close, 700)
  } catch {
    showMessage(t('error_generic'), 'error')
    saveButton.disabled = false
    laterButton.disabled = false
  } finally {
    saving = false
  }
}

saveButton.addEventListener('click', () => void save())
laterButton.addEventListener('click', close)
closeButton.addEventListener('click', close)
document.addEventListener('pointerdown', touchTimer, true)
document.addEventListener('keydown', touchTimer, true)
window.addEventListener('resize', resize)

touchTimer()
void load()
