/**
 * Trousseau du système, via les commandes Tauri.
 *
 * Le trousseau n’existe que dans l’application desktop : sur le Web, dans
 * l’extension ou dans les tests, toutes les fonctions se contentent de
 * signaler son absence. Aucune clé n’est jamais écrite dans le stockage du
 * navigateur.
 */

import { invoke } from '@tauri-apps/api/core'

/** Vrai dans l’application desktop Tauri, où le trousseau est disponible. */
export function keychainAvailable(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window
}

/** Enregistre la clé maîtresse ; false si le trousseau refuse ou est absent. */
export async function storeVaultKey(account: string, secret: string): Promise<boolean> {
  if (!account || !secret || !keychainAvailable()) return false
  try {
    await invoke('keychain_store', { account, secret })
    return true
  } catch {
    return false
  }
}

/** Relit la clé maîtresse ; null si elle est absente ou illisible. */
export async function loadVaultKey(account: string): Promise<string | null> {
  if (!account || !keychainAvailable()) return null
  try {
    return await invoke<string | null>('keychain_load', { account })
  } catch {
    return null
  }
}

/** Efface la clé du trousseau. Une entrée absente est ignorée. */
export async function deleteVaultKey(account: string): Promise<void> {
  if (!account || !keychainAvailable()) return
  try {
    await invoke('keychain_delete', { account })
  } catch {
    // Le verrouillage ne doit jamais échouer à cause du trousseau.
  }
}
