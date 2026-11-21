/**
 * Remplissage Android.
 *
 * Le service système lit un cache en mémoire publié par l’application quand
 * le coffre est déverrouillé. Aucun secret n’est écrit sur le disque ; le
 * cache est vidé au verrouillage et expire selon le délai de verrouillage
 * automatique, même si Android ralentit les minuteurs de la WebView.
 */

import { invoke } from './invoke'
import { isAndroidRuntime } from './platform'
import type { LoginItem, VaultItem } from './types'

/** Plafond identique au cache Rust : évite un transfert inutile. */
export const MAX_AUTOFILL_ENTRIES = 5_000
const MAX_TTL_SECONDS = 86_400

export interface AndroidAutofillEntry {
  id: string
  title: string
  username: string
  password: string
  urls: string[]
}

export interface AndroidAutofillStatus {
  supported: boolean
  serviceEnabled: boolean
  unlocked: boolean
}

/** Vrai dans l’application Android signée ou de test. */
export function androidAutofillSupported(): boolean {
  return isAndroidRuntime()
}

/**
 * Connexions proposables au remplissage : actives, avec un mot de passe et au
 * moins une adresse. Les favoris puis les plus récentes passent en premier.
 */
export function toAutofillEntries(items: VaultItem[]): AndroidAutofillEntry[] {
  return items
    .filter(
      (item): item is LoginItem =>
        item.type === 'login' &&
        !item.deletedAt &&
        item.password.length > 0 &&
        item.urls.some((url) => url.trim().length > 0),
    )
    .sort(
      (left, right) =>
        Number(right.favorite) - Number(left.favorite) ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, MAX_AUTOFILL_ENTRIES)
    .map((item) => ({
      id: item.id,
      title: item.title,
      username: item.username,
      password: item.password,
      urls: item.urls.filter((url) => url.trim().length > 0),
    }))
}

/** Convertit le délai d’autolock en durée de validité native. */
export function autofillTtlSeconds(autoLockMinutes: number): number {
  if (!Number.isFinite(autoLockMinutes) || autoLockMinutes <= 0) return 0
  return Math.min(MAX_TTL_SECONDS, Math.floor(autoLockMinutes * 60))
}

/** Publie le cache ; sans Android, ne fait rien. */
export async function publishAndroidAutofill(
  entries: AndroidAutofillEntry[],
  ttlSeconds: number,
): Promise<void> {
  if (!androidAutofillSupported()) return
  await invoke('android_autofill_publish', {
    entries: entries.slice(0, MAX_AUTOFILL_ENTRIES),
    ttlSeconds,
  })
}

/**
 * Prolonge le cache sans renvoyer les secrets. `false` signifie que le cache
 * a expiré (ou n’existe plus) et que l’appelant doit republier les entrées.
 */
export async function touchAndroidAutofill(ttlSeconds: number): Promise<boolean> {
  if (!androidAutofillSupported()) return false
  try {
    return await invoke<boolean>('android_autofill_touch', { ttlSeconds })
  } catch {
    return false
  }
}

/** Vide immédiatement le cache. */
export async function clearAndroidAutofill(): Promise<void> {
  if (!androidAutofillSupported()) return
  await invoke('android_autofill_clear')
}

export async function androidAutofillStatus(): Promise<AndroidAutofillStatus> {
  if (!androidAutofillSupported()) {
    return { supported: false, serviceEnabled: false, unlocked: false }
  }
  try {
    return await invoke<AndroidAutofillStatus>('android_autofill_status')
  } catch {
    return { supported: true, serviceEnabled: false, unlocked: false }
  }
}

/** Ouvre l’écran Android de sélection du service ; false si indisponible. */
export async function openAndroidAutofillSettings(): Promise<boolean> {
  if (!androidAutofillSupported()) return false
  try {
    return await invoke<boolean>('android_autofill_open_settings')
  } catch {
    return false
  }
}
