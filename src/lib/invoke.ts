/**
 * Point d’entrée unique vers les commandes Tauri.
 *
 * Les messages d’erreur du backend Rust sont en français ; cette enveloppe les
 * traduit dans la langue active avant qu’ils n’atteignent l’interface. Aucun
 * autre comportement de `invoke` n’est modifié.
 */

import {
  invoke as tauriInvoke,
  type InvokeArgs,
  type InvokeOptions,
} from '@tauri-apps/api/core'
import { translateBackendError } from './backendErrors'
import { getActiveLocale } from './i18n'

function translateError(error: unknown): unknown {
  const locale = getActiveLocale()
  if (typeof error === 'string') {
    return translateBackendError(locale, error)
  }
  if (error instanceof Error) {
    const message = translateBackendError(locale, error.message)
    if (message === error.message) return error
    return new Error(message, { cause: error })
  }
  return error
}

export async function invoke<T>(
  command: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args, options)
  } catch (error) {
    throw translateError(error)
  }
}
