/**
 * Verrou partagé de l’interface pendant qu’une couche modale est ouverte.
 *
 * Les modales et la palette sont rendues hors de `#root` ; rendre `#root`
 * inerte empêche le clavier et les lecteurs d’écran d’atteindre l’arrière-plan.
 * Le compteur évite qu’une couche qui se ferme réactive l’arrière-plan alors
 * qu’une autre est encore ouverte.
 */
let locks = 0
let previousOverflow = ''

export function lockRootInert(): void {
  if (locks === 0) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.getElementById('root')?.setAttribute('inert', '')
  }
  locks += 1
}

export function unlockRootInert(): void {
  if (locks === 0) return
  locks -= 1
  if (locks > 0) return
  document.body.style.overflow = previousOverflow
  document.getElementById('root')?.removeAttribute('inert')
}
