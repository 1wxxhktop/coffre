import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSharedSyncConfig,
  listSharedSyncConfigs,
  removeSharedSyncConfig,
  saveSharedSyncConfig,
} from './sharedSyncConfig'

class MemoryStorage {
  #values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  clear(): void {
    this.#values.clear()
  }
}

const storage = new MemoryStorage()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', storage)
})

describe('configuration de synchronisation partagée', () => {
  it('enregistre et relit un dossier par coffre', () => {
    saveSharedSyncConfig({
      version: 1,
      platform: 'desktop',
      fileId: 'vf_test',
      vaultId: 'v_shared',
      dir: '/Dossier partagé',
      lastImports: {
        'shared-v_shared-SHA256_abc.coffre-shared.json': 'YWJjZGVmZ2hpamtsbW5vcA==',
      },
    })
    const config = getSharedSyncConfig('vf_test', 'v_shared')
    expect(config?.dir).toBe('/Dossier partagé')
    expect(config?.lastImports['shared-v_shared-SHA256_abc.coffre-shared.json']).toBe(
      'YWJjZGVmZ2hpamtsbW5vcA==',
    )
    expect(listSharedSyncConfigs('vf_test')).toHaveLength(1)
    expect(listSharedSyncConfigs('autre')).toEqual([])
    removeSharedSyncConfig('vf_test', 'v_shared')
    expect(getSharedSyncConfig('vf_test', 'v_shared')).toBeNull()
  })

  it('refuse une configuration ou des noms invalides', () => {
    expect(() =>
      saveSharedSyncConfig({
        version: 1,
        platform: 'desktop',
        fileId: '../evasion',
        vaultId: 'v_shared',
        dir: '/tmp',
        lastImports: {},
      }),
    ).toThrow()
    expect(() =>
      saveSharedSyncConfig({
        version: 1,
        platform: 'web',
        fileId: 'vf_test',
        vaultId: 'v_shared',
        dir: 'Dossier',
        lastImports: { '../evasion.coffre-shared.json': 'YWJjZGVmZ2hpamtsbW5vcA==' },
      }),
    ).toThrow()
  })
})
