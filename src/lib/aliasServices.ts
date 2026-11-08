/**
 * Création d’alias via SimpleLogin ou addy.io (F7, opt-in).
 * La clé API n’est pas persistée par ce module.
 */

import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './external'

export type AliasService = 'simplelogin' | 'addy'

export async function createRemoteAlias(input: {
  service: AliasService
  apiKey: string
  description: string
  domain?: string
}): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error('La création d’alias distante est réservée au desktop.')
  }
  return invoke<string>('alias_create', {
    service: input.service,
    apiKey: input.apiKey,
    description: input.description,
    domain: input.domain,
  })
}
