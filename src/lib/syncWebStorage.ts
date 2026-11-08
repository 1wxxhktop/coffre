/**
 * Synchronisation Web via File System Access API (Chromium).
 *
 * Le dossier choisi est conservé sous forme de `FileSystemDirectoryHandle` dans
 * IndexedDB. Aucun contenu de coffre n’y est stocké en clair : les fichiers
 * `.coffre` sont déjà chiffrés et signés.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { SyncFileInfo } from './syncStorage'

export const MAX_WEB_SYNC_BYTES = 100 * 1024 * 1024
const DB_NAME = 'coffre-sync'
const DB_VERSION = 1
const HANDLE_STORE = 'handles'
const FILE_ID = /^[A-Za-z0-9_-]{1,80}$/
const FILE_NAME = /^[A-Za-z0-9_-]+\.coffre$/
const README_TEXT = `Coffre — synchronisation locale

Ce dossier contient un fichier .coffre par appareil. Chaque appareil n’écrit
que son propre fichier et lit les autres pour les fusionner.

Ne modifiez pas ces fichiers à la main. Aucun serveur Coffre n’intervient :
la synchronisation utilise uniquement le dossier choisi par l’utilisateur.
`

interface HandleDb extends DBSchema {
  handles: {
    key: string
    value: FileSystemDirectoryHandle
  }
}

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: {
    id?: string
    mode?: 'read' | 'readwrite'
  }) => Promise<FileSystemDirectoryHandle>
}

interface PermissionCapableHandle {
  queryPermission?: (descriptor: {
    mode: 'read' | 'readwrite'
  }) => Promise<PermissionState>
  requestPermission?: (descriptor: {
    mode: 'read' | 'readwrite'
  }) => Promise<PermissionState>
}

let dbPromise: Promise<IDBPDatabase<HandleDb>> | null = null

function database(): Promise<IDBPDatabase<HandleDb>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB est indisponible'))
  }
  if (!dbPromise) {
    dbPromise = openDB<HandleDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(HANDLE_STORE)) {
          db.createObjectStore(HANDLE_STORE)
        }
      },
    }).catch((error: unknown) => {
      dbPromise = null
      throw error
    })
  }
  return dbPromise
}

export class WebSyncError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WebSyncError'
  }
}

export function webSyncAvailable(): boolean {
  if (typeof window === 'undefined') return false
  return typeof (window as unknown as DirectoryPickerWindow).showDirectoryPicker ===
    'function'
}

export async function pickWebSyncDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as unknown as DirectoryPickerWindow).showDirectoryPicker
  if (!picker) {
    throw new WebSyncError(
      'Ce navigateur ne propose pas le choix d’un dossier local. Utilisez l’export et l’import manuels.',
    )
  }
  return picker({ id: 'coffre-sync', mode: 'readwrite' })
}

export async function ensureWebSyncPermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const permission = handle as unknown as PermissionCapableHandle
  if (!permission.queryPermission || !permission.requestPermission) return true
  try {
    if ((await permission.queryPermission({ mode: 'readwrite' })) === 'granted') {
      return true
    }
    return (await permission.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

function validFileId(fileId: string): void {
  if (!FILE_ID.test(fileId)) {
    throw new WebSyncError('Identifiant de coffre invalide pour la synchronisation')
  }
}

function validFileName(name: string): void {
  if (!FILE_NAME.test(name)) {
    throw new WebSyncError('Nom de fichier de synchronisation invalide')
  }
}

async function syncDirectory(
  handle: FileSystemDirectoryHandle,
  fileId: string,
): Promise<FileSystemDirectoryHandle> {
  validFileId(fileId)
  const coffre = await handle.getDirectoryHandle('Coffre')
  return coffre.getDirectoryHandle(fileId)
}

async function writeFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  contents: string,
): Promise<void> {
  const file = await directory.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  try {
    await writable.write(contents)
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
}

/** Crée `Coffre/<idFichier>/` et renvoie un libellé lisible. */
export async function prepareWebSyncDirectory(
  handle: FileSystemDirectoryHandle,
  fileId: string,
): Promise<string> {
  validFileId(fileId)
  if (!(await ensureWebSyncPermission(handle))) {
    throw new WebSyncError('L’accès au dossier choisi a été refusé.')
  }
  const coffre = await handle.getDirectoryHandle('Coffre', { create: true })
  const directory = await coffre.getDirectoryHandle(fileId, { create: true })
  try {
    await directory.getFileHandle('README.txt')
  } catch {
    await writeFile(directory, 'README.txt', README_TEXT)
  }
  return `${handle.name}/Coffre/${fileId}`
}

export async function listWebSyncFiles(
  handle: FileSystemDirectoryHandle,
  fileId: string,
): Promise<SyncFileInfo[]> {
  if (!(await ensureWebSyncPermission(handle))) {
    throw new WebSyncError('L’accès au dossier choisi a été refusé.')
  }
  const directory = await syncDirectory(handle, fileId)
  const files: SyncFileInfo[] = []
  for await (const [name, entry] of directory.entries()) {
    if (entry.kind !== 'file' || !FILE_NAME.test(name)) continue
    try {
      const file = await (entry as FileSystemFileHandle).getFile()
      if (file.size > MAX_WEB_SYNC_BYTES) continue
      files.push({
        name,
        size: file.size,
        modifiedAt: Number.isFinite(file.lastModified) ? file.lastModified : null,
      })
    } catch {
      // Un fichier supprimé entre l’énumération et la lecture est ignoré.
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readWebSyncFile(
  handle: FileSystemDirectoryHandle,
  fileId: string,
  name: string,
): Promise<string | null> {
  validFileName(name)
  if (!(await ensureWebSyncPermission(handle))) {
    throw new WebSyncError('L’accès au dossier choisi a été refusé.')
  }
  const directory = await syncDirectory(handle, fileId)
  try {
    const fileHandle = await directory.getFileHandle(name)
    const file = await fileHandle.getFile()
    if (file.size > MAX_WEB_SYNC_BYTES) {
      throw new WebSyncError('Fichier de synchronisation trop volumineux')
    }
    return await file.text()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

export async function writeWebSyncFile(
  handle: FileSystemDirectoryHandle,
  fileId: string,
  name: string,
  contents: string,
): Promise<void> {
  validFileName(name)
  if (contents.length > MAX_WEB_SYNC_BYTES) {
    throw new WebSyncError('Fichier de synchronisation trop volumineux')
  }
  if (!(await ensureWebSyncPermission(handle))) {
    throw new WebSyncError('L’accès au dossier choisi a été refusé.')
  }
  const directory = await syncDirectory(handle, fileId)
  await writeFile(directory, name, contents)
}

export async function saveWebSyncHandle(
  fileId: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  validFileId(fileId)
  const db = await database()
  await db.put(HANDLE_STORE, handle, fileId)
}

export async function loadWebSyncHandle(
  fileId: string,
): Promise<FileSystemDirectoryHandle | null> {
  validFileId(fileId)
  const db = await database()
  return (await db.get(HANDLE_STORE, fileId)) ?? null
}

export async function clearWebSyncHandle(fileId: string): Promise<void> {
  validFileId(fileId)
  const db = await database()
  await db.delete(HANDLE_STORE, fileId)
}
