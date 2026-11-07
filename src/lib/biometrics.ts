/**
 * Déverrouillage biométrique (Touch ID) via les commandes Tauri.
 *
 * Sur les autres plateformes et dans le navigateur, toutes les fonctions
 * signalent l’absence de biométrie. La clé biométrique est rangée dans un
 * service de trousseau distinct : `keychain_load` ne peut pas la lire, et la
 * commande `biometric_load` exige une authentification réussie avant de la
 * libérer.
 */

import { invoke } from '@tauri-apps/api/core'

interface BiometricLoad {
  authenticated: boolean
  secret: string | null
}

/** Vrai uniquement dans l’application desktop macOS. */
export function biometricSupported(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window && navigator.userAgent.includes('Mac')
}

/** Interroge le matériel ; false si Touch ID n’est pas configuré. */
export async function biometricAvailable(): Promise<boolean> {
  if (!biometricSupported()) return false
  try {
    return await invoke<boolean>('biometric_available')
  } catch {
    return false
  }
}

/** Authentifie puis relit la clé biométrique d’un coffre. */
export async function loadBiometricKey(
  account: string,
  reason = 'Déverrouiller Coffre',
): Promise<BiometricLoad> {
  if (!account || !biometricSupported()) {
    return { authenticated: false, secret: null }
  }
  return invoke<BiometricLoad>('biometric_load', { account, reason })
}

/** Enregistre la clé dans le trousseau biométrique. */
export async function storeBiometricKey(
  account: string,
  secret: string,
): Promise<boolean> {
  if (!account || !secret || !biometricSupported()) return false
  try {
    await invoke('biometric_store', { account, secret })
    return true
  } catch {
    return false
  }
}

/** Supprime la clé biométrique. Une entrée absente est ignorée. */
export async function deleteBiometricKey(account: string): Promise<void> {
  if (!account || !biometricSupported()) return
  try {
    await invoke('biometric_delete', { account })
  } catch {
    // Le verrouillage ne doit jamais échouer à cause du trousseau.
  }
}
