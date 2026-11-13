/**
 * Détection de la plateforme d’exécution.
 *
 * Le Web et les tests restent « web » ; Android/iOS sont des runtimes Tauri
 * mobiles qui n’embarquent ni tray, ni auto-type, ni mises à jour de bureau.
 */
import { isTauriRuntime } from './external'

export function isMobileUserAgent(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod/i.test(userAgent)
}

export function isMobileRuntime(): boolean {
  if (!isTauriRuntime() || typeof navigator === 'undefined') return false
  return isMobileUserAgent(navigator.userAgent)
}

export function isDesktopRuntime(): boolean {
  return isTauriRuntime() && !isMobileRuntime()
}
