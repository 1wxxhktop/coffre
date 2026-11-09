/**
 * Protection anti-hameçonnage au remplissage et à l’enregistrement.
 *
 * Le module ne fait aucune requête réseau : il compare l’hôte de la page aux
 * domaines déjà présents dans le coffre et à une liste embarquée de sites
 * populaires. Les signaux sont des codes stables ; l’interface les traduit et
 * ne reçoit jamais l’URL complète.
 */

import popularRaw from '../assets/popular-domains.json?raw'
import confusablesRaw from '../assets/confusables.json?raw'
import equivalencesRaw from '../assets/domain-equivalences.json?raw'
import {
  isIpAddress,
  isLoopbackHost,
  normalizeHostname,
  registrableDomain,
} from './domains'
import type { LoginItem, PasskeyItem, VaultItem } from './types'

export type PhishingLevel = 'warning' | 'danger'

export type PhishingSignalCode =
  | 'confusable'
  | 'typo'
  | 'brand-subdomain'
  | 'ip'
  | 'http'
  | 'port'
  | 'unknown-domain'

export interface PhishingSignal {
  code: PhishingSignalCode
  level: PhishingLevel
  /** Domaine connu imité, sans chemin ni paramètres. */
  knownDomain?: string
}

export interface PhishingAssessment {
  /** Hôte normalisé (sans `www.`), vide si l’entrée est invalide. */
  host: string
  /** Domaine enregistrable approximatif de l’hôte. */
  registrable: string
  signals: PhishingSignal[]
  /** Niveau maximal, `null` lorsqu’aucun signal n’est présent. */
  level: PhishingLevel | null
}

export interface PhishingQuery {
  /** Hôte ou URL de la page. */
  host?: string
  /** URL complète, utile pour les signaux HTTP et de port. */
  url?: string
  /** Identifiant saisi, pour le signal « domaine jamais vu ». */
  username?: string
  /** `save` active le signal « domaine jamais vu ». */
  mode?: 'fill' | 'save'
  /** Élément demandé, pour ignorer les signaux de domaine s’il correspond. */
  itemId?: string
  /**
   * Vrai lorsque l’élément autorise déjà l’hôte : les signaux d’imitation sont
   * alors inutiles, mais IP, HTTP et port restent vérifiés.
   */
  skipDomainSignals?: boolean
}

interface DomainEntry {
  host: string
  registrable: string
  skeleton: string
  labels: string[]
  brandLabel: string
}

export interface PhishingIndex {
  domains: DomainEntry[]
  byHost: Map<string, DomainEntry>
  bySkeleton: Map<string, DomainEntry[]>
  byBrandLabel: Map<string, DomainEntry[]>
  byBrandPrefix2: Map<string, DomainEntry[]>
  byBrandSuffix2: Map<string, DomainEntry[]>
  byBrandPrefix1: Map<string, DomainEntry[]>
  byBrandSuffix1: Map<string, DomainEntry[]>
  usernames: Map<string, Set<string>>
  equivalence: Map<string, string>
}

interface PopularDataset {
  domains: string[]
}

interface ConfusablesDataset {
  mappings: Record<string, string>
}

interface EquivalencesDataset {
  groups: string[][]
}

const POPULAR = JSON.parse(popularRaw) as PopularDataset
const CONFUSABLES = JSON.parse(confusablesRaw) as ConfusablesDataset
const EQUIVALENCES = JSON.parse(equivalencesRaw) as EquivalencesDataset

const indexCache = new WeakMap<VaultItem[], PhishingIndex>()
let popularIndex: PhishingIndex | null = null

/**
 * Correspondances multi-caractères fréquentes que la table Unicode réduite ne
 * contient pas (elle privilégie les caractères isolés).
 */
const SEQUENCES: Array<[RegExp, string]> = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/cl/g, 'd'],
  [/cj/g, 'g'],
]

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
}

function decodeDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 22
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 97
  return 36
}

