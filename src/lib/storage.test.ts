import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearVaultStorage,
  listLocalBackups,
  loadBackupVaultFile,
  loadVaultFile,
  restoreBackup,
  saveVaultFile,
} from './storage'
import { createVaultFile } from './vault'
import type { VaultFile } from './types'

const PASSWORD = 'phrase de passe de test solide'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

async function makeVault(): Promise<VaultFile> {
  return (await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)).file
}

beforeEach(async () => {
  await clearVaultStorage()
})

describe('stockage local', () => {
  it('enregistre et relit le coffre chiffré', async () => {
    const file = await makeVault()
    await saveVaultFile(file)
    const loaded = await loadVaultFile()
    expect(loaded?.id).toBe(file.id)
    expect(loaded?.items).toHaveLength(0)
    expect(loaded?.kdf.salt).toBe(file.kdf.salt)
  })

  it('conserve la version précédente en sauvegarde', async () => {
    const first = await makeVault()
    await saveVaultFile(first)
    const second = await makeVault()
    await saveVaultFile(second)

    expect((await loadVaultFile())?.id).toBe(second.id)
    expect((await loadBackupVaultFile())?.id).toBe(first.id)
  })

  it('restaure la sauvegarde', async () => {
    const first = await makeVault()
    await saveVaultFile(first)
    const second = await makeVault()
    await saveVaultFile(second)

    const restored = await restoreBackup()
    expect(restored?.id).toBe(first.id)
    expect((await loadVaultFile())?.id).toBe(first.id)
  })

  it('conserve trois générations de sauvegarde', async () => {
    const files = []
    for (let index = 0; index < 4; index++) {
      const file = await makeVault()
      files.push(file)
      await saveVaultFile(file)
    }

    expect((await loadVaultFile())?.id).toBe(files[3].id)
    expect((await loadBackupVaultFile(1))?.id).toBe(files[2].id)
    expect((await loadBackupVaultFile(2))?.id).toBe(files[1].id)
    expect((await loadBackupVaultFile(3))?.id).toBe(files[0].id)
    expect(await loadBackupVaultFile(4)).toBeNull()

    const listed = await listLocalBackups()
    expect(listed.map((entry) => entry.generation)).toEqual([1, 2, 3])
    expect(listed[0].id).toBe(files[2].id)
  })

  it('restaure une génération choisie', async () => {
    const first = await makeVault()
    await saveVaultFile(first)
    const second = await makeVault()
    await saveVaultFile(second)
    const third = await makeVault()
    await saveVaultFile(third)

    const restored = await restoreBackup(2)
    expect(restored?.id).toBe(first.id)
    expect((await loadVaultFile())?.id).toBe(first.id)
    expect((await loadBackupVaultFile(1))?.id).toBe(third.id)
  })

  it('efface toutes les données', async () => {
    await saveVaultFile(await makeVault())
    await clearVaultStorage()
    expect(await loadVaultFile()).toBeNull()
    expect(await loadBackupVaultFile()).toBeNull()
  })
})
