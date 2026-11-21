/**
 * Déverrouillage biométrique.
 *
 * Desktop : Touch ID / Windows Hello via les commandes Tauri existantes.
 * Android : empreinte digitale (ou biométrie de l’appareil) via
 * `tauri-plugin-biometric`. La clé maîtresse n’est jamais écrite en clair :
 * `biometricCipher` la chiffre avec une clé Android Keystore liée à
 * l’authentification, et le chiffré est conservé dans le stockage local de
 * l’application.
 */

import { invoke } from './invoke'
import { getActiveLocale } from './i18n'

interface BiometricLoad {
  authenticated: boolean
  secret: string | null
}

const ANDROID_CIPHER_PREFIX = 'coffre:biometric-cipher:v1:'

function isAndroidRuntime(): boolean {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return false
  }
  return /Android/i.test(navigator.userAgent)
}

function androidCipherKey(account: string): string {
  return `${ANDROID_CIPHER_PREFIX}${account}`
}

async function androidBiometric() {
  return import('@tauri-apps/plugin-biometric')
}

function errorText(error: unknown): { code: string; message: string } {
  if (typeof error === 'string') return { code: error, message: error }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return {
      code: typeof record.code === 'string' ? record.code : '',
      message: typeof record.message === 'string' ? record.message : '',
    }
  }
  return { code: '', message: '' }
}

function isBiometricCancel(error: unknown): boolean {
  const text = errorText(error)
  const haystack = `${text.code} ${text.message}`.toLowerCase()
  return (
    haystack.includes('cancel') ||
    haystack.includes('annul') ||
    haystack.includes('notinteractive')
  )
}

function androidTexts(): {
  unlockTitle: string
  unlockSubtitle: string
  enrollTitle: string
  enrollSubtitle: string
  cancel: string
} {
  if (getActiveLocale() === 'en') {
    return {
      unlockTitle: 'Unlock Coffre',
      unlockSubtitle: 'Use your fingerprint',
      enrollTitle: 'Enable fingerprint unlock',
      enrollSubtitle: 'Confirm your fingerprint for Coffre',
      cancel: 'Cancel',
    }
  }
  return {
    unlockTitle: 'Déverrouiller Coffre',
    unlockSubtitle: 'Utilisez votre empreinte digitale',
    enrollTitle: 'Activer le déverrouillage par empreinte',
    enrollSubtitle: 'Confirmez votre empreinte pour Coffre',
    cancel: 'Annuler',
  }
}

/** Vrai dans l’application desktop macOS/Windows ou sur Android. */
export function biometricSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (!('__TAURI_INTERNALS__' in window)) return false
  if (isAndroidRuntime()) return true
  const agent = navigator.userAgent
  return agent.includes('Mac') || agent.includes('Windows')
}

/** Nom du fournisseur biométrique de la plateforme. */
export function biometricName(): string {
  if (isAndroidRuntime()) {
    return getActiveLocale() === 'en' ? 'Fingerprint' : 'Empreinte digitale'
  }
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')) {
    return 'Windows Hello'
  }
  return 'Touch ID'
}

/** Interroge le matériel ; false si la biométrie n’est pas configurée. */
export async function biometricAvailable(): Promise<boolean> {
  if (!biometricSupported()) return false
  if (isAndroidRuntime()) {
    try {
      const { checkStatus } = await androidBiometric()
      const status = await checkStatus()
      return status.isAvailable
    } catch {
      return false
    }
  }
  try {
    return await invoke<boolean>('biometric_available')
  } catch {
    return false
  }
}

/**
 * Authentifie puis relit la clé biométrique d’un coffre.
 *
 * Android : le chiffré local est déchiffré par Android Keystore après le
 * BiometricPrompt. Une annulation ou un échec renvoie `authenticated: false`.
 */
