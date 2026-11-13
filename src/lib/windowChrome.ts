/**
 * Style de barre de titre selon la plateforme.
 *
 * macOS utilise la barre native en surcouche (feux de circulation).
 * Windows reçoit une barre dessinée par l’application, sans décoration native.
 * Le Web et Linux conservent la barre fournie par le système.
 */
export type WindowChrome = 'macos' | 'windows' | 'native'

export function windowChrome(
  userAgent: string,
  tauri: boolean,
): WindowChrome {
  if (!tauri) return 'native'
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macos'
  if (/Windows/i.test(userAgent)) return 'windows'
  return 'native'
}

export function currentWindowChrome(): WindowChrome {
  if (typeof window === 'undefined') return 'native'
  return windowChrome(
    navigator.userAgent,
    '__TAURI_INTERNALS__' in window,
  )
}
