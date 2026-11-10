/**
 * Protocole local entre l’application Coffre et son extension navigateur.
 *
 * L’extension ne stocke aucun secret : elle demande à l’onglet Coffre
 * déverrouillé les identifiants du site courant, puis les injecte dans la page
 * active. Aucun message ne quitte la machine.
 */

import type { PhishingAssessment, PhishingQuery } from './phishing'
import type { CardItem, IdentityItem, LoginItem, VaultItem } from './types'
import { isIpAddress, isPublicSuffix, registrableDomain } from './publicSuffix'

export const EXTENSION_BRIDGE_VERSION = 1
export const EXTENSION_MAX_RESULTS = 50

export type ExtensionAutofillKind = 'login' | 'card' | 'identity' | 'custom'

export interface ExtensionLoginSummary {
  id: string
  kind?: 'login'
  title: string
  username: string
  host: string
  hasTotp: boolean
  /** Renseigné par les ponts récents ; absent d’un ancien pont. */
  favorite?: boolean
  updatedAt?: string
}

export interface ExtensionCardSummary {
  id: string
  kind: 'card'
  title: string
  brand: string
  last4: string
  expiry: string
}

export interface ExtensionIdentitySummary {
  id: string
  kind: 'identity'
  title: string
  email: string
  fullName: string
}

export interface ExtensionCustomSummary {
  id: string
  kind: 'custom'
  title: string
  fieldCount: number
}

export type ExtensionAutofillSummary =
  | ExtensionLoginSummary
  | ExtensionCardSummary
  | ExtensionIdentitySummary
  | ExtensionCustomSummary

export interface ExtensionCredentials {
  id: string
  title: string
  username: string
  password: string
  totp: string
}

export interface ExtensionCardValues {
  cardholder: string
  number: string
  expiry: string
  cvc: string
  pin: string
  brand: string
}

export interface ExtensionIdentityValues {
  fullName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  address: string
  city: string
  postalCode: string
  country: string
}

export interface ExtensionCustomValue {
  label: string
  value: string
}

export type ExtensionFillValues =
  | ({ kind: 'login' } & ExtensionCredentials)
  | { kind: 'custom'; id: string; title: string; values: ExtensionCustomValue[] }
  | ({ kind: 'card'; id: string; title: string } & ExtensionCardValues)
  | ({ kind: 'identity'; id: string; title: string } & ExtensionIdentityValues)

export interface ExtensionCardSaveInput {
  title?: string
  cardholder: string
  number: string
  expiry: string
  cvc?: string
  pin?: string
  brand?: string
}

export interface ExtensionIdentitySaveInput {
  title?: string
  fullName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  address: string
  city: string
  postalCode: string
  country: string
}

export interface ExtensionSaveInput {
  host: string
  username: string
  password: string
  title?: string
  /** Vrai uniquement après confirmation explicite d’un avertissement. */
  overridePhishing?: boolean
}

export interface ExtensionSaveResult {
  id: string
  updated: boolean
}

export interface ExtensionPasskeyCreateInput {
  rpId: string
  origin: string
  challenge: string
  userName: string
  userHandle?: string
  excludeCredentials?: string[]
}

export interface ExtensionPasskeyCreateResult {
  itemId: string
  credentialId: string
  userHandle: string
  clientDataJSON: string
  authenticatorData: string
  attestationObject: string
  /** Clé publique COSE ES256, utile aux méthodes de réponse WebAuthn. */
  publicKeyCose: string
  signCount: number
}

export interface ExtensionPasskeyGetInput {
  rpId: string
  origin: string
  challenge: string
  allowCredentials?: string[]
}

export interface ExtensionPasskeyGetResult {
  itemId: string
  credentialId: string
  userHandle: string
  clientDataJSON: string
  authenticatorData: string
  signature: string
  signCount: number
}

export interface ExtensionPhishingChoice {
  host: string
  /** Codes des signaux affichés, jamais l’URL complète. */
  signals: string[]
  choice: 'cancel' | 'continue'
}

