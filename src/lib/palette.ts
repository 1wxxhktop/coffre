import type { VaultItem } from './types'
import type { UsageMap } from './usage'

/** Action proposée par la palette de commandes. */
export interface PaletteAction {
  id: string
  label: string
  /** Mots supplémentaires reconnus à la recherche. */
  keywords?: string
  /** Raccourci affiché à droite, à titre indicatif. */
  shortcut?: string
}

export const PALETTE_MAX_ITEMS = 8
export const PALETTE_RECENT_ITEMS = 5

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Texte cherchable d’un élément : jamais de secret (mot de passe, notes, champs). */
function itemHaystack(item: VaultItem): string {
  const parts = [item.title, ...item.tags]
  if (item.type === 'login') parts.push(item.username, ...item.urls)
  return normalize(parts.join(' '))
}

/** Rang d’un résultat : titre qui commence par la requête, puis mot, puis reste. */
function rank(title: string, haystack: string, words: string[]): number | null {
  if (!words.every((word) => haystack.includes(word))) return null
  const first = words[0]
  if (title.startsWith(first)) return 0
  if (title.split(/\s+/).some((part) => part.startsWith(first))) return 1
  if (title.includes(first)) return 2
  return 3
}

/**
 * Filtre actions et éléments pour la palette. Sans requête : toutes les
 * actions et les éléments utilisés récemment. Les éléments en corbeille sont
 * ignorés.
 */
export function searchPalette<A extends PaletteAction>(
  query: string,
  actions: A[],
  items: VaultItem[],
  usage: UsageMap,
): { actions: A[]; items: VaultItem[] } {
  const active = items.filter((item) => !item.deletedAt)
  const words = normalize(query).split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    const recent = active
      .filter((item) => usage[item.id])
      .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))
      .slice(0, PALETTE_RECENT_ITEMS)
    return { actions, items: recent }
  }

  const matchedActions = actions.filter((action) => {
    const haystack = normalize(`${action.label} ${action.keywords ?? ''}`)
    return words.every((word) => haystack.includes(word))
  })

  const matchedItems = active
    .map((item) => ({
      item,
      rank: rank(normalize(item.title), itemHaystack(item), words),
    }))
    .filter((entry): entry is { item: VaultItem; rank: number } => entry.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (usage[b.item.id] ?? 0) - (usage[a.item.id] ?? 0) ||
        a.item.title.localeCompare(b.item.title),
    )
    .slice(0, PALETTE_MAX_ITEMS)
    .map((entry) => entry.item)

  return { actions: matchedActions, items: matchedItems }
}

/** Éléments les plus récemment utilisés, pour la rangée « Accès rapide ». */
export function quickAccessItems(
  items: VaultItem[],
  usage: UsageMap,
  limit = 5,
): VaultItem[] {
  return items
    .filter((item) => !item.deletedAt && usage[item.id])
    .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))
    .slice(0, limit)
}

/** Déplace un champ d’une position à une autre, sans modifier le tableau reçu. */
export function moveEntry<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list
  }
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