function adapt(delta: number, points: number, first: boolean): number {
  let value = first ? Math.floor(delta / 700) : delta >> 1
  value += Math.floor(value / points)
  let k = 0
  while (value > 455) {
    value = Math.floor(value / 35)
    k += 36
  }
  return k + Math.floor((36 * value) / (value + 38))
}

/** Décode un libellé punycode (sans le préfixe `xn--`). */
export function decodePunycodeLabel(label: string): string | null {
  const output: number[] = []
  let inputIndex = 0
  let accumulator = 0
  let n = 128
  let bias = 72
  const basic = label.lastIndexOf('-')
  if (basic > -1) {
    for (let position = 0; position < basic; position += 1) {
      const code = label.charCodeAt(position)
      if (code >= 128) return null
      output.push(code)
    }
    inputIndex = basic + 1
  }

  while (inputIndex < label.length) {
    const oldAccumulator = accumulator
    let weight = 1
    let k = 36
    for (;;) {
      if (inputIndex >= label.length) return null
      const digit = decodeDigit(label.charCodeAt(inputIndex))
      inputIndex += 1
      if (digit >= 36) return null
      if (digit > Math.floor((0x7fffffff - accumulator) / weight)) return null
      accumulator += digit * weight
      const threshold = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias
      if (digit < threshold) break
      if (weight > Math.floor(0x7fffffff / (36 - threshold))) return null
      weight *= 36 - threshold
      k += 36
    }
    const length = output.length + 1
    bias = adapt(accumulator - oldAccumulator, length, oldAccumulator === 0)
    if (Math.floor(accumulator / length) > 0x7fffffff - n) return null
    n += Math.floor(accumulator / length)
    accumulator %= length
    output.splice(accumulator, 0, n)
    accumulator += 1
  }

  try {
    return String.fromCodePoint(...output)
  } catch {
    return null
  }
}

/** Décode les libellés `xn--` d’un hôte ; renvoie l’hôte tel quel si échec. */
export function decodeHost(host: string): string {
  return normalizeHostname(host)
    .split('.')
    .map((label) =>
      label.startsWith('xn--')
        ? decodePunycodeLabel(label.slice(4)) ?? label
        : label,
    )
    .join('.')
}

/** Squelette de confusables : minuscules, sans accents, chiffres leetspeak. */
export function skeleton(value: string): string {
  const normalized = value.normalize('NFKC').toLowerCase()
  let output = ''
  for (const character of normalized) {
    output += CONFUSABLES.mappings[character] ?? LEET[character] ?? character
  }
  for (const [pattern, replacement] of SEQUENCES) {
    output = output.replace(pattern, replacement)
  }
  return output.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Distance de Damerau-Levenshtein bornée (variante OSA). */
export function damerauLevenshtein(
  first: string,
  second: string,
  max = 2,
): number {
  if (first === second) return 0
  if (Math.abs(first.length - second.length) > max) return max + 1
  if (!first || !second) return Math.max(first.length, second.length)

  let previousPrevious: number[] = []
  let previous: number[] = Array.from({ length: second.length + 1 }, (_, index) => index)

  for (let i = 1; i <= first.length; i += 1) {
    const current: number[] = [i]
    let rowMinimum = i
    for (let j = 1; j <= second.length; j += 1) {
      const cost = first[i - 1] === second[j - 1] ? 0 : 1
      let value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      )
      if (
        i > 1 &&
        j > 1 &&
        first[i - 1] === second[j - 2] &&
        first[i - 2] === second[j - 1]
      ) {
        value = Math.min(value, (previousPrevious[j - 2] ?? 0) + 1)
      }
      current[j] = value
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > max) return max + 1
    previousPrevious = previous
    previous = current
  }

  return previous[second.length] ?? max + 1
}

function entryFor(host: string): DomainEntry {
  const normalized = normalizeHostname(host)
  const labels = normalized.split('.').filter(Boolean)
  return {
    host: normalized,
    registrable: registrableDomain(normalized),
    skeleton: skeleton(decodeHost(normalized)),
    labels,
    brandLabel: labels[0] ?? '',
  }
}

