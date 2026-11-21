/**
 * Passkeys Android via Credential Manager.
 *
 * Le fournisseur système lit un cache en mémoire publié par l’application
 * déverrouillée. La clé privée reste dans Rust ; Kotlin ne reçoit que les
 * métadonnées de sélection puis une assertion signée.
 */

import { invoke } from './invoke'
import { isAndroidRuntime } from './platform'
import type { PasskeyItem, VaultItem } from './types'

export const MAX_ANDROID_PASSKEYS = 2_000
const MAX_TTL_SECONDS = 86_400

export interface AndroidPasskeyEntry {
  id: string
  title: string
  rpId: string
  userName: string
  userHandle: string
  credentialId: string
  privateKey: string
  signCount: number
}

export function androidPasskeysSupported(): boolean {
  return isAndroidRuntime()
}

/** Passkeys actives et complètes, les plus récentes d’abord. */
export function toAndroidPasskeyEntries(
  items: VaultItem[],
): AndroidPasskeyEntry[] {
  return items
    .filter(
      (item): item is PasskeyItem =>
        item.type === 'passkey' &&
        !item.deletedAt &&
        item.rpId.trim().length > 0 &&
        item.credentialId.length > 0 &&
        item.privateKey.length > 0,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_ANDROID_PASSKEYS)
    .map((item) => ({
      id: item.id,
      title: item.title,
      rpId: item.rpId.trim().toLowerCase(),
      userName: item.userName,
      userHandle: item.userHandle,
      credentialId: item.credentialId,
      privateKey: item.privateKey,
      signCount: item.signCount,
    }))
}

/** Convertit le délai d’autolock en durée de validité native. */
export function passkeyTtlSeconds(autoLockMinutes: number): number {
  if (!Number.isFinite(autoLockMinutes) || autoLockMinutes <= 0) return 0
  return Math.min(MAX_TTL_SECONDS, Math.floor(autoLockMinutes * 60))
}

export async function publishAndroidPasskeys(
  entries: AndroidPasskeyEntry[],
  ttlSeconds: number,
): Promise<void> {
  if (!androidPasskeysSupported()) return
  await invoke('android_passkeys_publish', {
    entries: entries.slice(0, MAX_ANDROID_PASSKEYS),
    ttlSeconds,
  })
}

/** Prolonge le cache ; false s’il a expiré et doit être republié. */
export async function touchAndroidPasskeys(
  ttlSeconds: number,
): Promise<boolean> {
  if (!androidPasskeysSupported()) return false
  try {
    return await invoke<boolean>('android_passkeys_touch', { ttlSeconds })
  } catch {
    return false
  }
}

export async function clearAndroidPasskeys(): Promise<void> {
  if (!androidPasskeysSupported()) return
  await invoke('android_passkeys_clear')
}

export async function openAndroidPasskeysSettings(): Promise<boolean> {
  if (!androidPasskeysSupported()) return false
  try {
    return await invoke<boolean>('android_passkeys_open_settings')
  } catch {
    return false
  }
}
