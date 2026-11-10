/**
 * Normalisation des exclusions par site.
 *
 * Les listes stockées ne contiennent que des domaines, jamais des URL, des
 * chemins ni des identifiants. Le domaine retenu est le domaine enregistrable
 * usuel : `login.example.com` et `www.example.com` deviennent `example.com`.
 * La liste de suffixes multi-étiquettes est volontairement bornée ; une liste
 * publique complète (PSL) serait préférable mais alourdirait l’extension.
 */

const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'ltd.uk',
  'plc.uk',
  'me.uk',
  'sch.uk',
  'com.au',
  'net.au',
  'co.nz',
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'com.br',
  'com.mx',
  'com.ar',
  'com.pl',
  'com.es',
  'com.pt',
  'com.tr',
  'com.sg',
  'com.hk',
  'com.cn',
  'co.in',
  'co.za',
  'co.il',
  'co.kr',
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

function hostOf(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  try {
    return new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`,
    ).hostname
      .toLowerCase()
      .replace(/\.$/, '')
  } catch {
    return ''
  }
}

/** Domaine enregistrable usuel, sans `www`, IP ni port. */
export function siteKey(value: string): string {
  const raw = hostOf(value) || value.trim().toLowerCase()
  const host = raw.replace(/^www\./, '').replace(/^\.+|\.+$/g, '')
  if (!host) return ''
  if (
    host === 'localhost' ||
    host.includes(':') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
  ) {
    return host
  }
  const labels = host.split('.').filter(Boolean)
  if (labels.length <= 2) return host
  const lastTwo = labels.slice(-2).join('.')
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join('.')
  }
  return lastTwo
}

export function normalizeExclusions(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const sites = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const key = siteKey(value)
    if (key) sites.add(key)
    if (sites.size >= 500) break
  }
  return [...sites]
}

export function isSiteExcluded(entries: string[], host: string): boolean {
  const target = siteKey(host)
  if (!target) return false
  return entries.some((entry) => {
    const value = siteKey(entry)
    return Boolean(value) && (target === value || target.endsWith(`.${value}`))
  })
}
