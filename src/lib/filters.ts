import type { MessageKey } from './i18n'
import type { ItemType } from './types'

export type ItemFilter =
  | 'all'
  | 'favorites'
  | 'recent'
  | 'expiring'
  | 'trash'
  | ItemType

/** Libellés partagés par la navigation et l’en-tête de la bibliothèque. */
export const FILTER_LABELS: Record<ItemFilter, string> = {
  all: 'Tous les éléments',
  favorites: 'Favoris',
  recent: 'Récents',
  expiring: 'Bientôt expirés',
  trash: 'Corbeille',
  login: 'Connexions',
  card: 'Cartes',
  note: 'Notes',
  identity: 'Identités',
  passkey: 'Passkeys',
}

export const FILTER_MESSAGE_KEYS: Record<ItemFilter, MessageKey> = {
  all: 'filter.all',
  favorites: 'filter.favorites',
  recent: 'filter.recent',
  expiring: 'filter.expiring',
  trash: 'filter.trash',
  login: 'filter.login',
  card: 'filter.card',
  note: 'filter.note',
  identity: 'filter.identity',
  passkey: 'filter.passkey',
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

export const SORT_MESSAGE_KEYS: Record<ItemSort, MessageKey> = {
  recent: 'vault.sort.recent',
  'name-asc': 'vault.sort.nameAsc',
  'name-desc': 'vault.sort.nameDesc',
  updated: 'vault.sort.updated',
  created: 'vault.sort.created',
  type: 'vault.sort.type',
}
