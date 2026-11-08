/**
 * Configuration locale de la synchronisation par dossier.
 *
 * Aucun secret : identifiant de l’appareil, chemins choisis par l’utilisateur
 * et état de la dernière synchronisation. La clé maîtresse n’est jamais
 * stockée ici.
 */

export const SYNC_CONFIG_KEY = 'coffre:sync:v1'

export interface SyncConfig {
  version: 1
  /** `desktop` par défaut pour les configurations existantes. */
  platform?: 'desktop' | 'web'
  fileId: string
  baseDir: string
  dir: string
  deviceId: string
  lastSyncAt?: string
  lastConflicts?: number
  lastWarning?: string
}

type SyncConfigMap = Record<string, SyncConfig>

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function validConfig(value: unknown): value is SyncConfig {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    entry.version === 1 &&
    (entry.platform === undefined ||
      entry.platform === 'desktop' ||
      entry.platform === 'web') &&
    typeof entry.fileId === 'string' &&
    typeof entry.baseDir === 'string' &&
    typeof entry.dir === 'string' &&
    typeof entry.deviceId === 'string' &&
    /^[A-Za-z0-9_-]{1,80}$/.test(entry.deviceId)
  )
}

function loadAll(): SyncConfigMap {
  const store = storage()
  if (!store) return {}
  try {
    const raw = store.getItem(SYNC_CONFIG_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const result: SyncConfigMap = {}
    for (const [fileId, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (validConfig(value) && value.fileId === fileId) result[fileId] = value
    }
    return result
  } catch {
    return {}
  }
}

function saveAll(configs: SyncConfigMap): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(SYNC_CONFIG_KEY, JSON.stringify(configs))
  } catch {
    // Le stockage local peut être indisponible (mode privé).
  }
}

export function getSyncConfig(fileId: string): SyncConfig | null {
  return loadAll()[fileId] ?? null
}

export function saveSyncConfig(config: SyncConfig): void {
  if (!validConfig(config)) {
    throw new Error('Configuration de synchronisation invalide')
  }
  const configs = loadAll()
  configs[config.fileId] = config
  saveAll(configs)
}

export function removeSyncConfig(fileId: string): void {
  const configs = loadAll()
  if (!(fileId in configs)) return
  delete configs[fileId]
  saveAll(configs)
}

/** Identifiant persistant de cet appareil dans le dossier partagé. */
export function newSyncDeviceId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return `w_${hex}`
}

export function syncDeviceFileName(config: SyncConfig): string {
  return `${config.deviceId}.coffre`
}
