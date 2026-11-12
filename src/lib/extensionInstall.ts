/**
 * Copie gérée de l’extension navigateur.
 *
 * L’application desktop embarque l’extension et en tient une copie à jour dans
 * son dossier de données. L’utilisateur charge ce dossier une fois dans son
 * navigateur ; après chaque mise à jour de Coffre, l’extension apprend par le
 * pont natif qu’une version plus récente est sur le disque et se recharge.
 */

import { invoke } from '@tauri-apps/api/core'
import { keychainAvailable } from './keychain'
import type { AppSettings } from './types'

export interface ExtensionInstallInfo {
  /** Faux si ce build n’embarque pas l’extension (build de développement). */
  available: boolean
  version: string | null
  /** Dossier à charger une fois dans le navigateur. */
  path: string | null
  /** Vrai si la copie vient d’être créée ou remplacée. */
  updated: boolean
}

const UNAVAILABLE: ExtensionInstallInfo = {
  available: false,
  version: null,
  path: null,
  updated: false,
}

/** État de la copie gérée ; indisponible hors de l’application desktop. */
export async function extensionInstallInfo(): Promise<ExtensionInstallInfo> {
  if (!keychainAvailable()) return UNAVAILABLE
  try {
    const info = await invoke<Partial<ExtensionInstallInfo>>('extension_info')
    return {
      available: info.available === true,
      version: typeof info.version === 'string' ? info.version : null,
      path: typeof info.path === 'string' ? info.path : null,
      updated: info.updated === true,
    }
  } catch {
    return UNAVAILABLE
  }
}

/** Ouvre le dossier de l’extension dans le gestionnaire de fichiers. */
export async function revealExtensionFolder(): Promise<boolean> {
  if (!keychainAvailable()) return false
  try {
    await invoke('extension_reveal')
    return true
  } catch {
    return false
  }
}

export {
  isNewerVersion,
  selfUpdateDecision,
  type SelfUpdateDecision,
} from './extensionVersion'

type UpdateSettingsSlice = Pick<
  AppSettings,
  'updateCheck' | 'updateAutoDownload' | 'updateInstallMode'
>

/** Vrai si tout est réglé pour que Coffre se mette à jour sans intervention. */
export function isFullyAutomaticUpdate(settings: UpdateSettingsSlice): boolean {
  return (
    settings.updateCheck !== 'off' &&
    settings.updateAutoDownload &&
    settings.updateInstallMode === 'on-quit'
  )
}

/**
 * Réglages appliqués par l’interrupteur « Mettre à jour automatiquement ».
 * Activé : recherche continue si elle était coupée, téléchargement en
 * arrière-plan et installation à la fermeture. Désactivé : plus aucune requête
 * automatique, et l’installation redevient une décision explicite.
 */
export function automaticUpdatePreset(
  enabled: boolean,
  current: UpdateSettingsSlice,
): UpdateSettingsSlice {
  return enabled
    ? {
        updateCheck: current.updateCheck === 'off' ? 'continuous' : current.updateCheck,
        updateAutoDownload: true,
        updateInstallMode: 'on-quit',
      }
    : { updateCheck: 'off', updateAutoDownload: false, updateInstallMode: 'ask' }
}
