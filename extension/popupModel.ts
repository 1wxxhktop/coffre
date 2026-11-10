/**
 * Classement de la vue d’accueil de la popup.
 *
 * « Pour ce site » garde l’ordre du pont ; les favoris viennent ensuite, puis
 * les cinq connexions les plus récemment modifiées. Aucun identifiant d’élément
 * n’est conservé : la fonction ne fait que réordonner les résumés reçus.
 */

import type { ExtensionLoginSummary } from '../src/lib/extensionProtocol'

export interface PopupGroup {
  title: string
  entries: ExtensionLoginSummary[]
}

export function groupLogins(
  site: ExtensionLoginSummary[],
  all: ExtensionLoginSummary[],
  titles: { site: string; favorites: string; recents: string },
): PopupGroup[] {
  const siteIds = new Set(site.map((entry) => entry.id))
  const favorites = all.filter(
    (entry) => entry.favorite === true && !siteIds.has(entry.id),
  )
  const favoriteIds = new Set(favorites.map((entry) => entry.id))
  const recents = all
    .filter(
      (entry) => !siteIds.has(entry.id) && !favoriteIds.has(entry.id),
    )
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, 5)
  return [
    { title: titles.site, entries: site },
    { title: titles.favorites, entries: favorites },
    { title: titles.recents, entries: recents },
  ]
}
