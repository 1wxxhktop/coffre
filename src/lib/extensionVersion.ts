/**
 * Comparaison de versions et décision de rechargement de l’extension.
 * Module sans dépendance : il est partagé par l’application et l’extension.
 */

/** Découpe « 1.12.0 » en nombres ; `null` si la forme est inattendue. */
function parseVersion(version: string): number[] | null {
  if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(version)) return null
  return version.split('.').map(Number)
}

/**
 * Vrai si `candidate` est strictement plus récente que `current`. Une version
 * illisible n’est jamais considérée comme plus récente.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) return left > right
  }
  return false
}

export type SelfUpdateDecision = 'none' | 'reload' | 'manual'

/**
 * Décide ce que fait l’extension quand l’application annonce la version
 * présente sur le disque.
 *
 * - `reload` : une version plus récente attend, on recharge une fois ;
 * - `manual` : le rechargement a déjà été tenté pour cette version sans effet
 *   (l’extension n’est pas chargée depuis le dossier géré) : on prévient
 *   l’utilisateur au lieu de recharger en boucle ;
 * - `none` : rien à faire.
 */
export function selfUpdateDecision(
  runningVersion: string,
  diskVersion: string | null | undefined,
  attemptedVersion: string | null | undefined,
): SelfUpdateDecision {
  if (!diskVersion || !isNewerVersion(diskVersion, runningVersion)) return 'none'
  return attemptedVersion === diskVersion ? 'manual' : 'reload'
}