function addDomain(byHost: Map<string, DomainEntry>, host: string): void {
  const normalized = normalizeHostname(host)
  if (!normalized || !normalized.includes('.')) return
  if (byHost.has(normalized)) return
  byHost.set(normalized, entryFor(normalized))
}

function buildEquivalence(): Map<string, string> {
  const map = new Map<string, string>()
  EQUIVALENCES.groups.forEach((group, index) => {
    const id = `g${index}`
    for (const domain of group) {
      const normalized = normalizeHostname(domain)
      if (normalized && !map.has(normalized)) map.set(normalized, id)
    }
  })
  return map
}

function finalizeIndex(
  byHost: Map<string, DomainEntry>,
  usernames: Map<string, Set<string>>,
): PhishingIndex {
  const domains = [...byHost.values()]
  const bySkeleton = new Map<string, DomainEntry[]>()
  const byBrandLabel = new Map<string, DomainEntry[]>()
  const byBrandPrefix2 = new Map<string, DomainEntry[]>()
  const byBrandSuffix2 = new Map<string, DomainEntry[]>()
  const byBrandPrefix1 = new Map<string, DomainEntry[]>()
  const byBrandSuffix1 = new Map<string, DomainEntry[]>()

  const addTo = (map: Map<string, DomainEntry[]>, key: string, entry: DomainEntry) => {
    if (!key) return
    const group = map.get(key) ?? []
    group.push(entry)
    map.set(key, group)
  }

  for (const domain of domains) {
    const skeletonGroup = bySkeleton.get(domain.skeleton) ?? []
    skeletonGroup.push(domain)
    bySkeleton.set(domain.skeleton, skeletonGroup)

    // Seuls les domaines enregistrables alimentent les index de marque : un
    // sous-domaine générique (`account.`, `login.`) ne doit pas devenir une
    // marque à lui seul.
    const brand = domain.brandLabel
    if (domain.host === domain.registrable && brand.length >= 5) {
      addTo(byBrandLabel, brand, domain)
      addTo(byBrandPrefix2, brand.slice(0, 2), domain)
      addTo(byBrandSuffix2, brand.slice(-2), domain)
      addTo(byBrandPrefix1, brand.slice(0, 1), domain)
      addTo(byBrandSuffix1, brand.slice(-1), domain)
    }
  }

  return {
    domains,
    byHost,
    bySkeleton,
    byBrandLabel,
    byBrandPrefix2,
    byBrandSuffix2,
    byBrandPrefix1,
    byBrandSuffix1,
    usernames,
    equivalence: buildEquivalence(),
  }
}

/** Construit l’index à partir des domaines du coffre et de la liste populaire. */
export function buildPhishingIndex(items: VaultItem[]): PhishingIndex {
  const byHost = new Map<string, DomainEntry>()
  const usernames = new Map<string, Set<string>>()

  for (const domain of POPULAR.domains) addDomain(byHost, domain)

  for (const item of items) {
    if (item.deletedAt) continue
    if (item.type === 'login') {
      const login = item as LoginItem
      const username = login.username.trim().toLowerCase()
      for (const value of login.urls) {
        const host = hostFromValue(value)
        if (!host) continue
        addDomain(byHost, host)
        addDomain(byHost, registrableDomain(host))
        if (username) {
          const set = usernames.get(username) ?? new Set<string>()
          set.add(registrableDomain(host))
          usernames.set(username, set)
        }
      }
    } else if (item.type === 'passkey') {
      const passkey = item as PasskeyItem
      const host = normalizeHostname(passkey.rpId)
      if (host) {
        addDomain(byHost, host)
        addDomain(byHost, registrableDomain(host))
      }
    }
  }

  return finalizeIndex(byHost, usernames)
}

/** Index populaire seul, mis en cache pour les appels sans coffre. */
export function popularPhishingIndex(): PhishingIndex {
  if (popularIndex) return popularIndex
  const byHost = new Map<string, DomainEntry>()
  for (const domain of POPULAR.domains) addDomain(byHost, domain)
  popularIndex = finalizeIndex(byHost, new Map())
  return popularIndex
}

