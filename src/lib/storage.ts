/**
 * Persistance locale.
 *
 * Sur le Web, le fichier de coffre (déjà chiffré) est stocké tel quel dans
 * IndexedDB. Dans l’application desktop Tauri, il est écrit dans le dossier de
 * données de l’application via des commandes Rust : fichier natif, écriture
 * atomique, permissions restrictives et trois sauvegardes tournantes. Une
 * migration automatique copie un éventuel coffre IndexedDB vers le stockage
 * natif au premier lancement.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './external'
import type { VaultFile, VaultRevisionState } from './types'
import { parseVaultFile, parseVaultFileText, serializeVault } from './vault'

const DB_NAME = 'coffre'
const DB_VERSION = 1
const STORE = 'vault'
const CURRENT_KEY = 'current'
const BACKUP_KEY = 'backup'
/**
 * Plus haute révision vue, conservée à côté du coffre. La clé est distincte
 * des sauvegardes tournantes et n’est jamais exportée avec le fichier.
 */
const STATE_KEY = 'state'
/** Trois générations de sauvegarde locale : `backup`, `backup:2`, `backup:3`. */
export const MAX_LOCAL_BACKUPS = 3

function backupKey(generation: number): string {
  return generation <= 1 ? BACKUP_KEY : `${BACKUP_KEY}:${generation}`
}

