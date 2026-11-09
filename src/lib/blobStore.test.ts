import { describe, expect, it } from 'vitest'
import { blobStoreAvailable, newBlobKey, referencedBlobIds } from './blobStore'
import type { VaultItem } from './types'

describe('coffre de fichiers en flux', () => {
  it('génère une clé de 32 octets en base64', () => {
    const key = newBlobKey()
    expect(atob(key)).toHaveLength(32)
    expect(newBlobKey()).not.toBe(key)
  })

  it('refuse les commandes hors desktop', () => {
    expect(blobStoreAvailable()).toBe(false)
  })

  it('liste les blobs référencés par les pièces jointes', () => {
    const items = [
      {
        attachments: [
          { storage: 'blob', blobId: 'b_one' },
          { storage: 'blob', blobId: 'b_one' },
          { storage: 'inline', blobId: 'b_ignore' },
          { storage: 'blob' },
        ],
      },
      {
        attachments: [{ storage: 'blob', blobId: 'b_two' }],
      },
    ] as unknown as VaultItem[]
    expect(referencedBlobIds(items).sort()).toEqual(['b_one', 'b_two'])
  })
})