/** Index du coffre mis en cache tant que le tableau d’éléments est identique. */
export function phishingIndexFor(items: VaultItem[]): PhishingIndex {
  const cached = indexCache.get(items)
  if (cached) return cached
  const index = buildPhishingIndex(items)
  indexCache.set(items, index)
  return index
}

function hostFromValue(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return normalizeHostname(url.hostname)
  } catch {
    return normalizeHostname(raw)
  }
}

function parseQuery(query: PhishingQuery): {
  host: string
  url: URL | null
} {
  const raw = (query.url ?? query.host ?? '').trim()
  if (!raw) return { host: '', url: null }
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return {
      host: normalizeHostname(parsed.hostname),
      url: parsed,
    }
  } catch {
    return { host: normalizeHostname(query.host ?? raw), url: null }
  }
}

function equivalent(index: PhishingIndex, first: string, second: string): boolean {
  const a = index.equivalence.get(first)
  const b = index.equivalence.get(second)
  return Boolean(a && b && a === b)
}

function isBrandSubdomain(
  host: string,
  pageRegistrable: string,
  known: DomainEntry,
): boolean {
  const labels = host.split('.').filter(Boolean)
  const registrableLabels = pageRegistrable.split('.').filter(Boolean)
  if (labels.length <= registrableLabels.length) return false
  const prefix = labels.slice(0, labels.length - registrableLabels.length)

  const knownLabels = known.host.split('.').filter(Boolean)
  for (let index = 0; index + knownLabels.length <= prefix.length; index += 1) {
    if (prefix.slice(index, index + knownLabels.length).join('.') === known.host) {
      return true
    }
  }
  return known.brandLabel.length >= 5 && prefix.includes(known.brandLabel)
}

function addSignal(
  signals: PhishingSignal[],
  code: PhishingSignalCode,
  level: PhishingLevel,
  knownDomain?: string,
): void {
  const key = `${code}:${knownDomain ?? ''}`
  if (signals.some((signal) => `${signal.code}:${signal.knownDomain ?? ''}` === key)) {
    return
  }
  signals.push({ code, level, ...(knownDomain ? { knownDomain } : {}) })
}

/**
 * Analyse un hôte avant un remplissage ou un enregistrement.
 * Retourne tous les signaux, du plus grave au plus faible.
 */
