/**
 * Règles de domaine partagées par les passkeys, le remplissage et les
 * extensions natives.
 *
 * La liste des suffixes publics est volontairement embarquée et limitée aux
 * suffixes courants : elle ne remplace pas la Public Suffix List complète,
 * mais elle empêche de traiter un suffixe public comme un domaine enregistrable.
 * Le fichier JSON est aussi lu par `coffre-core` pour que les deux
 * implémentations utilisent exactement la même liste.
 */

import suffixes from './public-suffixes.json'

export const PUBLIC_SUFFIXES: ReadonlySet<string> = new Set(suffixes)

/** Vrai pour une adresse IPv4 ou IPv6 (forme normalisée par `URL`). */
export function isIpAddress(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, '')
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || value.includes(':')
}

/** Vrai si `host` est un suffixe public connu. */
export function isPublicSuffix(host: string): boolean {
  return PUBLIC_SUFFIXES.has(host)
}

/**
 * Domaine enregistrable (eTLD+1) d’un hôte déjà normalisé, ou `null` pour une
 * IP, `localhost`, un hôte d’une seule étiquette ou un suffixe public.
 */
export function registrableDomain(host: string): string | null {
  const value = host.replace(/\.$/, '').toLowerCase()
  if (!value || isIpAddress(value) || value === 'localhost' || !value.includes('.')) {
    return null
  }
  const labels = value.split('.')
  for (let index = 0; index < labels.length; index++) {
    if (PUBLIC_SUFFIXES.has(labels.slice(index).join('.'))) {
      return index === 0 ? null : labels.slice(index - 1).join('.')
    }
  }
  return labels.slice(-2).join('.')
}
