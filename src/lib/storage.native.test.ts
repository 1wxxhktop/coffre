import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVaultFile } from './vault'
import type { VaultFile } from './types'

const native = vi.hoisted(() => ({
  enabled: true,
  current: null as string | null,
  backups: new Map<number, string>(),
  state: null as string | null,
  calls: [] as Array<{ command: string; args: Record<string, unknown> }>,
}))

vi.mock('./external', () => ({
  isTauriRuntime: () => native.enabled,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    native.calls.push({ command, args })
    switch (command) {
      case 'vault_read':
        return native.current
      case 'vault_write':
        native.current = String(args.contents)
        return null
      case 'vault_backup_read':
        return native.backups.get(Number(args.generation)) ?? null
      case 'vault_backup_write':
        native.backups.set(Number(args.generation), String(args.contents))
        return null
      case 'vault_state_read':
        return native.state
      case 'vault_state_write':
        native.state = String(args.contents)
        return null
      case 'vault_clear':
        native.current = null
        native.backups.clear()
        native.state = null
        return null
      default:
        throw new Error(`commande inconnue : ${command}`)
    }
  },
}))

import {
  clearVaultStorage,
  listLocalBackups,
  loadBackupVaultFile,
  loadVaultFile,
  loadVaultState,
  overwriteVaultBackups,
  restoreBackup,
  saveVaultFile,
  saveVaultState,
  StorageError,
} from './storage'

const PASSWORD = 'phrase de passe de test solide'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

async function makeVault(): Promise<VaultFile> {
  return (await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)).file
}

/** Écrit un coffre dans l’ancien stockage IndexedDB, comme une version 0.7. */
async function seedIndexedDb(file: VaultFile, backup?: VaultFile): Promise<void> {
  const db = await openDB('coffre', 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('vault')) database.createObjectStore('vault')
    },
  })
  await db.put('vault', file, 'current')
  if (backup) await db.put('vault', backup, 'backup')
  db.close()
}

beforeEach(async () => {
  native.enabled = true
  native.current = null
  native.backups.clear()
  native.state = null
  native.calls = []
  const db = await openDB('coffre', 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('vault')) database.createObjectStore('vault')
    },
  })
  await db.clear('vault')
  db.close()
})

describe('stockage natif Tauri', () => {
  it('écrit et relit le coffre via les commandes natives', async () => {
    const file = await makeVault()
    await saveVaultFile(file)

    expect(native.calls.map((call) => call.command)).toEqual(['vault_write'])
    expect(native.current).not.toContain('\n')

    const loaded = await loadVaultFile()
    expect(loaded?.id).toBe(file.id)
    expect(loaded?.kdf.salt).toBe(file.kdf.salt)
  })

  it('lit les sauvegardes natives et les expose dans la liste', async () => {
    const first = await makeVault()
    const second = await makeVault()
    native.backups.set(1, JSON.stringify(second))
    native.backups.set(2, JSON.stringify(first))

    expect((await loadBackupVaultFile(1))?.id).toBe(second.id)
    const listed = await listLocalBackups()
    expect(listed.map((entry) => entry.generation)).toEqual([1, 2])
    expect(listed[0].id).toBe(second.id)
  })

  it('restaure une sauvegarde native', async () => {
    const current = await makeVault()
    const backup = await makeVault()
    native.current = JSON.stringify(current)
    native.backups.set(1, JSON.stringify(backup))

    const restored = await restoreBackup(1)
    expect(restored?.id).toBe(backup.id)
    expect((await loadVaultFile())?.id).toBe(backup.id)
  })

  it('migre un coffre IndexedDB vers le stockage natif', async () => {
    const legacy = await makeVault()
    const legacyBackup = await makeVault()
    await seedIndexedDb(legacy, legacyBackup)

    const loaded = await loadVaultFile()
    expect(loaded?.id).toBe(legacy.id)
    expect(native.current).not.toBeNull()

    const written = native.calls.filter((call) => call.command === 'vault_write')
    expect(written).toHaveLength(1)
    const migrated = JSON.parse(String(written[0].args.contents)) as VaultFile
    expect(migrated.id).toBe(legacy.id)

    const backupCalls = native.calls.filter(
      (call) => call.command === 'vault_backup_write',
    )
    expect(backupCalls.map((call) => call.args.generation)).toEqual([1])
    expect(native.backups.get(1)).toContain(legacyBackup.id)

    // Une seconde lecture ne re-migre pas.
    await loadVaultFile()
    expect(
      native.calls.filter((call) => call.command === 'vault_write'),
    ).toHaveLength(1)
  })

  it('écrase les trois sauvegardes pour le mode voyage', async () => {
    const file = await makeVault()
    await overwriteVaultBackups(file)
    const calls = native.calls.filter(
      (call) => call.command === 'vault_backup_write',
    )
    expect(calls.map((call) => call.args.generation)).toEqual([1, 2, 3])
    for (const generation of [1, 2, 3]) {
      expect(native.backups.get(generation)).toContain(file.id)
    }
  })

  it('lit un coffre natif existant sans consulter IndexedDB', async () => {
    const legacy = await makeVault()
    const current = await makeVault()
    await seedIndexedDb(legacy)
    native.current = JSON.stringify(current)

    expect((await loadVaultFile())?.id).toBe(current.id)
    expect(
      native.calls.filter((call) => call.command === 'vault_write'),
    ).toHaveLength(0)
  })

  it('efface le stockage natif et les anciennes données IndexedDB', async () => {
    native.current = JSON.stringify(await makeVault())
    native.backups.set(1, JSON.stringify(await makeVault()))
    await seedIndexedDb(await makeVault())

    await clearVaultStorage()

    expect(native.current).toBeNull()
    expect(native.backups.size).toBe(0)
    const db = await openDB('coffre', 1)
    expect(await db.count('vault')).toBe(0)
    db.close()
  })

  it('ne masque pas un coffre IndexedDB illisible', async () => {
    const db = await openDB('coffre', 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('vault')) database.createObjectStore('vault')
      },
    })
    await db.put('vault', { format: 'inconnu' }, 'current')
    db.close()

    await expect(loadVaultFile()).rejects.toBeInstanceOf(StorageError)
    expect(native.current).toBeNull()
  })

  it('conserve l’état anti-retour en arrière hors du coffre', async () => {
    expect(await loadVaultState()).toBeNull()
    const state = {
      fileId: 'vf_test',
      revision: 12,
      updatedAt: new Date().toISOString(),
    }
    await saveVaultState(state)
    expect(await loadVaultState()).toEqual(state)
    expect(native.calls.map((call) => call.command)).toContain('vault_state_write')

    await clearVaultStorage()
    expect(await loadVaultState()).toBeNull()
  })

  it('ignore un état anti-retour illisible sans bloquer le coffre', async () => {
    native.state = '{ pas du json'
    expect(await loadVaultState()).toBeNull()
    native.state = JSON.stringify({ fileId: 'vf_test', revision: -1 })
    expect(await loadVaultState()).toBeNull()
  })

  it('signale une erreur native explicite', async () => {
    native.enabled = true
    // Une valeur non JSON simule un fichier corrompu.
    native.current = '{ pas du json'
    await expect(loadVaultFile()).rejects.toBeInstanceOf(StorageError)
  })
})
