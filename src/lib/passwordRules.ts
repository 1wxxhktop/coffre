/**
 * Règles de mot de passe par site.
 *
 * Le dataset provient d’Apple « Password Manager Resources » (MIT) et reste
 * embarqué : aucune requête réseau n’est faite pour connaître les contraintes
 * d’un site. Le parseur accepte la syntaxe `minlength`, `maxlength`,
 * `max-consecutive`, `required` et `allowed`, y compris les classes `[...]`
 * contenant des espaces, des virgules ou des points-virgules.
 */

import rulesRaw from '../assets/password-rules.json?raw'
import { randomInt } from './password'

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const SPECIAL = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
const ASCII_PRINTABLE = Array.from({ length: 95 }, (_, index) =>
  String.fromCharCode(33 + index),
).join('')

interface RawRule {
  'password-rules'?: string
}

const RAW = JSON.parse(rulesRaw) as Record<string, RawRule>
const CACHE = new Map<string, SitePasswordRules | null>()

export interface SitePasswordRules {
  minLength: number
  maxLength: number
  maxConsecutive?: number
  required: string[]
  allowed: string | null
}

/** Découpe sans couper à l’intérieur d’une classe `[...]`. */
function splitTop(value: string, delimiter: string): string[] {
  const parts: string[] = []
  let current = ''
  let inClass = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (!inClass && character === '[') {
      inClass = true
      current += character
      continue
    }
    if (inClass && character === ']') {
      let next = index + 1
      while (value[next] === ' ') next += 1
      if (next >= value.length || value[next] === delimiter) {
        inClass = false
      }
      current += character
      continue
    }
    if (!inClass && character === delimiter) {
      parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  parts.push(current)
  return parts
}

function splitRule(value: string): [string, string] | null {
  const parts = splitTop(value, ':')
  if (parts.length < 2) return null
  return [parts[0].trim().toLowerCase(), parts.slice(1).join(':').trim()]
}

function setForToken(token: string): string | null {
  const normalized = token.trim()
  if (normalized === 'lower') return LOWER
  if (normalized === 'upper') return UPPER
  if (normalized === 'digit') return DIGITS
  if (normalized === 'special') return SPECIAL
  if (normalized === 'ascii-printable') return ASCII_PRINTABLE
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return normalized.slice(1, -1)
  }
  return null
}

/** Parse une règle Apple. Les clés inconnues sont ignorées. */
export function parsePasswordRules(input: string): SitePasswordRules {
  let minLength = 8
  let maxLength = 128
  let maxConsecutive: number | undefined
  const required: string[] = []
  let allowed: string | null = null

  for (const rawRule of splitTop(input, ';')) {
    const rule = splitRule(rawRule)
    if (!rule) continue
    const [key, value] = rule
    if (key === 'minlength' || key === 'maxlength' || key === 'max-consecutive') {
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed < 1) continue
      if (key === 'minlength') minLength = parsed
      else if (key === 'maxlength') maxLength = parsed
      else maxConsecutive = parsed
      continue
    }
    const tokens = splitTop(value, ',')
      .map(setForToken)
      .filter((entry): entry is string => Boolean(entry))
    if (key === 'required') required.push(...tokens)
    else if (key === 'allowed') {
      const union = tokens.join('')
      if (union) allowed = union
    }
  }

  return {
    minLength,
    maxLength: Math.max(minLength, maxLength),
    maxConsecutive,
    required,
    allowed,
  }
}

function datasetDomain(host: string): string | null {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.')
  for (let index = 0; index < labels.length; index += 1) {
    const candidate = labels.slice(index).join('.')
    if (RAW[candidate]?.['password-rules']) return candidate
  }
  return null
}

/** Cherche les règles d’un hôte, avec repli sur les domaines parents. */
export function passwordRulesForDomain(host: string): SitePasswordRules | null {
  const domain = datasetDomain(host)
  if (!domain) return null
  if (CACHE.has(domain)) return CACHE.get(domain) ?? null
  const entry = RAW[domain]
  if (!entry?.['password-rules']) return null
  try {
    const rules = parsePasswordRules(entry['password-rules'])
    CACHE.set(domain, rules)
    return rules
  } catch {
    CACHE.set(domain, null)
    return null
  }
}

/** Extrait les règles depuis une URL ou un hôte. */
export function passwordRulesForUrl(
  value: string,
): { domain: string; rules: SitePasswordRules } | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  let host: string
  try {
    host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname
  } catch {
    return null
  }
  const domain = datasetDomain(host.replace(/^www\./, ''))
  if (!domain) return null
  const rules = passwordRulesForDomain(domain)
  return rules ? { domain, rules } : null
}

function shuffle(chars: string[]): string[] {
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1)
    ;[chars[index], chars[target]] = [chars[target], chars[index]]
  }
  return chars
}

function respectsConsecutive(value: string, limit?: number): boolean {
  if (!limit) return true
  let run = 1
  for (let index = 1; index < value.length; index += 1) {
    run = value[index] === value[index - 1] ? run + 1 : 1
    if (run > limit) return false
  }
  return true
}

/** Génère un mot de passe conforme aux règles d’un site. */
export function generatePasswordForRules(
  rules: SitePasswordRules,
  desiredLength = 20,
): string {
  const required = rules.required.filter((set) => set.length > 0)
  if (rules.maxLength < required.length) {
    throw new Error('Règles de site incompatibles')
  }
  const length = Math.min(
    rules.maxLength,
    Math.max(rules.minLength, Math.round(desiredLength), required.length),
  )
  const pool = Array.from(
    new Set((rules.allowed ?? `${LOWER}${UPPER}${DIGITS}${SPECIAL}`) + required.join('')),
  ).join('')

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const chars: string[] = []
    for (const set of required) chars.push(set[randomInt(set.length)])
    while (chars.length < length) chars.push(pool[randomInt(pool.length)])
    const candidate = shuffle(chars).join('')
    if (respectsConsecutive(candidate, rules.maxConsecutive)) return candidate
  }
  throw new Error('Impossible de respecter les règles du site')
}

/** Entropie approximative d’un mot de passe contraint. */
export function sitePasswordEntropy(rules: SitePasswordRules, desiredLength = 20): number {
  const length = Math.min(rules.maxLength, Math.max(rules.minLength, desiredLength))
  const pool = new Set(
    (rules.allowed ?? `${LOWER}${UPPER}${DIGITS}${SPECIAL}`) + rules.required.join(''),
  ).size
  return Math.max(0, Math.round(Math.log2(Math.max(pool, 1)) * length))
}

/** Liste des domaines couverts, pour les tests et la documentation. */
export function sitePasswordRuleDomains(): string[] {
  return Object.keys(RAW)
}