export interface CoffreExtensionBridge {
  version: number
  search: (query: string) => Promise<ExtensionLoginSummary[]>
  fill: (
    itemId: string,
    host?: string,
    options?: { allowMismatch?: boolean },
  ) => Promise<ExtensionCredentials | null>
  searchCards?: (query: string) => Promise<ExtensionCardSummary[]>
  searchIdentities?: (query: string) => Promise<ExtensionIdentitySummary[]>
  searchCustom?: (query: string) => Promise<ExtensionCustomSummary[]>
  generateAlias?: (site: string) => Promise<string | null>
  /**
   * Évalue l’hôte avant un remplissage forcé ou un enregistrement. La réponse
   * ne contient aucun secret.
   */
  assessHost?: (query: PhishingQuery) => Promise<PhishingAssessment | null>
  /** Journalise le choix de l’utilisateur, sans URL complète. */
  recordPhishingChoice?: (input: ExtensionPhishingChoice) => Promise<void>
  /** Ajoute un mot de passe généré à l’historique chiffré du coffre. */
  recordGeneratedPassword?: (input: {
    password: string
    host?: string
  }) => Promise<void>
  fillItem?: (
    itemId: string,
    options?: { host?: string; includeSensitive?: boolean; allowMismatch?: boolean },
  ) => Promise<ExtensionFillValues | null>
  /** Enregistre ou met à jour une connexion après soumission du formulaire. */
  saveLogin?: (input: ExtensionSaveInput) => Promise<ExtensionSaveResult | null>
  /** Compare des identifiants soumis à une connexion existante. */
  checkLogin?: (
    input: ExtensionSaveInput,
  ) => Promise<'same' | 'different' | 'missing' | null>
  saveCard?: (input: ExtensionCardSaveInput) => Promise<ExtensionSaveResult | null>
  saveIdentity?: (
    input: ExtensionIdentitySaveInput,
  ) => Promise<ExtensionSaveResult | null>
  passkeyCreate?: (
    input: ExtensionPasskeyCreateInput,
  ) => Promise<ExtensionPasskeyCreateResult | null>
  passkeyGet?: (
    input: ExtensionPasskeyGetInput,
  ) => Promise<ExtensionPasskeyGetResult | null>
}

declare global {
  interface Window {
    __coffreExtension?: CoffreExtensionBridge
  }
}

export function hostFromUrl(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Service d’une page pour la règle de domaines : `schéma://hôte[:port]`.
 *
 * Contrairement à `hostFromUrl`, le schéma et le port sont conservés, car
 * `loginAllowsHost` refuse un élément HTTPS sur une page HTTP et compare le
 * port quand l’élément en précise un. Renvoie une chaîne vide hors http(s).
 */
export function pageServiceFromUrl(value: string): string {
  const raw = value.trim()
  if (!/^https?:\/\//i.test(raw)) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (!url.hostname) return ''
    return `${url.protocol}//${url.host.toLowerCase()}`
  } catch {
    return ''
  }
}

/**
 * URL à enregistrer pour une nouvelle connexion : l’origine de la page quand
 * elle est connue (schéma et port compris), sinon `https://hôte`.
 */
export function loginUrlForService(service: string): string {
  const origin = pageServiceFromUrl(service)
  if (origin) return origin
  const host = hostFromUrl(service) || service.trim().toLowerCase()
  return host ? `https://${host}` : ''
}

function normalizeHost(host: string): string {
  return host
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
}

/**
 * Analyse un hôte ou une URL de service. Un hôte sans schéma est supposé
 * HTTPS ; `hôte:port` est accepté, les autres schémas sont refusés.
 */
function parseWebUrl(value: string): URL | null {
  const raw = value.trim()
  if (!raw) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)
  let candidate = raw
  if (scheme) {
    const name = scheme[1].toLowerCase()
    if (name !== 'http' && name !== 'https') {
      if (!/^[^/]+:\d+(\/|$)/.test(raw)) return null
      candidate = `https://${raw}`
    }
  } else {
    candidate = `https://${raw}`
  }
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return url
  } catch {
    return null
  }
}

/**
 * Compare deux hôtes avec la même règle que les extensions natives :
 * même domaine enregistrable, relation parent/sous-domaine, et refus des
 * suffixes publics. Les IP, `localhost` et les hôtes d’une étiquette ne
 * correspondent qu’à l’identique (ou à un sous-domaine pour une étiquette).
 */
export function hostMatches(itemHost: string, pageHost: string): boolean {
  const item = normalizeHost(hostFromUrl(itemHost) || itemHost)
  const page = normalizeHost(hostFromUrl(pageHost) || pageHost)
  if (!item || !page) return false
  if (item === page) return true
  if (isIpAddress(item) || isIpAddress(page)) return false
  if (isPublicSuffix(item) || isPublicSuffix(page)) return false
  if (!item.includes('.') || !page.includes('.')) {
    return page.endsWith(`.${item}`) || item.endsWith(`.${page}`)
  }
  const itemDomain = registrableDomain(item)
  const pageDomain = registrableDomain(page)
  if (!itemDomain || !pageDomain || itemDomain !== pageDomain) return false
  return page.endsWith(`.${item}`) || item.endsWith(`.${page}`)
}

