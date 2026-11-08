import { describe, expect, it } from 'vitest'
import {
  hasHiddenVaultCiphertext,
  stripVaultForTravel,
} from './travelMode'
import type { VaultFile } from './types'

function file(): VaultFile {
  return {
    format: 'coffre',
    version: 4,
    id: 'file',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    kdf: {
      algorithm: 'argon2id',
      salt: 'salt',
      memoryKiB: 8192,
      iterations: 1,
      parallelism: 1,
      keyLength: 32,
    },
    vaults: [
      { id: 'safe', key: { n: 'a', c: 'SAFE-VAULT' }, name: { n: 'a', c: 'SAFE-NAME' }, createdAt: '', updatedAt: '' },
      { id: 'hidden', key: { n: 'b', c: 'HIDDEN-VAULT' }, name: { n: 'b', c: 'HIDDEN-NAME' }, createdAt: '', updatedAt: '' },
    ],
    items: [
      { id: 'i-safe', vaultId: 'safe', key: { n: 'c', c: 'SAFE-ITEM-KEY' }, content: { n: 'c', c: 'SAFE-CONTENT' }, createdAt: '', updatedAt: '' },
      { id: 'i-hidden', vaultId: 'hidden', key: { n: 'd', c: 'HIDDEN-ITEM-KEY' }, content: { n: 'd', c: 'HIDDEN-CONTENT' }, createdAt: '', updatedAt: '' },
    ],
    attachments: [
      { id: 'a-safe', itemId: 'i-safe', vaultId: 'safe', data: { n: 'e', c: 'SAFE-ATTACHMENT' }, createdAt: '' },
      { id: 'a-hidden', itemId: 'i-hidden', vaultId: 'hidden', data: { n: 'f', c: 'HIDDEN-ATTACHMENT' }, createdAt: '' },
    ],
    versions: [
      { id: 'v-safe', itemId: 'i-safe', vaultId: 'safe', content: { n: 'g', c: 'SAFE-VERSION' }, createdAt: '' },
      { id: 'v-hidden', itemId: 'i-hidden', vaultId: 'hidden', content: { n: 'h', c: 'HIDDEN-VERSION' }, createdAt: '' },
    ],
    tombstones: [{ kind: 'item', id: 'i-hidden', deletedAt: '2026-01-01T00:00:00.000Z' }],
  } as VaultFile
}

describe('mode voyage', () => {
  it('retire tous les ciphertexts des coffres non sûrs', () => {
    const source = file()
    expect(hasHiddenVaultCiphertext(source, ['hidden'])).toBe(true)

    const stripped = stripVaultForTravel(source, ['safe'])
    expect(stripped.vaults.map((vault) => vault.id)).toEqual(['safe'])
    expect(stripped.items.map((item) => item.id)).toEqual(['i-safe'])
    expect(stripped.attachments.map((entry) => entry.id)).toEqual(['a-safe'])
    expect(stripped.versions.map((entry) => entry.id)).toEqual(['v-safe'])
    expect(hasHiddenVaultCiphertext(stripped, ['hidden'])).toBe(false)

    const json = JSON.stringify(stripped)
    expect(json).not.toContain('HIDDEN-VAULT')
    expect(json).not.toContain('HIDDEN-NAME')
    expect(json).not.toContain('HIDDEN-ITEM-KEY')
    expect(json).not.toContain('HIDDEN-CONTENT')
    expect(json).not.toContain('HIDDEN-ATTACHMENT')
    expect(json).not.toContain('HIDDEN-VERSION')
    // Les pierres tombales existantes ne contiennent aucun ciphertext.
    expect(stripped.tombstones).toHaveLength(1)
  })

  it('refuse une sélection vide', () => {
    expect(() => stripVaultForTravel(file(), [])).toThrow(/au moins un coffre/)
  })
})
