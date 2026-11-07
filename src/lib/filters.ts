import type { ItemType } from './types'

export type ItemFilter = 'all' | 'favorites' | 'recent' | 'trash' | ItemType

/** Libellés partagés par la navigation et l’en-tête de la bibliothèque. */
export const FILTER_LABELS: Record<ItemFilter, string> = {
  all: 'Tous les éléments',
  favorites: 'Favoris',
  recent: 'Récents',
  trash: 'Corbeille',
  login: 'Connexions',
  card: 'Cartes',
  note: 'Notes',
  identity: 'Identités',
}

export function isItemFilter(value: string): value is ItemFilter {
  return Object.hasOwn(FILTER_LABELS, value)
}

export type ItemSort = 'recent' | 'name-asc' | 'name-desc' | 'updated' | 'created' | 'type'

/** Options de tri proposées au-dessus de la liste. */
export const SORT_LABELS: Record<ItemSort, string> = {
  recent: 'Récents',
  'name-asc': 'Nom A–Z',
  'name-desc': 'Nom Z–A',
  updated: 'Modifiés',
  created: 'Créés',
  type: 'Par type',
}