/**
 * Vrai si l’une des URL de l’élément autorise le remplissage sur ce service.
 * Le pont natif applique ce contrôle avant de renvoyer un secret, même si
 * l’extension a déjà filtré les résultats.
 */
export function loginAllowsHost(
  item: Pick<LoginItem, 'urls'>,
  service: string,
): boolean {
  const page = parseWebUrl(service)
  if (!page) return false
  return item.urls.some((value) => {
    const itemUrl = parseWebUrl(value)
    if (!itemUrl) return false
    if (itemUrl.protocol === 'https:' && page.protocol === 'http:') return false
    if (itemUrl.port && page.port !== itemUrl.port) return false
    return hostMatches(itemUrl.hostname, page.hostname)
  })
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Classe les connexions correspondant à une URL ou à un texte libre.
 * Sans requête, renvoie les connexions les plus récentes (limitées).
 */
export function searchLogins(
  items: VaultItem[],
  query: string,
): ExtensionLoginSummary[] {
  const raw = query.trim()
  const host = raw.includes('.') || raw === 'localhost' ? hostFromUrl(raw) : ''
  const text = normalize(raw)

  const scored = items
    .filter(
      (item): item is LoginItem => item.type === 'login' && !item.deletedAt,
    )
    .map((item) => {
      const hosts = item.urls.map(hostFromUrl).filter(Boolean)
      const hostMatch = host ? hosts.some((entry) => hostMatches(entry, host)) : false
      const textMatch =
        text.length > 0 &&
        (normalize(item.title).includes(text) ||
          normalize(item.username).includes(text) ||
          hosts.some((entry) => entry.includes(text)))
      const score = hostMatch ? 2 : textMatch ? 1 : 0
      return { item, hosts, score }
    })

  const matches = scored.filter((entry) => entry.score > 0)
  const selected = raw ? matches : scored

  return selected
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.item.favorite) - Number(a.item.favorite) ||
        b.item.updatedAt.localeCompare(a.item.updatedAt) ||
        a.item.title.localeCompare(b.item.title, 'fr', { sensitivity: 'base' }),
    )
    .slice(0, EXTENSION_MAX_RESULTS)
    .map(({ item, hosts }) => ({
      id: item.id,
      title: item.title,
      username: item.username,
      host: hosts[0] ?? '',
      hasTotp: Boolean(item.totp),
      favorite: item.favorite,
      updatedAt: item.updatedAt,
    }))
}

export function identityFullName(
  item: Pick<IdentityItem, 'firstName' | 'lastName' | 'title'>,
): string {
  const name = [item.firstName, item.lastName].filter(Boolean).join(' ').trim()
  return name || item.title
}

export function cardLast4(item: Pick<CardItem, 'number'>): string {
  return item.number.replace(/\s+/g, '').slice(-4)
}

/** Classe les cartes correspondant à un texte libre. */
export function searchCards(
  items: VaultItem[],
  query: string,
): ExtensionCardSummary[] {
  const text = normalize(query)
  return items
    .filter((item): item is CardItem => item.type === 'card' && !item.deletedAt)
    .filter((item) => {
      if (!text) return true
      return (
        normalize(item.title).includes(text) ||
        normalize(item.brand).includes(text) ||
        cardLast4(item).includes(text)
      )
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }))
    .slice(0, EXTENSION_MAX_RESULTS)
    .map((item) => ({
      id: item.id,
      kind: 'card',
      title: item.title,
      brand: item.brand,
      last4: cardLast4(item),
      expiry: item.expiry,
    }))
}

/** Classe les identités correspondant à un texte libre. */
export function searchIdentities(
  items: VaultItem[],
  query: string,
): ExtensionIdentitySummary[] {
  const text = normalize(query)
  return items
    .filter(
      (item): item is IdentityItem => item.type === 'identity' && !item.deletedAt,
    )
    .filter((item) => {
      if (!text) return true
      return (
        normalize(item.title).includes(text) ||
        normalize(identityFullName(item)).includes(text) ||
        normalize(item.email).includes(text) ||
        normalize(item.phone).includes(text)
      )
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }))
    .slice(0, EXTENSION_MAX_RESULTS)
    .map((item) => ({
      id: item.id,
      kind: 'identity',
      title: item.title,
      email: item.email,
      fullName: identityFullName(item),
    }))
}
