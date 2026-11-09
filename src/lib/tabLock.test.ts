import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type LockCallback = (lock: { name: string } | null) => Promise<unknown>

/**
 * Implémentation minimale de `navigator.locks` partagée entre deux « onglets »
 * (deux instances du module) : un seul détenteur à la fois, `ifAvailable`
 * renvoie `null` si le verrou est pris.
 */
function createLockManager() {
  const held = new Set<string>()
  return {
    held,
    async request(name: string, options: { ifAvailable?: boolean }, callback: LockCallback) {
      if (held.has(name)) {
        if (options.ifAvailable) return callback(null)
        throw new Error('attente non simulée')
      }
      held.add(name)
      try {
        return await callback({ name })
      } finally {
        held.delete(name)
      }
    },
  }
}

async function loadTab() {
  vi.resetModules()
  return import('./tabLock')
}

describe('verrou d’onglet', () => {
  let manager: ReturnType<typeof createLockManager>

  beforeEach(() => {
    manager = createLockManager()
    vi.stubGlobal('navigator', { locks: manager })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('n’accorde la session qu’à un onglet à la fois', async () => {
    const tabA = await loadTab()
    const tabB = await loadTab()

    await expect(tabA.acquireVaultLock()).resolves.toBe(true)
    await expect(tabB.acquireVaultLock()).resolves.toBe(false)
    // Le détenteur peut redemander le verrou sans se bloquer lui-même.
    await expect(tabA.acquireVaultLock()).resolves.toBe(true)

    tabA.releaseVaultLock()
    await vi.waitFor(() => expect(manager.held.size).toBe(0))
    await expect(tabB.acquireVaultLock()).resolves.toBe(true)
    tabB.releaseVaultLock()
  })

  it('autorise la session si Web Locks est absent', async () => {
    vi.stubGlobal('navigator', {})
    const tab = await loadTab()
    expect(tab.vaultLockSupported()).toBe(false)
    await expect(tab.acquireVaultLock()).resolves.toBe(true)
  })
})
