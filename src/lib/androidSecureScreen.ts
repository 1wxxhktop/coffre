/**
 * Protection contre les captures d’écran Android.
 *
 * `FLAG_SECURE` est appliqué à la fenêtre native : captures, enregistrements
 * et aperçu dans les applications récentes sont bloqués. Le choix est
 * mémorisé côté natif pour survivre à un redémarrage avant le chargement de
 * la WebView.
 */

import { invoke } from './invoke'
import { isAndroidRuntime } from './platform'

export function androidSecureScreenSupported(): boolean {
  return isAndroidRuntime()
}

/** Active ou désactive le blocage ; false si la commande est indisponible. */
export async function setAndroidSecureScreen(enabled: boolean): Promise<boolean> {
  if (!androidSecureScreenSupported()) return false
  try {
    return await invoke<boolean>('android_secure_screen_set', { enabled })
  } catch {
    return false
  }
}

/** État natif courant ; false hors Android ou en cas d’erreur. */
export async function androidSecureScreenEnabled(): Promise<boolean> {
  if (!androidSecureScreenSupported()) return false
  try {
    return await invoke<boolean>('android_secure_screen_enabled')
  } catch {
    return false
  }
}