interface CoffreDb extends DBSchema {
  vault: {
    key: string
    value: VaultFile | VaultRevisionState
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

/* ------------------------------------------------------------------ */
/* Backend IndexedDB (Web)                                             */
/* ------------------------------------------------------------------ */

async function loadIndexedDbVaultFile(): Promise<VaultFile | null> {
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

async function saveIndexedDbVaultFile(file: VaultFile): Promise<void> {
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

async function loadIndexedDbBackup(generation: number): Promise<VaultFile | null> {
  const db = await database()
  const raw = await db.get(STORE, backupKey(generation))
  if (!raw) return null
  return parseVaultFile(raw)
}

async function clearIndexedDbStorage(): Promise<void> {
  try {
    const db = await database()
    await db.clear(STORE)
  } catch (error) {
    throw new StorageError('Impossible d’effacer les données locales', { cause: error })
  }
}

/* ------------------------------------------------------------------ */
/* État anti-retour en arrière                                         */
/* ------------------------------------------------------------------ */

function parseVaultState(raw: unknown): VaultRevisionState | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (
    typeof value.fileId !== 'string' ||
    !value.fileId ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.updatedAt !== 'string'
  ) {
    return null
  }
  return {
    fileId: value.fileId,
    revision: value.revision,
    updatedAt: value.updatedAt,
  }
}

/**
 * Lit la plus haute révision connue pour le coffre local. `null` si aucun état
 * n’a encore été enregistré (premier lancement, fichier antérieur ou état
 * illisible : dans ce dernier cas on préfère ne pas bloquer l’ouverture).
 */
export async function loadVaultState(): Promise<VaultRevisionState | null> {
  try {
    if (isTauriRuntime()) {
      const raw = await nativeInvoke<string | null>('vault_state_read')
      if (!raw) return null
      try {
        return parseVaultState(JSON.parse(raw))
      } catch {
        return null
      }
    }
    const db = await database()
    return parseVaultState(await db.get(STORE, STATE_KEY))
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Impossible de lire l’état du coffre', { cause: error })
  }
}

/** Enregistre la révision vue après une ouverture ou une écriture réussie. */
export async function saveVaultState(state: VaultRevisionState): Promise<void> {
  try {
    if (isTauriRuntime()) {
      await nativeInvoke('vault_state_write', {
        contents: JSON.stringify(state),
      })
      return
    }
    const db = await database()
    await db.put(STORE, state, STATE_KEY)
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Impossible d’enregistrer l’état du coffre', { cause: error })
  }
}

/* ------------------------------------------------------------------ */
/* Backend natif Tauri                                                 */
/* ------------------------------------------------------------------ */

function nativeJson(file: VaultFile): string {
  return serializeVault(file, false)
}

async function nativeInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw new StorageError('Le stockage natif du coffre est indisponible', { cause: error })
  }
}

function parseNative(raw: string, label: string): VaultFile {
  try {
    return parseVaultFileText(raw)
  } catch (error) {
    throw new StorageError(`${label} est illisible ou corrompu`, { cause: error })
  }
}

/**
 * Lit le coffre natif. S’il n’existe pas encore mais qu’un coffre IndexedDB
 * existe (mise à jour d’une version précédente), le migre vers le stockage
 * natif et ses sauvegardes.
 */
async function loadNativeVaultFile(): Promise<VaultFile | null> {
  const raw = await nativeInvoke<string | null>('vault_read')
  if (raw) return parseNative(raw, 'Le coffre natif')

  // Si IndexedDB est totalement absent (WebView restrictive), il n’y a rien à
  // migrer. En revanche, une base présente mais illisible doit remonter une
  // erreur : la masquer ferait croire à un coffre vide et risquerait d’en
  // créer un nouveau par-dessus l’ancien.
  let legacy: VaultFile | null = null
  if (typeof indexedDB !== 'undefined') {
    legacy = await loadIndexedDbVaultFile()
  }
  if (!legacy) return null

  // Les sauvegardes sont écrites avant le fichier courant : si la migration
  // est interrompue, `vault_read` renvoie encore `null` et elle sera rejouée
  // au prochain lancement.
  for (let generation = 1; generation <= MAX_LOCAL_BACKUPS; generation++) {
    try {
      const backup = await loadIndexedDbBackup(generation)
      if (backup) {
        await nativeInvoke('vault_backup_write', {
          generation,
          contents: nativeJson(backup),
        })
      }
    } catch {
      // Les sauvegardes sont migrées au mieux ; le coffre courant reste la
      // source de vérité.
    }
  }
  await nativeInvoke('vault_write', { contents: nativeJson(legacy) })
  return legacy
}

/* ------------------------------------------------------------------ */
/* API publique                                                        */
/* ------------------------------------------------------------------ */

export async function loadVaultFile(): Promise<VaultFile | null> {
  if (isTauriRuntime()) return loadNativeVaultFile()
  return loadIndexedDbVaultFile()
}

export async function hasVaultFile(): Promise<boolean> {
  if (isTauriRuntime()) {
    const raw = await nativeInvoke<string | null>('vault_read')
    if (raw) return true
    return (await loadIndexedDbVaultFile()) !== null
  }
  try {
    const db = await database()
    return (await db.get(STORE, CURRENT_KEY)) !== undefined
  } catch (error) {
    throw new StorageError('Impossible d’accéder au stockage local', { cause: error })
  }
}

export async function saveVaultFile(file: VaultFile): Promise<void> {
  if (isTauriRuntime()) {
    await nativeInvoke('vault_write', { contents: nativeJson(file) })
    return
  }
  await saveIndexedDbVaultFile(file)
}

export async function loadBackupVaultFile(generation = 1): Promise<VaultFile | null> {
  if (isTauriRuntime()) {
    const raw = await nativeInvoke<string | null>('vault_backup_read', { generation })
    return raw ? parseNative(raw, 'La sauvegarde native') : null
  }
  try {
    return await loadIndexedDbBackup(generation)
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
  const backups: LocalBackupInfo[] = []
  try {
    if (isTauriRuntime()) {
      for (let generation = 1; generation <= MAX_LOCAL_BACKUPS; generation++) {
        const raw = await nativeInvoke<string | null>('vault_backup_read', { generation })
        if (!raw) continue
        try {
          const file = parseNative(raw, 'La sauvegarde native')
          backups.push({
            generation,
            id: file.id,
            updatedAt: file.updatedAt,
            items: file.items.length,
          })
        } catch {
          // Une sauvegarde illisible est ignorée de la liste ; l’écran de
          // récupération reste utilisable avec les autres générations.
        }
      }
      return backups
    }

    const db = await database()
    for (let generation = 1; generation <= MAX_LOCAL_BACKUPS; generation++) {
      const raw = (await db.get(STORE, backupKey(generation))) as VaultFile | undefined
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
  if (isTauriRuntime()) {
    try {
      await nativeInvoke('vault_clear')
    } finally {
      // Nettoie aussi les anciennes données IndexedDB issues d’une version
      // précédente ou d’une migration interrompue.
      await clearIndexedDbStorage().catch(() => undefined)
    }
    return
  }
  await clearIndexedDbStorage()
}

/* ------------------------------------------------------------------ */
/* Stockage persistant (Web)                                           */
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
