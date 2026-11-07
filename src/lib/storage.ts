/**
 * Persistance locale.
 *
 * Le fichier de coffre (déjà chiffré) est stocké tel quel dans IndexedDB.
 * Aucune clé, aucun mot de passe et aucune donnée en clair n’y sont écrits.
 * Une copie de la version précédente est conservée pour permettre une
 * récupération en cas d’écriture interrompue.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { VaultFile } from './types'
import { parseVaultFile } from './vault'

const DB_NAME = 'coffre'
const DB_VERSION = 1
const STORE = 'vault'
const CURRENT_KEY = 'current'
const BACKUP_KEY = 'backup'
/** Trois générations de sauvegarde locale : `backup`, `backup:2`, `backup:3`. */
export const MAX_LOCAL_BACKUPS = 3

function backupKey(generation: number): string {
  return generation <= 1 ? BACKUP_KEY : `${BACKUP_KEY}:${generation}`
}

interface CoffreDb extends DBSchema {
  vault: {
    key: string
    value: VaultFile
  }
}

export class StorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StorageError'
  }
}

let dbPromise: Promise<IDBPDatabase<CoffreDb>> | null = null

function database(): Promise<IDBPDatabase<CoffreDb>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(
      new StorageError('IndexedDB n’est pas disponible dans ce navigateur'),
    )
  }

  if (!dbPromise) {
    dbPromise = openDB<CoffreDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE)
        }
      },
      blocked() {
        console.warn('Coffre : mise à jour de la base bloquée par un autre onglet.')
      },
    }).catch((error: unknown) => {
      dbPromise = null
      throw new StorageError('Impossible d’ouvrir le stockage local', { cause: error })
    })
  }

  return dbPromise
}

export async function loadVaultFile(): Promise<VaultFile | null> {
  try {
    const db = await database()
    const raw = await db.get(STORE, CURRENT_KEY)
    if (!raw) return null
    return parseVaultFile(raw)
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Impossible de lire le coffre local', { cause: error })
  }
}

export async function hasVaultFile(): Promise<boolean> {
  try {
    const db = await database()
    const count = await db.count(STORE)
    return count > 0
  } catch (error) {
    throw new StorageError('Impossible d’accéder au stockage local', { cause: error })
  }
}

export async function saveVaultFile(file: VaultFile): Promise<void> {
  try {
    const db = await database()
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)

    // Rotation : la sauvegarde la plus ancienne est écrasée en dernier.
    for (let generation = MAX_LOCAL_BACKUPS; generation > 1; generation--) {
      const previous = await store.get(backupKey(generation - 1))
      if (previous) await store.put(previous, backupKey(generation))
    }

    const current = await store.get(CURRENT_KEY)
    if (current) await store.put(current, BACKUP_KEY)
    await store.put(file, CURRENT_KEY)
    await tx.done
  } catch (error) {
    throw new StorageError('Impossible d’enregistrer le coffre', { cause: error })
  }
}

export async function loadBackupVaultFile(generation = 1): Promise<VaultFile | null> {
  try {
    const db = await database()
    const raw = await db.get(STORE, backupKey(generation))
    if (!raw) return null
    return parseVaultFile(raw)
  } catch (error) {
    throw new StorageError('Impossible de lire la sauvegarde locale', { cause: error })
  }
}

export interface LocalBackupInfo {
  generation: number
  id: string
  updatedAt: string
  items: number
}

/**
 * Métadonnées des sauvegardes locales, de la plus récente à la plus ancienne.
 * Le contenu reste chiffré ; seuls des compteurs et des dates sont exposés.
 */
export async function listLocalBackups(): Promise<LocalBackupInfo[]> {
  try {
    const db = await database()
    const backups: LocalBackupInfo[] = []
    for (let generation = 1; generation <= MAX_LOCAL_BACKUPS; generation++) {
      const raw = await db.get(STORE, backupKey(generation))
      if (!raw) continue
      backups.push({
        generation,
        id: raw.id,
        updatedAt: raw.updatedAt,
        items: raw.items.length,
      })
    }
    return backups
  } catch (error) {
    throw new StorageError('Impossible de lister les sauvegardes locales', { cause: error })
  }
}

export async function restoreBackup(generation = 1): Promise<VaultFile | null> {
  const backup = await loadBackupVaultFile(generation)
  if (!backup) return null
  await saveVaultFile(backup)
  return backup
}

export async function clearVaultStorage(): Promise<void> {
  try {
    const db = await database()
    await db.clear(STORE)
  } catch (error) {
    throw new StorageError('Impossible d’effacer les données locales', { cause: error })
  }
}

/* ------------------------------------------------------------------ */
/* Stockage persistant                                                 */
/* ------------------------------------------------------------------ */

/**
 * Indique si le navigateur s’est engagé à conserver les données.
 * `null` signifie que l’API n’est pas disponible (Safari ancien, WebView…).
 */
export async function getPersistentStorageStatus(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return null
  try {
    return await navigator.storage.persisted()
  } catch {
    return null
  }
}

/**
 * Demande un stockage persistant pour éviter l’éviction automatique.
 * Le navigateur peut refuser sans intervention de l’utilisateur.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export interface StorageEstimate {
  usage: number
  quota: number
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const estimate = await navigator.storage.estimate()
    return {
      usage: Math.max(0, estimate.usage ?? 0),
      quota: Math.max(0, estimate.quota ?? 0),
    }
  } catch {
    return null
  }
}
