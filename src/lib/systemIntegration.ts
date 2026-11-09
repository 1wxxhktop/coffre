/**
 * Intégration desktop : verrouillage avec la session, barre de menus,
 * démarrage à l’ouverture de session et démarrage masqué.
 *
 * Les charges utiles d’événements ne contiennent qu’un type (`lock` ou
 * `sleep`), jamais un nom d’élément ni un secret.
 */

import { invoke } from '@tauri-apps/api/core'
import type { AppSettings } from './types'

export const SYSTEM_LOCK_EVENT = 'coffre://system-lock'
export const TRAY_GENERATOR_EVENT = 'coffre:tray-generator'
export const TRAY_LOCK_EVENT = 'coffre:tray-lock'

export type SystemLockKind = 'lock' | 'sleep'

export interface SystemLockPayload {
  kind?: SystemLockKind
}

/**
 * Décide si un événement système doit verrouiller le coffre. Un type inconnu
 * ou une charge malformée est ignoré : l’absence de verrouillage explicite ne
 * doit jamais dépendre d’un contenu non validé.
 */
export function systemLockShouldLock(
  settings: Pick<AppSettings, 'lockOnSystemLock' | 'lockOnSleep'>,
  payload: unknown,
): boolean {
  if (!payload || typeof payload !== 'object') return false
  const kind = (payload as SystemLockPayload).kind
  if (kind === 'lock') return settings.lockOnSystemLock
  if (kind === 'sleep') return settings.lockOnSleep
  return false
}

export async function setTrayLanguage(language: AppSettings['language']): Promise<void> {
  await invoke('tray_set_language', { language })
}

export async function setTrayKeepOnClose(keep: boolean): Promise<void> {
  await invoke('tray_set_keep_on_close', { keep })
}

export async function getAutostartEnabled(): Promise<boolean> {
  return invoke<boolean>('autostart_enabled')
}

export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  await invoke('autostart_set', { enabled })
}

export async function isStartedHidden(): Promise<boolean> {
  return invoke<boolean>('startup_is_hidden')
}
