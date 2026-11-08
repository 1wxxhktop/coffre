import { describe, expect, it } from 'vitest'
import {
  formatFingerprint,
  lanIdentity,
  lanSyncAvailable,
} from './lanSync'

describe('synchronisation locale', () => {
  it('formate une empreinte par groupes de quatre caractères', () => {
    expect(formatFingerprint('a1b2c3d4e5f6')).toBe('A1B2 C3D4 E5F6')
    expect(formatFingerprint('')).toBe('')
  })

  it('refuse les commandes hors application desktop', async () => {
    expect(lanSyncAvailable()).toBe(false)
    await expect(lanIdentity()).rejects.toThrow(/desktop/)
  })
})
