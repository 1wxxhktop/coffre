/**
 * Texte du badge de la barre d’action.
 *
 * Une proposition d’enregistrement reste prioritaire (point ambre) ; sinon le
 * badge affiche le nombre de connexions du site actif, uniquement si le coffre
 * est déverrouillé et le site autorisé.
 */

export const BADGE_PENDING = '●'

export function badgeText(
  pendingCount: number,
  loginCount: number,
  allowed: boolean,
): string {
  if (pendingCount > 0) return BADGE_PENDING
  if (!allowed || loginCount <= 0) return ''
  return loginCount > 99 ? '99+' : String(loginCount)
}
