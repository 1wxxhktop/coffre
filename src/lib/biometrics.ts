/**
 * Déverrouillage biométrique (Touch ID sur macOS, Windows Hello sur Windows)
 * via les commandes Tauri.
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

/** Vrai uniquement dans l’application desktop macOS ou Windows. */
export function biometricSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (!('__TAURI_INTERNALS__' in window)) return false
  const agent = navigator.userAgent
  return agent.includes('Mac') || agent.includes('Windows')
}

/** Nom du fournisseur biométrique de la plateforme. */
export function biometricName(): string {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')) {
    return 'Windows Hello'
  }
  return 'Touch ID'
}

/** Interroge le matériel ; false si la biométrie n’est pas configurée. */
export async function biometricAvailable(): Promise<boolean> {
  if (!biometricSupported()) return false
  try {
    return await invoke<boolean>('biometric_available')
  } catch {
    return false
  }
}

/**
 * Authentifie puis relit la clé biométrique d’un coffre. Le texte du dialogue
 * est fixé côté natif.
 *
 * Touch ID et Windows Hello restent une barrière applicative côté desktop :
 * la clé est rangée dans le trousseau du système, sans contrôle d’accès
 * biométrique au niveau du trousseau. Un programme qui obtient l’accès au
 * trousseau (avec le mot de passe de session) peut la lire sans empreinte.
 * Voir docs/SECURITY.md.
 */
export async function loadBiometricKey(account: string): Promise<BiometricLoad> {
  if (!account || !biometricSupported()) {
    return { authenticated: false, secret: null }
  }
  return invoke<BiometricLoad>('biometric_load', { account })
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

/** Demande une confirmation biométrique sans lire de secret. */
export async function confirmBiometric(
  reason = 'Confirmer avec la biométrie',
): Promise<boolean> {
  if (!biometricSupported()) return false
  try {
    return await invoke<boolean>('biometric_confirm', { reason })
  } catch {
    return false
  }
}

/**
 * Confirmation d’une action sensible. Sur le Web, l’action explicite de
 * l’utilisateur suffit ; sur desktop avec biométrie configurée, une
 * authentification est exigée avant de livrer un CVC ou un PIN.
 */
export async function confirmSensitiveFill(reason: string): Promise<boolean> {
  if (!biometricSupported()) return true
  if (!(await biometricAvailable())) return true
  return confirmBiometric(reason)
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
