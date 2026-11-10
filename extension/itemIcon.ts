/**
 * Icônes locales des éléments, alignées sur `ItemIcon` de l’application.
 *
 * Aucune favicon n’est téléchargée : le rendu reste hors ligne et ne révèle
 * pas les sites visités à un tiers. La pastille d’initiale complète l’icône de
 * type sans dépendre du réseau.
 */

const ICONS: Record<string, string> = {
  login:
    '<circle cx="7.5" cy="15.5" r="3.5"/><path d="m10.5 13 8-8m-3 3 2 2m-5 1 2 2"/>',
  card:
    '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  identity:
    '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  note:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  custom:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
}

const STATE_ICONS: Record<string, string> = {
  closed:
    '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="m9 13 2 2 4-4"/>',
  pair:
    '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
  locked:
    '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  site:
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  empty:
    '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
}

export function itemIconSvg(kind: string | undefined, size = 17): string {
  const name = kind && ICONS[kind] ? kind : 'login'
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
}

export function stateIconSvg(kind: string): string {
  const path = STATE_ICONS[kind] ?? STATE_ICONS.empty
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
}

export function itemInitial(title: string): string {
  return (title.trim()[0] ?? '?').toUpperCase()
}
