/**
 * Navigation clavier des groupes d’onglets ARIA.
 *
 * Le motif WAI-ARIA « tabs » attend les flèches pour changer d’onglet, avec
 * bouclage, et Home/End pour aller au premier ou au dernier. Ce module ne
 * manipule pas le DOM : il calcule l’index à activer, ce qui le rend testable
 * et réutilisable par les composants.
 */
export function nextTabIndex(
  key: string,
  currentIndex: number,
  count: number,
): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return currentIndex < 0 ? 0 : (currentIndex + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return currentIndex < 0 ? count - 1 : (currentIndex - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
