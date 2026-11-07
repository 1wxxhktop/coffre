/**
 * Historique local d’utilisation, pour la vue « Récents ».
 *
 * Seuls l’identifiant aléatoire de l’élément et un horodatage sont conservés,
 * dans `localStorage`. Aucun titre, aucun identifiant de compte et aucun secret
 * n’y figurent. La table est plafonnée et purgée à la réinitialisation du coffre.
 */

const STORAGE_KEY = 'coffre:usage:v1'
export const MAX_USAGE_ENTRIES = 500

export type UsageMap = Record<string, number>

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Filtre une valeur JSON inconnue et ne garde que les entrées valides récentes. */
export function parseUsage(raw: string | null): UsageMap {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([id, timestamp]) => Boolean(id) && isTimestamp(timestamp),
    ) as Array<[string, number]>
    entries.sort((a, b) => b[1] - a[1])
    return Object.fromEntries(entries.slice(0, MAX_USAGE_ENTRIES))
  } catch {
    return {}
  }
}

/** Ajoute ou rafraîchit une entrée, puis élague les plus anciennes. */
export function applyUsage(usage: UsageMap, itemId: string, now = Date.now()): UsageMap {
  if (!itemId) return usage
  const entries = Object.entries({ ...usage, [itemId]: now })
  entries.sort((a, b) => b[1] - a[1])
  return Object.fromEntries(entries.slice(0, MAX_USAGE_ENTRIES))
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
