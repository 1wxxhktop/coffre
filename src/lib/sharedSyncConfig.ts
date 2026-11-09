/**
 * Configuration locale de la synchronisation des coffres partagés.
 *
 * Aucun secret : identifiant du coffre, chemin choisi par l’utilisateur et
 * empreintes des derniers bundles importés. Les bundles eux-mêmes restent
 * chiffrés et signés.
 */

export const SHARED_SYNC_CONFIG_KEY = 'coffre:shared-sync:v1'

export interface SharedSyncConfig {
  version: 1
  platform: 'desktop' | 'web'
  fileId: string
  vaultId: string
  /** Chemin desktop ou libellé du dossier Web. */
  dir: string
  /** Nom de fichier → empreinte SHA-256 du dernier contenu importé. */
  lastImports: Record<string, string>
  lastSyncAt?: string
  lastWarning?: string
}

type SharedSyncConfigMap = Record<string, SharedSyncConfig>

const ID = /^[A-Za-z0-9_-]{1,80}$/
const NAME = /^[A-Za-z0-9_-]+\.coffre-shared\.json$/
const HASH = /^[A-Za-z0-9+/=]{16,128}$/

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function configKey(config: Pick<SharedSyncConfig, 'fileId' | 'vaultId'>): string {
  return `${config.fileId}:${config.vaultId}`
}

function validImports(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value as Record<string, unknown>).every(
    ([name, hash]) =>
      NAME.test(name) && typeof hash === 'string' && HASH.test(hash),
  )
}

function validConfig(value: unknown): value is SharedSyncConfig {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    entry.version === 1 &&
    (entry.platform === 'desktop' || entry.platform === 'web') &&
    typeof entry.fileId === 'string' &&
    ID.test(entry.fileId) &&
    typeof entry.vaultId === 'string' &&
    ID.test(entry.vaultId) &&
    typeof entry.dir === 'string' &&
    entry.dir.trim().length > 0 &&
    validImports(entry.lastImports) &&
    (entry.lastSyncAt === undefined || typeof entry.lastSyncAt === 'string') &&
    (entry.lastWarning === undefined || typeof entry.lastWarning === 'string')
  )
}

function loadAll(): SharedSyncConfigMap {
  const store = storage()
  if (!store) return {}
  try {
    const raw = store.getItem(SHARED_SYNC_CONFIG_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const result: SharedSyncConfigMap = {}
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (validConfig(value) && configKey(value) === key) result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

function saveAll(configs: SharedSyncConfigMap): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(SHARED_SYNC_CONFIG_KEY, JSON.stringify(configs))
  } catch {
    // Le stockage local peut être indisponible ; la synchronisation reste
    // utilisable manuellement pendant la session.
  }
}

export function getSharedSyncConfig(
  fileId: string,
  vaultId: string,
): SharedSyncConfig | null {
  return loadAll()[configKey({ fileId, vaultId })] ?? null
}

export function listSharedSyncConfigs(fileId: string): SharedSyncConfig[] {
  return Object.values(loadAll()).filter((config) => config.fileId === fileId)
}

export function saveSharedSyncConfig(config: SharedSyncConfig): void {
  if (!validConfig(config)) throw new Error('Configuration de partage invalide')
  const configs = loadAll()
  configs[configKey(config)] = config
  saveAll(configs)
}

export function removeSharedSyncConfig(fileId: string, vaultId: string): void {
  const configs = loadAll()
  delete configs[configKey({ fileId, vaultId })]
  saveAll(configs)
}
