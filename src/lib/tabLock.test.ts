import { describe, expect, it } from 'vitest'
import { acquireVaultLock, releaseVaultLock } from './tabLock'

describe('verrou d’onglet', () => {
  it('autorise une session quand Web Locks est disponible ou non', async () => {
    await expect(acquireVaultLock()).resolves.toBe(true)
    releaseVaultLock()
  })
})
