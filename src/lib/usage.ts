/**
 * Historique local d’utilisation, pour la vue « Récents », le tri « Dernière
 * utilisation » et l’accès rapide.
 *
 * Seuls l’identifiant aléatoire de l’élément, un compteur d’utilisations et un
 * horodatage sont conservés, dans `localStorage`. Aucun titre, aucun
 * identifiant de compte et aucun secret n’y figurent. La table est plafonnée et
 * purgée à la réinitialisation du coffre.
 */

const STORAGE_KEY = 'coffre:usage:v1'
export const MAX_USAGE_ENTRIES = 500

export interface UsageEntry {
  /** Nombre d’utilisations enregistrées pour cet élément. */
  count: number
  /** Dernière utilisation (ou ouverture) de l’élément. */
  lastUsedAt: number
}

export type UsageMap = Record<string, UsageEntry>

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Normalise une entrée. L’ancien format (un simple horodatage) reste lisible :
 * il devient une utilisation unique, sans perdre l’historique existant.
 */
function parseEntry(value: unknown): UsageEntry | null {
  if (isTimestamp(value)) return { count: 1, lastUsedAt: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const count = Number(record.count)
  const lastUsedAt = Number(record.lastUsedAt)
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    !isTimestamp(lastUsedAt)
  ) {
    return null
  }
  return {
    count: Math.min(count, Number.MAX_SAFE_INTEGER),
    lastUsedAt,
  }
}

/** Filtre une valeur JSON inconnue et ne garde que les entrées valides récentes. */
export function parseUsage(raw: string | null): UsageMap {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const entries = Object.entries(parsed as Record<string, unknown>)
      .map(([id, value]) => {
        const entry = parseEntry(value)
        return entry && id ? ([id, entry] as [string, UsageEntry]) : null
      })
      .filter((entry): entry is [string, UsageEntry] => entry !== null)
    entries.sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt)
    return Object.fromEntries(entries.slice(0, MAX_USAGE_ENTRIES))
  } catch {
    return {}
  }
}

/** Ajoute ou rafraîchit une entrée, puis élague les plus anciennes. */
export function applyUsage(usage: UsageMap, itemId: string, now = Date.now()): UsageMap {
  if (!itemId) return usage
  const previous = usage[itemId]
  const entry: UsageEntry = {
    count: Math.min(
      (previous?.count ?? 0) + 1,
      Number.MAX_SAFE_INTEGER,
    ),
    lastUsedAt: now,
  }
  const entries = Object.entries({ ...usage, [itemId]: entry })
  entries.sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt)
  return Object.fromEntries(entries.slice(0, MAX_USAGE_ENTRIES))
}

/** Horodatage de la dernière utilisation, ou 0 si l’élément est inconnu. */
export function usageTimestamp(usage: UsageMap, itemId: string): number {
  return usage[itemId]?.lastUsedAt ?? 0
}

/** Nombre d’utilisations enregistrées, ou 0 si l’élément est inconnu. */
export function usageCount(usage: UsageMap, itemId: string): number {
  return usage[itemId]?.count ?? 0
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadUsage(): UsageMap {
  const store = storage()
  if (!store) return {}
  try {
    return parseUsage(store.getItem(STORAGE_KEY))
  } catch {
    return {}
  }
}

/** Marque un élément comme utilisé et renvoie la table à jour. */
export function recordItemUsage(itemId: string, now = Date.now()): UsageMap {
  const next = applyUsage(loadUsage(), itemId, now)
  const store = storage()
  if (store) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Quota ou stockage refusé : l’historique reste en mémoire.
    }
  }
  return next
}

export function clearUsage(): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(STORAGE_KEY)
  } catch {
    // Rien à faire : l’effacement est au mieux.
  }
}
