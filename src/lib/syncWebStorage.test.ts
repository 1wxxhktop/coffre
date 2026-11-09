import { describe, expect, it } from 'vitest'
import {
  ensureWebSyncPermission,
  listWebSharedFiles,
  listWebSyncFiles,
  prepareWebSyncDirectory,
  readWebSharedFile,
  readWebSyncFile,
  writeWebSharedFile,
  writeWebSyncFile,
} from './syncWebStorage'

class FakeWritable {
  #target: FakeFileHandle
  #chunks: string[] = []

  constructor(target: FakeFileHandle) {
    this.#target = target
  }

  async write(value: string): Promise<void> {
    this.#chunks.push(value)
  }

  async close(): Promise<void> {
    this.#target.content = this.#chunks.join('')
    this.#target.modified = Date.now()
  }

  async abort(): Promise<void> {
    this.#chunks = []
  }
}

class FakeFileHandle {
  readonly kind = 'file' as const
  readonly name: string
  content: string
  modified: number

  constructor(name: string, content = '', modified = Date.now()) {
    this.name = name
    this.content = content
    this.modified = modified
  }

  async getFile(): Promise<File> {
    return {
      name: this.name,
      size: new TextEncoder().encode(this.content).length,
      lastModified: this.modified,
      text: async () => this.content,
    } as unknown as File
  }

  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this)
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory' as const
  readonly name: string
  readonly files = new Map<string, FakeFileHandle>()
  readonly directories = new Map<string, FakeDirectoryHandle>()

  constructor(name: string) {
    this.name = name
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeDirectoryHandle> {
    const existing = this.directories.get(name)
    if (existing) return existing
    if (!options?.create) throw new DOMException('absent', 'NotFoundError')
    const directory = new FakeDirectoryHandle(name)
    this.directories.set(name, directory)
    return directory
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeFileHandle> {
    const existing = this.files.get(name)
    if (existing) return existing
    if (!options?.create) throw new DOMException('absent', 'NotFoundError')
    const file = new FakeFileHandle(name)
    this.files.set(name, file)
    return file
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.directories.delete(name)) {
      throw new DOMException('absent', 'NotFoundError')
    }
  }

  async *entries(): AsyncGenerator<
    [string, FakeDirectoryHandle | FakeFileHandle]
  > {
    for (const [name, directory] of this.directories) yield [name, directory]
    for (const [name, file] of this.files) yield [name, file]
  }
}

function directory(): FakeDirectoryHandle {
  return new FakeDirectoryHandle('Dossier de test')
}

describe('synchronisation Web (File System Access)', () => {
  it('prépare Coffre/<id>, écrit et relit un fichier', async () => {
    const root = directory()
    const label = await prepareWebSyncDirectory(
      root as unknown as FileSystemDirectoryHandle,
      'vf_test',
    )
    expect(label).toBe('Dossier de test/Coffre/vf_test')

    const handle = root.directories.get('Coffre')!.directories.get('vf_test')!
    expect(handle.files.has('README.txt')).toBe(true)

    await writeWebSyncFile(
      root as unknown as FileSystemDirectoryHandle,
      'vf_test',
      'w_one.coffre',
      '{"format":"coffre"}',
    )
    expect(
      await readWebSyncFile(
        root as unknown as FileSystemDirectoryHandle,
        'vf_test',
        'w_one.coffre',
      ),
    ).toBe('{"format":"coffre"}')

    const files = await listWebSyncFiles(
      root as unknown as FileSystemDirectoryHandle,
      'vf_test',
    )
    expect(files.map((entry) => entry.name)).toEqual(['w_one.coffre'])
    expect(files[0].size).toBeGreaterThan(0)
  })

  it('refuse les noms dangereux et les identifiants invalides', async () => {
    const root = directory()
    await prepareWebSyncDirectory(
      root as unknown as FileSystemDirectoryHandle,
      'vf_test',
    )
    for (const name of [
      '../evasion.coffre',
      'sub/fichier.coffre',
      'fichier.txt',
      '.cache.coffre',
      'nom avec espace.coffre',
      '.coffre-shared.json',
      'sub/partage.coffre-shared.json',
    ]) {
      await expect(
        readWebSyncFile(
          root as unknown as FileSystemDirectoryHandle,
          'vf_test',
          name,
        ),
      ).rejects.toThrow()
      await expect(
        writeWebSyncFile(
          root as unknown as FileSystemDirectoryHandle,
          'vf_test',
          name,
          '{}',
        ),
      ).rejects.toThrow()
    }
    await expect(
      prepareWebSyncDirectory(
        root as unknown as FileSystemDirectoryHandle,
        '../evasion',
      ),
    ).rejects.toThrow()
  })

  it('lit et écrit un bundle de coffre partagé', async () => {
    const root = directory() as unknown as FileSystemDirectoryHandle
    const name = 'shared-v_test-SHA256_abc.coffre-shared.json'
    await writeWebSharedFile(root, name, '{"format":"coffre-shared-vault"}')
    expect(await readWebSharedFile(root, name)).toBe(
      '{"format":"coffre-shared-vault"}',
    )
    const files = await listWebSharedFiles(root)
    expect(files.map((entry) => entry.name)).toEqual([name])
  })

  it('renvoie null pour un fichier absent', async () => {
    const root = directory()
    await prepareWebSyncDirectory(
      root as unknown as FileSystemDirectoryHandle,
      'vf_test',
    )
    expect(
      await readWebSyncFile(
        root as unknown as FileSystemDirectoryHandle,
        'vf_test',
        'absent.coffre',
      ),
    ).toBeNull()
  })

  it('demande la permission d’écriture si nécessaire', async () => {
    const root = directory() as FakeDirectoryHandle & {
      queryPermission: () => Promise<PermissionState>
      requestPermission: () => Promise<PermissionState>
    }
    let requested = false
    root.queryPermission = async () => 'prompt'
    root.requestPermission = async () => {
      requested = true
      return 'granted'
    }
    expect(
      await ensureWebSyncPermission(
        root as unknown as FileSystemDirectoryHandle,
      ),
    ).toBe(true)
    expect(requested).toBe(true)
  })
})
