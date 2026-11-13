/**
 * Saisie automatique dans l’application active (F9), via les commandes Tauri.
 * La séquence est vérifiée et tapée par Rust ; les secrets ne passent que par
 * l’IPC local et ne sont jamais écrits sur disque.
 */

import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './external'
import { isDesktopRuntime } from './platform'

export const DEFAULT_AUTOTYPE_SEQUENCE = '{USERNAME}{TAB}{PASSWORD}{ENTER}'

export interface ActiveWindowInfo {
  title: string
  appName: string
  processPath: string
  windowId: string
  processId: number
}

export interface AutoTypeInput {
  sequence: string
  username: string
  password: string
  totp: string
  expectedWindowId: string
  expectedProcessId: number
}

export function autotypeAvailable(): boolean {
  return isDesktopRuntime()
}

export async function autotypeActiveWindow(): Promise<ActiveWindowInfo> {
  if (!isTauriRuntime()) {
    throw new Error('La saisie automatique est réservée à l’application desktop.')
  }
  return invoke<ActiveWindowInfo>('autotype_active_window')
}

export async function runAutoType(input: AutoTypeInput): Promise<number> {
  if (!isTauriRuntime()) {
    throw new Error('La saisie automatique est réservée à l’application desktop.')
  }
  return invoke<number>('autotype_run', { ...input })
}
