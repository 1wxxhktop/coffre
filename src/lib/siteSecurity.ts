/**
 * Disponibilité de la 2FA et des passkeys par site.
 *
 * Jeu de données embarqué et daté, chargé à la demande dans un chunk séparé :
 * il ne fait pas partie du bundle de l’extension et n’effectue aucune requête
 * vers un service externe. Les données proviennent de 2FA Directory (MIT) et
 * Passkeys Directory (CC BY 4.0).
 */

import { normalizeHostname } from './domains'

export interface SiteSecurityInfo {
  /** Méthodes de 2FA connues pour le site. */
  twoFactor: string[]
  /** Documentation de configuration de la 2FA, si fournie. */
  documentation?: string
  /** Le site accepte les passkeys (connexion ou second facteur). */
  passkeys: boolean
  /** Documentation des passkeys, si fournie. */
  passkeyDocumentation?: string
}

interface TwoFactorEntry {
  domain: string
  methods: string[]
  documentation?: string
}

interface PasskeyEntry {
  domain: string
  documentation?: string
}

interface SiteSecurityDataset {
  twoFactor: Map<string, TwoFactorEntry>
  passkeys: Map<string, PasskeyEntry>
}

let dataset: SiteSecurityDataset | null = null
let loading: Promise<void> | null = null
const hostCache = new Map<string, SiteSecurityInfo | null>()

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseDataset(raw: string): SiteSecurityDataset {
  const parsed = JSON.parse(raw) as {
    twoFactor?: { data?: unknown }
    passkeys?: { data?: unknown }
  }
  const twoFactor = new Map<string, TwoFactorEntry>()
  const passkeys = new Map<string, PasskeyEntry>()

  if (Array.isArray(parsed.twoFactor?.data)) {
    for (const entry of parsed.twoFactor.data) {
      if (!Array.isArray(entry)) continue
      const domain = normalizeHostname(text(entry[0]) ?? '')
      const methods = Array.isArray(entry[1])
        ? entry[1].filter((value): value is string => typeof value === 'string')
        : []
      if (!domain || methods.length === 0) continue
      twoFactor.set(domain, {
        domain,
        methods: [...new Set(methods)],
        documentation: text(entry[2]),
      })
    }
  }

  if (Array.isArray(parsed.passkeys?.data)) {
    for (const entry of parsed.passkeys.data) {
      if (!Array.isArray(entry)) continue
      const domain = normalizeHostname(text(entry[0]) ?? '')
      if (!domain) continue
      passkeys.set(domain, {
        domain,
        documentation: text(entry[1]),
      })
    }
  }

  return { twoFactor, passkeys }
}

/**
 * Charge le jeu de données dans un chunk séparé. Idempotent ; une erreur de
 * chargement laisse le prochain appel réessayer et ne bloque pas le coffre.
 */
export function loadSiteSecurity(): Promise<void> {
  if (dataset) return Promise.resolve()
  if (loading) return loading
  loading = import('../assets/site-security.json?raw')
    .then((module) => {
      dataset = parseDataset(module.default)
      hostCache.clear()
    })
    .catch(() => {
      loading = null
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** Vrai une fois l’instantané chargé (utile aux tests et à l’interface). */
export function siteSecurityLoaded(): boolean {
  return dataset !== null
}

/** Réinitialise le cache ; réservé aux tests. */
export function resetSiteSecurityForTests(): void {
  dataset = null
  loading = null
  hostCache.clear()
}

/**
 * Informations connues pour un hôte, avec repli sur les domaines parents.
 * `null` si aucune donnée n’est disponible : l’appelant ne doit alors afficher
 * aucune alerte « Sans 2FA ».
 */
export function siteSecurityForHost(host: string): SiteSecurityInfo | null {
  if (!dataset) return null
  const normalized = normalizeHostname(host)
  if (!normalized) return null
  const cached = hostCache.get(normalized)
  if (cached !== undefined) return cached

  const labels = normalized.split('.').filter(Boolean)
  let twoFactor: TwoFactorEntry | undefined
  let passkey: PasskeyEntry | undefined
  for (let index = 0; index < labels.length; index += 1) {
    const candidate = labels.slice(index).join('.')
    if (!twoFactor) twoFactor = dataset.twoFactor.get(candidate)
    if (!passkey) passkey = dataset.passkeys.get(candidate)
    if (twoFactor && passkey) break
  }

  if (!twoFactor && !passkey) {
    hostCache.set(normalized, null)
    return null
  }

  const info: SiteSecurityInfo = {
    twoFactor: twoFactor?.methods ?? [],
    documentation: twoFactor?.documentation,
    passkeys: Boolean(passkey),
    passkeyDocumentation: passkey?.documentation,
  }
  hostCache.set(normalized, info)
  return info
}

/** Vrai si le site propose au moins une méthode de 2FA connue. */
export function siteOffersTwoFactor(host: string): boolean {
  return (siteSecurityForHost(host)?.twoFactor.length ?? 0) > 0
}

/** Vrai si le site accepte les passkeys. */
export function siteSupportsPasskeys(host: string): boolean {
  return siteSecurityForHost(host)?.passkeys === true
}

/** Nombre de sites couverts, pour les tests et la documentation. */
export function siteSecurityCoverage(): { twoFactor: number; passkeys: number } {
  return {
    twoFactor: dataset?.twoFactor.size ?? 0,
    passkeys: dataset?.passkeys.size ?? 0,
  }
}
