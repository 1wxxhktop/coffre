import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSyncConfig,
  newSyncDeviceId,
  removeSyncConfig,
  saveSyncConfig,
  syncDeviceFileName,
  SYNC_CONFIG_KEY,
} from './syncConfig'

class MemoryStorage implements Storage {
  #values = new Map<string, string>()

  get length(): number {
    return this.#values.size
  }

  clear(): void {
    this.#values.clear()
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('configuration de synchronisation', () => {
  it('enregistre et relit une configuration par coffre', () => {
    const config = {
      version: 1 as const,
      fileId: 'vf_test',
      baseDir: '/Users/test/iCloud',
      dir: '/Users/test/iCloud/Coffre/vf_test',
      deviceId: 'w_abcdef',
      lastSyncAt: '2026-01-01T00:00:00.000Z',
      lastConflicts: 2,
    }
    saveSyncConfig(config)
    expect(getSyncConfig('vf_test')).toEqual(config)
    expect(syncDeviceFileName(config)).toBe('w_abcdef.coffre')
  })

  it('ignore les entrées invalides ou corrompues', () => {
    localStorage.setItem(SYNC_CONFIG_KEY, '{ pas du json')
    expect(getSyncConfig('vf_test')).toBeNull()

    localStorage.setItem(
      SYNC_CONFIG_KEY,
      JSON.stringify({
        vf_test: {
          version: 1,
          fileId: 'vf_autre',
          baseDir: '/x',
          dir: '/x/Coffre/vf_test',
          deviceId: 'w_x',
        },
      }),
    )
    expect(getSyncConfig('vf_test')).toBeNull()
  })

  it('supprime la configuration', () => {
    const config = {
      version: 1 as const,
      fileId: 'vf_test',
      baseDir: '/sync',
      dir: '/sync/Coffre/vf_test',
      deviceId: newSyncDeviceId(),
    }
    saveSyncConfig(config)
    expect(getSyncConfig('vf_test')).not.toBeNull()
    removeSyncConfig('vf_test')
    expect(getSyncConfig('vf_test')).toBeNull()
  })

  it('génère un identifiant d’appareil compatible avec les noms de fichier', () => {
    const id = newSyncDeviceId()
    expect(id).toMatch(/^w_[0-9a-f]{24}$/)
    expect(`${id}.coffre`).toMatch(/^[A-Za-z0-9_-]+\.coffre$/)
  })
})
