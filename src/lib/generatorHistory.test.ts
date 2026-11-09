import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendGeneratorHistory,
  changeMasterPassword,
  clearGeneratorHistory,
  createVaultFile,
  deleteGeneratorHistoryEntry,
  markGeneratorHistoryUsed,
  openVaultFileWithMasterKey,
  purgeGeneratorHistory,
  signVaultFile,
  verifyVaultFile,
} from './vault'
import { mergeVaultFiles } from './sync'

const PASSWORD = 'phrase de passe de test solide'
const NEXT = 'nouvelle phrase de passe solide'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

afterEach(() => {
  vi.restoreAllMocks()
})

async function vault() {
  return createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
}

describe('historique chiffré du générateur', () => {
  it('chiffre, relit et ne laisse pas le mot de passe en clair', async () => {
    const opened = await vault()
    const result = await appendGeneratorHistory(opened.file, opened.session, {
      password: 'Secret-généré-42!',
      domain: 'github.com',
    })
    const file = await signVaultFile(result.file, opened.session, opened.file)
    expect(JSON.stringify(file)).not.toContain('Secret-généré-42!')
    expect(result.entry.password).toBe('Secret-généré-42!')
    expect(result.entry.domain).toBe('github.com')

    const reopened = await openVaultFileWithMasterKey(file, opened.session.masterKey)
    expect(reopened.generatorHistory).toHaveLength(1)
    expect(reopened.generatorHistory[0]).toMatchObject({
      password: 'Secret-généré-42!',
      domain: 'github.com',
      state: 'available',
    })
    expect((await verifyVaultFile(file, reopened.session)).vaults).toBe(1)
    reopened.session.lock()
    opened.session.lock()
  })

  it('marque une entrée utilisée et conserve le nouvel état après fusion', async () => {
    const opened = await vault()
    const first = await appendGeneratorHistory(opened.file, opened.session, {
      password: 'Secret-fusion-42!',
      domain: 'gitlab.com',
      createdAt: '2026-11-09T10:00:00.000Z',
    })
    const signed = await signVaultFile(first.file, opened.session, opened.file)
    const used = await markGeneratorHistoryUsed(
      signed,
      opened.session,
      first.entry.id,
      'item-42',
    )
    const signedUsed = await signVaultFile(used.file, opened.session, signed)

    const merged = mergeVaultFiles(signedUsed, [signed])
    const reopened = await openVaultFileWithMasterKey(
      merged.file,
      opened.session.masterKey,
    )
    expect(reopened.generatorHistory[0]).toMatchObject({
      state: 'used',
      itemId: 'item-42',
    })
    reopened.session.lock()
    opened.session.lock()
  })

  it('supprime une entrée, tout effacer et purge la rétention', async () => {
    const opened = await vault()
    const first = await appendGeneratorHistory(opened.file, opened.session, {
      password: 'Secret-un-42!',
      createdAt: '2026-11-01T10:00:00.000Z',
    })
    const second = await appendGeneratorHistory(first.file, opened.session, {
      password: 'Secret-deux-42!',
      createdAt: '2026-11-09T10:00:00.000Z',
    })
    const oneRemoved = deleteGeneratorHistoryEntry(second.file, first.entry.id)
    expect(oneRemoved.generatorHistory).toHaveLength(1)

    const purged = purgeGeneratorHistory(
      second.file,
      7,
      Date.parse('2026-11-09T12:00:00.000Z'),
    )
    expect(purged.removedIds).toEqual([first.entry.id])
    expect(purged.file.generatorHistory).toHaveLength(1)

    const all = await appendGeneratorHistory(second.file, opened.session, {
      password: 'Secret-trois-42!',
      createdAt: '2026-11-09T10:00:00.000Z',
    })
    expect(clearGeneratorHistory(all.file).generatorHistory).toEqual([])

    const disabled = purgeGeneratorHistory(second.file, 0)
    expect(disabled.file.generatorHistory).toEqual([])
    expect(disabled.removedIds).toHaveLength(2)
    opened.session.lock()
  })

  it('réchiffre l’historique lors d’un changement de mot de passe', async () => {
    const opened = await vault()
    const result = await appendGeneratorHistory(opened.file, opened.session, {
      password: 'Secret-rotation-42!',
      domain: 'example.com',
    })
    const signed = await signVaultFile(result.file, opened.session, opened.file)
    const rotated = await changeMasterPassword(
      signed,
      opened.session,
      NEXT,
      FAST_KDF,
    )
    const reopened = await openVaultFileWithMasterKey(
      rotated,
      opened.session.masterKey,
    )
    expect(reopened.generatorHistory[0].password).toBe('Secret-rotation-42!')
    reopened.session.lock()
    opened.session.lock()
  })

  it('ne fait aucun appel réseau', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const opened = await vault()
    const result = await appendGeneratorHistory(opened.file, opened.session, {
      password: 'Secret-réseau-42!',
    })
    await openVaultFileWithMasterKey(result.file, opened.session.masterKey)
    expect(fetchSpy).not.toHaveBeenCalled()
    opened.session.lock()
  })
})
