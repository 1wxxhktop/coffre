/**
 * Accès aux dossiers de synchronisation des coffres partagés.
 *
 * Desktop : réutilise les commandes atomiques de `syncStorage`. Web : conserve
 * un `FileSystemDirectoryHandle` dédié. Les noms de bundles sont validés des
 * deux côtés ; aucun secret ne transite par ces fonctions.
 */

import {
  clearWebSharedHandle,
  ensureWebSyncPermission,
  listWebSharedFiles,
  loadWebSharedHandle,
  readWebSharedFile,
  saveWebSharedHandle,
  writeWebSharedFile,
} from './syncWebStorage'
import {
  listSyncFiles,
  readSyncFile,
  writeSyncFile,
} from './syncStorage'
import {
  getSharedSyncConfig,
  removeSharedSyncConfig,
  saveSharedSyncConfig,
  type SharedSyncConfig,
} from './sharedSyncConfig'
import type { SharedSyncIO } from './sharedSync'

export async function openSharedSyncIO(
  config: SharedSyncConfig,
): Promise<SharedSyncIO> {
  if (config.platform === 'desktop') {
    return {
      list: () => listSyncFiles(config.dir),
      read: (name) => readSyncFile(config.dir, name),
      write: (name, contents) => writeSyncFile(config.dir, name, contents),
    }
  }
  const handle = await loadWebSharedHandle(config.fileId, config.vaultId)
  if (!handle) {
    throw new Error(
      'Le dossier Web n’est plus accessible. Choisissez-le à nouveau.',
    )
  }
  if (!(await ensureWebSyncPermission(handle))) {
    throw new Error('L’accès au dossier de partage a été refusé.')
  }
  return {
    list: () => listWebSharedFiles(handle),
    read: (name) => readWebSharedFile(handle, name),
    write: (name, contents) => writeWebSharedFile(handle, name, contents),
  }
}

export function configureDesktopSharedSync(
  fileId: string,
  vaultId: string,
  dir: string,
): SharedSyncConfig {
  if (!dir.trim()) throw new Error('Dossier de partage invalide')
  const config: SharedSyncConfig = {
    version: 1,
    platform: 'desktop',
    fileId,
    vaultId,
    dir,
    lastImports: {},
  }
  saveSharedSyncConfig(config)
  return config
}

export async function configureWebSharedSync(
  fileId: string,
  vaultId: string,
  handle: FileSystemDirectoryHandle,
): Promise<SharedSyncConfig> {
  await saveWebSharedHandle(fileId, vaultId, handle)
  const config: SharedSyncConfig = {
    version: 1,
    platform: 'web',
    fileId,
    vaultId,
    dir: handle.name,
    lastImports: {},
  }
  saveSharedSyncConfig(config)
  return config
}

export async function disableSharedSync(
  fileId: string,
  vaultId: string,
): Promise<void> {
  const config = getSharedSyncConfig(fileId, vaultId)
  if (config?.platform === 'web') {
    await clearWebSharedHandle(fileId, vaultId)
  }
  removeSharedSyncConfig(fileId, vaultId)
}
