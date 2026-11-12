/**
 * Règles pures du remplissage au chargement.
 *
 * Le content script signale une page de connexion ; le service worker vérifie
 * les conditions de sécurité avant de demander le moindre secret. Ces fonctions
 * sont isolées pour être testées sans navigateur.
 */

import { hostMatches } from './extensionProtocol'

export type AutofillOnLoadError =
  | 'disabled'
  | 'frame'
  | 'insecure-context'
  | 'invalid'
  | 'excluded'
  | 'not-found'
  | 'multiple'

export interface AutofillOnLoadContext {
  enabled: boolean
  topFrame: boolean
  protocol: string
  host: string
  excluded: boolean
}

/**
 * Première barrière, avant toute recherche dans le coffre. Elle ne dépend
 * d’aucun secret et doit rester synchrone.
 */
export function autofillOnLoadBlocked(
  context: AutofillOnLoadContext,
): AutofillOnLoadError | null {
  if (!context.enabled) return 'disabled'
  if (!context.topFrame) return 'frame'
  if (context.protocol !== 'https:') return 'insecure-context'
  if (!context.host) return 'invalid'
  if (context.excluded) return 'excluded'
  return null
}

export interface AutofillLoginCandidate {
  id?: unknown
  kind?: unknown
  host?: unknown
}

/**
 * Choisit la connexion à remplir. Une seule correspondance est acceptée :
 * avec deux comptes sur le même site, Coffre ne devine pas et laisse
 * l’utilisateur ouvrir le menu.
 */
export function selectAutofillLogin(
  items: ReadonlyArray<AutofillLoginCandidate>,
  host: string,
): { itemId: string } | { error: 'not-found' | 'multiple' } {
  const matches = items.filter((item) => {
    if (typeof item.id !== 'string' || !item.id) return false
    if (item.kind !== undefined && item.kind !== 'login') return false
    if (typeof item.host !== 'string' || !item.host) return false
    return hostMatches(item.host, host)
  })
  const unique = new Map(matches.map((item) => [item.id as string, item]))
  if (unique.size === 0) return { error: 'not-found' }
  if (unique.size > 1) return { error: 'multiple' }
  return { itemId: [...unique.keys()][0] }
}
