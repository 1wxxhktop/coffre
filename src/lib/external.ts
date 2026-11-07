/**
 * Ouverture de liens externes.
 *
 * Dans le navigateur, le comportement natif de l’ancre suffit. Dans Tauri, on
 * empêche la navigation de la WebView et on délègue au navigateur système via
 * une commande Rust qui n’accepte que http(s).
 */

import { invoke } from '@tauri-apps/api/core'

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function openExternal(url: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return true
  }
  try {
    await invoke('open_external_url', { url })
    return true
  } catch {
    return false
  }
}

/** À utiliser dans un onClick d’ancre : laisse le Web faire son travail. */
export function handleExternalClick(
  event: { preventDefault: () => void },
  url: string,
): void {
  if (!isTauriRuntime()) return
  event.preventDefault()
  void openExternal(url)
}
