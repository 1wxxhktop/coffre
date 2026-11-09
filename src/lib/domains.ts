/**
 * Utilitaires de domaines partagés par les passkeys et la protection
 * anti-hameçonnage.
 *
 * La liste de suffixes publics reste volontairement réduite : elle couvre les
 * cas usuels et empêche surtout de considérer un suffixe public comme un
 * domaine enregistrable. Une liste complète (Public Suffix List) serait
 * préférable ; ses limites sont documentées dans `docs/SECURITY.md`.
 */

/** Suffixes publics multi-étiquettes les plus courants. */
export const PUBLIC_SUFFIXES = new Set([
  'com',
  'net',
  'org',
  'io',
  'co',
  'dev',
  'app',
  'ai',
  'fr',
  'de',
  'uk',
  'us',
  'ca',
  'au',
  'jp',
  'cn',
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'co.nz',
  'co.jp',
  'com.br',
  'com.mx',
  'co.in',
  'com.cn',
  'github.io',
  'gitlab.io',
  'pages.dev',
  'workers.dev',
  'appspot.com',
  'herokuapp.com',
  'netlify.app',
  'vercel.app',
  'web.app',
  'firebaseapp.com',
  'azurewebsites.net',
  'cloudfront.net',
])

/** Normalise un nom d’hôte : minuscules, sans point final ni `www.`. */
export function normalizeHostname(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '')
}

/** Vrai pour une adresse IPv4 ou IPv6 (sans crochets). */
export function isIpAddress(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, '')
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return value.split('.').every((part) => Number(part) <= 255)
  }
  return value.includes(':') && /^[0-9a-f:.]+$/i.test(value)
}

/** Vrai pour une adresse de bouclage ou un nom local. */
export function isLoopbackHost(host: string): boolean {
  const value = normalizeHostname(host)
  return (
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value === '::1' ||
    value === '0.0.0.0' ||
    /^127(?:\.\d{1,3}){3}$/.test(value)
  )
}

/** Vrai si la valeur est un suffixe public connu. */
export function isPublicSuffix(value: string): boolean {
  return PUBLIC_SUFFIXES.has(normalizeHostname(value))
}

/**
 * Renvoie le domaine enregistrable (eTLD+1) approximatif d’un hôte.
 * `foo.bar.co.uk` → `bar.co.uk`, `foo.github.io` → `foo.github.io`.
 */
export function registrableDomain(host: string): string {
  const value = normalizeHostname(host)
  if (!value || isIpAddress(value)) return value
  const labels = value.split('.').filter(Boolean)
  if (labels.length <= 1) return value

  for (let index = 0; index < labels.length; index += 1) {
    const suffix = labels.slice(index).join('.')
    if (!PUBLIC_SUFFIXES.has(suffix)) continue
    const start = Math.max(0, index - 1)
    return labels.slice(start).join('.')
  }
  return labels.slice(-2).join('.')
}
