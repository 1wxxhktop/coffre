/**
 * Choix de la connexion à mettre à jour après un changement de mot de passe.
 *
 * Le formulaire de changement ne contient pas toujours l’identifiant du
 * compte : on privilégie une correspondance exacte, puis la connexion utilisée
 * récemment dans l’onglet. En cas d’ambiguïté, mieux vaut ne rien proposer que
 * de modifier le mauvais élément.
 */

export interface ChangePasswordCandidate {
  id: string
  username: string
}

export interface ChangePasswordChoice {
  /** Identifiant saisi ou détecté dans le formulaire, s’il existe. */
  username?: string
  /** Dernière connexion remplie dans cet onglet, si elle est encore valide. */
  recentItemId?: string
}

export function chooseChangePasswordTarget<T extends ChangePasswordCandidate>(
  candidates: readonly T[],
  choice: ChangePasswordChoice = {},
): T | null {
  if (candidates.length === 0) return null

  const wanted = choice.username?.trim().toLowerCase() ?? ''
  const exact = wanted
    ? candidates.filter(
        (candidate) => candidate.username.trim().toLowerCase() === wanted,
      )
    : []
  if (exact.length === 1) return exact[0]

  if (choice.recentItemId) {
    const recent = candidates.find(
      (candidate) => candidate.id === choice.recentItemId,
    )
    if (recent) return recent
  }

  if (exact.length > 1) return null
  return candidates.length === 1 ? candidates[0] : null
}