export async function loadBiometricKey(account: string): Promise<BiometricLoad> {
  if (!account || !biometricSupported()) {
    return { authenticated: false, secret: null }
  }
  if (isAndroidRuntime()) {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(androidCipherKey(account))
    } catch {
      return { authenticated: false, secret: null }
    }
    if (!stored) {
      throw new Error(
        getActiveLocale() === 'en'
          ? 'No biometric key is registered for this vault. Unlock with the password, then enable fingerprint unlock again.'
          : 'Aucune clé biométrique n’est enregistrée pour ce coffre. Déverrouillez avec le mot de passe, puis réactivez le déverrouillage par empreinte.',
      )
    }
    const texts = androidTexts()
    try {
      const { biometricCipher } = await androidBiometric()
      const result = await biometricCipher(texts.unlockTitle, {
        dataToDecrypt: stored,
        title: texts.unlockTitle,
        subtitle: texts.unlockSubtitle,
        cancelTitle: texts.cancel,
        allowDeviceCredential: false,
        confirmationRequired: false,
      })
      return {
        authenticated: true,
        secret: result.data || null,
      }
    } catch (error) {
      if (isBiometricCancel(error)) {
        return { authenticated: false, secret: null }
      }
      const detail = errorText(error).message
      throw new Error(
        detail ||
          (getActiveLocale() === 'en'
            ? 'Biometric authentication failed.'
            : 'L’authentification biométrique a échoué.'),
      )
    }
  }
  return invoke<BiometricLoad>('biometric_load', { account })
}

/** Enregistre la clé dans le trousseau biométrique ou Android Keystore. */
export async function storeBiometricKey(
  account: string,
  secret: string,
): Promise<boolean> {
  if (!account || !secret || !biometricSupported()) return false
  if (isAndroidRuntime()) {
    const texts = androidTexts()
    try {
      const { biometricCipher } = await androidBiometric()
      const result = await biometricCipher(texts.enrollTitle, {
        dataToEncrypt: secret,
        title: texts.enrollTitle,
        subtitle: texts.enrollSubtitle,
        cancelTitle: texts.cancel,
        allowDeviceCredential: false,
        confirmationRequired: false,
      })
      localStorage.setItem(androidCipherKey(account), result.data)
      return true
    } catch {
      return false
    }
  }
  try {
    await invoke('biometric_store', { account, secret })
    return true
  } catch {
    return false
  }
}

/** Demande une confirmation biométrique sans lire de secret. */
export async function confirmBiometric(
  reason = 'Confirmer avec la biométrie',
): Promise<boolean> {
  if (!biometricSupported()) return false
  if (isAndroidRuntime()) {
    const texts = androidTexts()
    try {
      const { authenticate } = await androidBiometric()
      await authenticate(reason, {
        title: reason,
        subtitle: texts.unlockSubtitle,
        cancelTitle: texts.cancel,
        allowDeviceCredential: false,
        confirmationRequired: false,
      })
      return true
    } catch {
      return false
    }
  }
  try {
    return await invoke<boolean>('biometric_confirm', { reason })
  } catch {
    return false
  }
}

/**
 * Confirmation d’une action sensible. Sur le Web, l’action explicite de
 * l’utilisateur suffit ; sur desktop ou Android avec biométrie configurée,
 * une authentification est exigée avant de livrer un CVC ou un PIN.
 */
export async function confirmSensitiveFill(reason: string): Promise<boolean> {
  if (!biometricSupported()) return true
  if (!(await biometricAvailable())) return true
  return confirmBiometric(reason)
}

/** Supprime la clé biométrique. Une entrée absente est ignorée. */
export async function deleteBiometricKey(account: string): Promise<void> {
  if (!account || !biometricSupported()) return
  if (isAndroidRuntime()) {
    try {
      localStorage.removeItem(androidCipherKey(account))
    } catch {
      // Stockage local indisponible : rien à supprimer.
    }
    return
  }
  try {
    await invoke('biometric_delete', { account })
  } catch {
    // Le verrouillage ne doit jamais échouer à cause du trousseau.
  }
}
