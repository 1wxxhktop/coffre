/**
 * Mises à jour de l’application desktop.
 *
 * La recherche, le téléchargement et l’installation passent par les commandes
 * Rust de `src-tauri/src/updater.rs` : l’adresse (releases GitHub) et la clé de
 * signature y sont fixées, la WebView ne peut pas les changer. Aucune requête
 * n’est faite tant que l’utilisateur n’a pas cliqué sur « Rechercher » ou
 * choisi une fréquence (désactivée par défaut).
 */

import { invoke } from '@tauri-apps/api/core'
import type { AppSettings } from './types'

export type UpdateChannel = AppSettings['updateChannel']
export type UpdateCheckFrequency = AppSettings['updateCheck']

export interface UpdaterInfo {
  /** Faux si la clé publique de signature n’a pas été intégrée au build. */
  configured: boolean
  currentVersion: string
}

export interface UpdateDescription {
  version: string
  currentVersion: string
  date: string | null
  notes: string | null
}

export interface UpdateProgress {
  downloaded: number
  total: number | null
}

/** Textes source (traduits par `tt`) des codes d’erreur. */
export const UPDATE_ERROR_TEXTS: Record<string, string> = {
  'not-configured':
    'Les mises à jour ne sont pas disponibles dans ce build : la clé de signature n’y est pas intégrée (build local ou de développement).',
  'invalid-channel': 'Canal de mise à jour invalide.',
  'check-failed':
    'Impossible de joindre le serveur de mises à jour. Vérifiez la connexion et réessayez.',
  'download-failed':
    'Téléchargement impossible, ou signature du paquet invalide. Rien n’a été installé.',
  'install-failed': 'Installation impossible. Coffre reste dans sa version actuelle.',
  'no-update': 'Cette mise à jour n’est plus disponible. Relancez une recherche.',
  'not-downloaded': 'Téléchargez la mise à jour avant de l’installer.',
  busy: 'Une opération de mise à jour est déjà en cours.',
}

export const UPDATE_PROGRESS_EVENT = 'coffre://update-progress'

/** Intervalle entre deux passages du planificateur. */
export const UPDATE_SCHEDULER_INTERVAL_MS = 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Vrai si une vérification automatique est due. « Au démarrage » ne vérifie
 * qu’une fois par lancement ; « quotidienne » et « hebdomadaire » suivent la
 * dernière vérification réussie.
 */
export function isUpdateCheckDue(
  settings: Pick<AppSettings, 'updateCheck' | 'updateLastCheckAt'>,
  now: Date,
  checkedThisLaunch: boolean,
): boolean {
  switch (settings.updateCheck) {
    case 'off':
      return false
    case 'launch':
      return !checkedThisLaunch
    case 'daily':
    case 'weekly': {
      if (!settings.updateLastCheckAt) return true
      const last = new Date(settings.updateLastCheckAt).getTime()
      // Une date future (horloge reculée) ne bloque pas indéfiniment.
      if (!Number.isFinite(last) || last > now.getTime()) return true
      const interval = settings.updateCheck === 'daily' ? DAY_MS : 7 * DAY_MS
      return now.getTime() - last >= interval
    }
  }
}

/** Vrai si la version trouvée a été ignorée par l’utilisateur. */
export function isSkippedVersion(
  settings: Pick<AppSettings, 'updateSkippedVersion'>,
  version: string,
): boolean {
  return settings.updateSkippedVersion === version
}

/** Vrai pour une préversion (`1.2.0-beta.1`). */
export function isPrerelease(version: string): boolean {
  return /^\d+\.\d+\.\d+-/.test(version)
}

/** Pourcentage téléchargé, ou `null` si la taille totale est inconnue. */
export function progressPercent(progress: UpdateProgress | null): number | null {
  if (!progress || !progress.total || progress.total <= 0) return null
  return Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
}

/** Code d’erreur stable à partir du message renvoyé par Rust. */
export function updateErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const code = message.split(':')[0].trim()
  return [
    'not-configured',
    'invalid-channel',
    'check-failed',
    'download-failed',
    'install-failed',
    'no-update',
    'not-downloaded',
    'busy',
  ].includes(code)
    ? code
    : 'check-failed'
}

export function updaterInfo(): Promise<UpdaterInfo> {
  return invoke<UpdaterInfo>('updater_info')
}

export function checkForUpdate(
  channel: UpdateChannel,
): Promise<UpdateDescription | null> {
  return invoke<UpdateDescription | null>('updater_check', { channel })
}

export function downloadUpdate(): Promise<void> {
  return invoke<void>('updater_download')
}

export function installUpdate(): Promise<void> {
  return invoke<void>('updater_install')
}

export function setInstallOnExit(enabled: boolean): Promise<void> {
  return invoke<void>('updater_install_on_exit', { enabled })
}

export function discardUpdate(): Promise<void> {
  return invoke<void>('updater_discard')
}
