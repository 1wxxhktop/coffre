import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  enabled: true,
  calls: [] as Array<{ command: string; args: Record<string, unknown> }>,
  listener: null as ((event: { payload: { dir: string } }) => void) | null,
}))

vi.mock('./external', () => ({
  isTauriRuntime: () => native.enabled,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    native.calls.push({ command, args })
    switch (command) {
      case 'sync_prepare':
        return `/sync/Coffre/${String(args.fileId)}`
      case 'sync_list':
        return [
          { name: 'w_one.coffre', size: 42, modifiedAt: 1_700_000_000_000 },
        ]
      case 'sync_read':
        return args.name === 'absent.coffre' ? null : '{"format":"coffre"}'
      case 'sync_write':
      case 'sync_watch':
      case 'sync_unwatch':
        return null
      default:
        throw new Error(`commande inconnue : ${command}`)
    }
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (
    _name: string,
    listener: (event: { payload: { dir: string } }) => void,
  ) => {
    native.listener = listener
    return () => {
      native.listener = null
    }
  },
}))

import {
  listSyncFiles,
  onSyncFolderChanged,
  prepareSyncFolder,
  readSyncFile,
  SyncStorageError,
  watchSyncFolder,
  writeSyncFile,
} from './syncStorage'

beforeEach(() => {
  native.enabled = true
  native.calls = []
  native.listener = null
})

describe('stockage de synchronisation desktop', () => {
  it('prépare, liste, lit et écrit dans le dossier choisi', async () => {
    const dir = await prepareSyncFolder('/sync', 'vf_test')
    expect(dir).toBe('/sync/Coffre/vf_test')
    expect(native.calls[0]).toEqual({
      command: 'sync_prepare',
      args: { base: '/sync', fileId: 'vf_test' },
    })

    const files = await listSyncFiles(dir)
    expect(files).toEqual([
      { name: 'w_one.coffre', size: 42, modifiedAt: 1_700_000_000_000 },
    ])

    expect(await readSyncFile(dir, 'w_one.coffre')).toBe('{"format":"coffre"}')
    expect(await readSyncFile(dir, 'absent.coffre')).toBeNull()

    await writeSyncFile(dir, 'w_two.coffre', '{}')
    expect(native.calls.at(-1)).toEqual({
      command: 'sync_write',
      args: { dir, name: 'w_two.coffre', contents: '{}' },
    })

    await watchSyncFolder(dir)
    expect(native.calls.at(-1)?.command).toBe('sync_watch')
  })

  it('refuse les chemins et noms dangereux avant Rust', async () => {
    await expect(prepareSyncFolder('/sync', '../evasion')).rejects.toBeInstanceOf(
      SyncStorageError,
    )
    await expect(listSyncFiles('  ')).rejects.toBeInstanceOf(SyncStorageError)
    for (const name of [
      '../evasion.coffre',
      'sub/fichier.coffre',
      'fichier.txt',
      '.cache.coffre',
      'nom avec espace.coffre',
    ]) {
      await expect(readSyncFile('/sync', name)).rejects.toBeInstanceOf(
        SyncStorageError,
      )
      await expect(writeSyncFile('/sync', name, '{}')).rejects.toBeInstanceOf(
        SyncStorageError,
      )
    }
    expect(native.calls).toEqual([])
  })

  it('signale l’absence de runtime desktop', async () => {
    native.enabled = false
    await expect(listSyncFiles('/sync')).rejects.toBeInstanceOf(SyncStorageError)
    expect(native.calls).toEqual([])
  })

  it('transmet les changements de dossier', async () => {
    const received: string[] = []
    const unlisten = await onSyncFolderChanged((dir) => received.push(dir))
    native.listener?.({ payload: { dir: '/sync/Coffre/vf_test' } })
    expect(received).toEqual(['/sync/Coffre/vf_test'])
    unlisten()
    expect(native.listener).toBeNull()
  })
})