export function assessPhishing(
  index: PhishingIndex,
  query: PhishingQuery,
): PhishingAssessment {
  const { host, url } = parseQuery(query)
  if (!host) {
    return { host: '', registrable: '', signals: [], level: null }
  }

  const registrable = registrableDomain(host)
  const loopback = isLoopbackHost(host)
  const signals: PhishingSignal[] = []

  if (isIpAddress(host) && !loopback) {
    addSignal(signals, 'ip', 'danger')
  }
  if (url?.protocol === 'http:' && !loopback) {
    addSignal(signals, 'http', 'danger')
  }
  if (url?.port && !['80', '443'].includes(url.port) && !loopback) {
    addSignal(signals, 'port', 'warning')
  }

  const exact = index.byHost.get(host)
  const pageSkeleton = skeleton(decodeHost(host))
  const domainSignals: PhishingSignal[] = []

  if (!exact && !query.skipDomainSignals) {
    const labels = host.split('.').filter(Boolean)
    const registrableLabels = registrable.split('.').filter(Boolean)
    const prefixLabels = labels.slice(0, labels.length - registrableLabels.length)
    const pageBrand = registrableLabels[0] ?? ''
    const pageTld = registrableLabels.slice(1).join('.')

    const confusableGroups = index.bySkeleton.get(pageSkeleton) ?? []
    for (const known of confusableGroups) {
      if (known.host === host) continue
      if (known.registrable === registrable) continue
      if (equivalent(index, known.registrable, registrable)) continue
      addSignal(domainSignals, 'confusable', 'danger', known.host)
    }

    const brandCandidates = new Map<string, DomainEntry>()
    for (const label of labels) {
      for (const entry of index.byBrandLabel.get(label) ?? []) {
        brandCandidates.set(entry.host, entry)
      }
    }
    for (let start = 0; start < prefixLabels.length; start += 1) {
      for (let end = start + 1; end <= prefixLabels.length; end += 1) {
        const entry = index.byHost.get(prefixLabels.slice(start, end).join('.'))
        if (entry) brandCandidates.set(entry.host, entry)
      }
    }
    for (const known of brandCandidates.values()) {
      if (known.host === host) continue
      if (known.registrable === registrable) continue
      if (equivalent(index, known.registrable, registrable)) continue
      if (isBrandSubdomain(host, registrable, known)) {
        addSignal(domainSignals, 'brand-subdomain', 'danger', known.host)
      }
    }

    const checkTypo = (label: string, pageBrandLabel: boolean) => {
      if (label.length < 5) return
      const candidates = new Map<string, DomainEntry>()
      const keys: Array<[Map<string, DomainEntry[]>, string]> = [
        [index.byBrandPrefix2, label.slice(0, 2)],
        [index.byBrandSuffix2, label.slice(-2)],
        [index.byBrandPrefix1, label.slice(0, 1)],
        [index.byBrandSuffix1, label.slice(-1)],
      ]
      for (const [map, key] of keys) {
        for (const entry of map.get(key) ?? []) candidates.set(entry.host, entry)
      }

      for (const known of candidates.values()) {
        if (known.host === host || known.registrable === registrable) continue
        if (equivalent(index, known.registrable, registrable)) continue
        if (Math.abs(label.length - known.brandLabel.length) > 2) continue
        const distance = damerauLevenshtein(label, known.brandLabel, 2)
        if (distance === 0) {
          // Même marque : seule une faute sur le TLD (github.co / github.com)
          // justifie un signal. Un domaine national légitime (paypal.fr) reste
          // ignoré.
          if (!pageBrandLabel) continue
          const knownTld = known.registrable.split('.').slice(1).join('.')
          if (pageTld === knownTld) continue
          const fullDistance = damerauLevenshtein(registrable, known.registrable, 2)
          if (fullDistance <= 2) {
            addSignal(
              domainSignals,
              'typo',
              fullDistance <= 1 ? 'danger' : 'warning',
              known.host,
            )
          }
          continue
        }
        if (distance <= 2) {
          addSignal(
            domainSignals,
            'typo',
            distance <= 1 ? 'danger' : 'warning',
            known.host,
          )
        }
      }
    }

    checkTypo(pageBrand, true)
    // Les marques présentes comme libellé à gauche du domaine enregistrable
    // sont aussi comparées : `paypa1.com.evil.io`.
    for (const label of prefixLabels) checkTypo(label, false)
  }

  signals.push(...domainSignals)

  const username = query.username?.trim().toLowerCase() ?? ''
  if (query.mode === 'save' && username && signals.length === 0) {
    const known = index.usernames.get(username)
    if (known && known.size > 0) {
      const seen = [...known].some(
        (entry) => entry === registrable || equivalent(index, entry, registrable),
      )
      if (!seen) {
        addSignal(signals, 'unknown-domain', 'warning')
      }
    }
  }

  const priority: Record<PhishingSignalCode, number> = {
    'brand-subdomain': 0,
    confusable: 1,
    typo: 2,
    ip: 3,
    http: 4,
    port: 5,
    'unknown-domain': 6,
  }
  signals.sort((first, second) => {
    if (first.level !== second.level) return first.level === 'danger' ? -1 : 1
    return priority[first.code] - priority[second.code]
  })

  return {
    host,
    registrable,
    signals,
    level: signals.some((signal) => signal.level === 'danger')
      ? 'danger'
      : signals.length > 0
        ? 'warning'
        : null,
  }
}

/** Analyse avec l’index du coffre mis en cache. */
export function assessPhishingForItems(
  items: VaultItem[],
  query: PhishingQuery,
): PhishingAssessment {
  return assessPhishing(phishingIndexFor(items), query)
}

/** Résumé textuel stable pour le journal d’activité, sans URL complète. */
export function phishingSignalSummary(signals: PhishingSignal[]): string {
  return signals.map((signal) => signal.code).join(',')
}
