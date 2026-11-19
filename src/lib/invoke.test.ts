import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  error: null as unknown,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async () => {
    throw native.error
  },
}))

import { invoke } from './invoke'
import { setActiveLocale } from './i18n'

beforeEach(() => {
  native.error = null
  setActiveLocale('fr')
})

describe('passerelle invoke', () => {
  it('traduit une erreur native en anglais', async () => {
    setActiveLocale('en')
    native.error = 'Coffre trop volumineux'
    await expect(invoke('vault_read')).rejects.toBe('Vault too large')
  })

  it('conserve le message français quand la langue est le français', async () => {
    native.error = 'Coffre trop volumineux'
    await expect(invoke('vault_read')).rejects.toBe('Coffre trop volumineux')
  })

  it('traduit une instance Error et conserve sa cause', async () => {
    setActiveLocale('en')
    const cause = new Error('Coffre trop volumineux')
    native.error = cause
    const error = await invoke('vault_read').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Vault too large')
    expect((error as Error).cause).toBe(cause)
  })

  it('laisse passer une erreur non textuelle', async () => {
    const error = { code: 'unknown' }
    native.error = error
    await expect(invoke('vault_read')).rejects.toBe(error)
  })
})
