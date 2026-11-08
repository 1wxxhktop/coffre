/**
 * Accès desktop au dossier de synchronisation.
 *
 * Les chemins et noms sont validés une seconde fois côté Rust ; la validation
 * locale évite simplement d’envoyer des commandes inutiles et donne un message
 * clair. Aucun secret ne transite par ces fonctions : les fichiers `.coffre`
 * sont déjà chiffrés et signés.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauriRuntime } from './external'

export const MAX_SYNC_FILE_BYTES = 100 * 1024 * 1024

export interface SyncFileInfo {
  name: string
  size: number
  modifiedAt: number | null
}

export class SyncStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SyncStorageError'
  }
}

const FILE_ID = /^[A-Za-z0-9_-]{1,80}$/
const FILE_NAME = /^[A-Za-z0-9_-]+\.coffre$/

function requireDesktop(): void {
  if (!isTauriRuntime()) {
    throw new SyncStorageError(
      'La synchronisation par dossier est disponible dans l’application desktop.',
    )
  }
}

function validFolder(dir: string): void {
  if (!dir.trim()) {
    throw new SyncStorageError('Dossier de synchronisation invalide')
  }
}

function validFileId(fileId: string): void {
  if (!FILE_ID.test(fileId)) {
    throw new SyncStorageError('Identifiant de coffre invalide')
  }
}

function validFileName(name: string): void {
  if (!FILE_NAME.test(name)) {
    throw new SyncStorageError('Nom de fichier de synchronisation invalide')
  }
}

async function call<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw new SyncStorageError(
      typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : 'La synchronisation native a échoué',
      { cause: error },
    )
  }
}

/** Crée `Coffre/<idFichier>/` et renvoie le chemin absolu du dossier. */
export async function prepareSyncFolder(
  baseDir: string,
  fileId: string,
): Promise<string> {
  requireDesktop()
  validFolder(baseDir)
  validFileId(fileId)
  return call<string>('sync_prepare', { base: baseDir, fileId })
}

export async function listSyncFiles(dir: string): Promise<SyncFileInfo[]> {
  requireDesktop()
  validFolder(dir)
  return call<SyncFileInfo[]>('sync_list', { dir })
}

export async function readSyncFile(
  dir: string,
  name: string,
): Promise<string | null> {
  requireDesktop()
  validFolder(dir)
  validFileName(name)
  return call<string | null>('sync_read', { dir, name })
}

export async function writeSyncFile(
  dir: string,
  name: string,
  contents: string,
): Promise<void> {
  requireDesktop()
  validFolder(dir)
  validFileName(name)
  if (contents.length > MAX_SYNC_FILE_BYTES) {
    throw new SyncStorageError('Fichier de synchronisation trop volumineux')
  }
  await call<null>('sync_write', { dir, name, contents })
}

export async function watchSyncFolder(dir: string): Promise<void> {
  requireDesktop()
  validFolder(dir)
  await call<null>('sync_watch', { dir })
}

export async function unwatchSyncFolder(): Promise<void> {
  requireDesktop()
  await call<null>('sync_unwatch', {})
}

/** Écoute les changements du dossier surveillé, après anti-rebond Rust. */
export async function onSyncFolderChanged(
  listener: (dir: string) => void,
): Promise<UnlistenFn> {
  requireDesktop()
  return listen<{ dir: string }>('coffre:sync-changed', (event) => {
    listener(event.payload.dir)
  })
}
