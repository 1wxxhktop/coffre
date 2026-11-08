import { describe, expect, it } from 'vitest'
import { blobStoreAvailable, newBlobKey } from './blobStore'

describe('coffre de fichiers en flux', () => {
  it('génère une clé de 32 octets en base64', () => {
    const key = newBlobKey()
    expect(atob(key)).toHaveLength(32)
    expect(newBlobKey()).not.toBe(key)
  })

  it('refuse les commandes hors desktop', () => {
    expect(blobStoreAvailable()).toBe(false)
  })
})
