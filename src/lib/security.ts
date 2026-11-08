/**
 * Analyse de santé du coffre.
 *
 * Tout est calculé localement à partir des éléments déjà déchiffrés. Aucun
 * mot de passe, aucune URL et aucun identifiant ne quitte l’appareil. Les
 * résultats ne contiennent que des références d’éléments et des compteurs.
 */

import { estimateEntropy } from './crypto'
import type { LoginItem, VaultItem } from './types'

const WEAK_ENTROPY = 50
const STRONG_ENTROPY = 70
const STRONG_LENGTH = 16
const OLD_DAYS = 365

export interface ReusedPasswordGroup {
  items: VaultItem[]
}

export interface SimilarPasswordGroup {
  items: VaultItem[]
}

export interface DuplicateUrlGroup {
  url: string
  items: VaultItem[]
}

export interface SecurityReport {
  /** Nombre de connexions actives analysées. */
  total: number
  score: number
  scoreLabel: string
  weak: VaultItem[]
  reused: ReusedPasswordGroup[]
  similar: SimilarPasswordGroup[]
  old: VaultItem[]
  no2fa: VaultItem[]
  duplicates: DuplicateUrlGroup[]
  incomplete: VaultItem[]
  strongCount: number
  mediumCount: number
  /** Nombre d’éléments concernés par au moins un problème. */
  affected: number
  /** Identifiants des éléments concernés, pour les badges de liste. */
  issueIds: string[]
}

function activeLogins(items: VaultItem[]): LoginItem[] {
  return items.filter(
    (item): item is LoginItem => item.type === 'login' && !item.deletedAt,
  )
}

function oldEnough(item: VaultItem, now: number): boolean {
  const timestamp = Date.parse(item.updatedAt)
  if (!Number.isFinite(timestamp)) return false
  return now - timestamp > OLD_DAYS * 24 * 60 * 60 * 1000
}

function normalizeUrl(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`.toLowerCase()
  } catch {
    return ''
  }
}

function passwordWords(item: LoginItem): string[] {
  return [item.title, item.username]
    .join(' ')
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length >= 4)
}

/**
 * Explique pourquoi un mot de passe est faible. `null` pour un mot de passe
 * absent : le problème est alors classé dans « connexion incomplète ».
 */
export function weakPasswordReason(item: LoginItem): string | null {
  if (!item.password) return null
  const reasons: string[] = []
  if (item.password.length < 12) reasons.push('moins de 12 caractères')
  if (estimateEntropy(item.password) < WEAK_ENTROPY) reasons.push('entropie faible')
  const lower = item.password.toLowerCase()
  if (passwordWords(item).some((word) => lower.includes(word))) {
    reasons.push('contient le titre ou l’identifiant')
  }
  return reasons.length > 0 ? reasons.join(' · ') : null
}

/** Explique les champs manquants d’une connexion. */
export function incompleteReason(item: LoginItem): string {
  const reasons: string[] = []
  if (!item.password.trim()) reasons.push('mot de passe absent')
  if (!item.username.trim()) reasons.push('identifiant absent')
  if (!item.urls.some((url) => url.trim())) reasons.push('URL absente')
  return reasons.join(' · ')
}

export function securityLabel(score: number): string {
  if (score >= 90) return 'Excellent'
  if (score >= 75) return 'Bon'
  if (score >= 50) return 'À améliorer'
  return 'Critique'
}

function passwordBase(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Analyse les connexions actives. Les notes, cartes, identités et éléments en
 * corbeille ne sont pas inclus : ils n’ont pas de mot de passe à évaluer.
 */
export function analyzeSecurity(items: VaultItem[], now = Date.now()): SecurityReport {
  const logins = activeLogins(items)
  const total = logins.length

  const weak = logins.filter((item) => weakPasswordReason(item) !== null)

  const byPassword = new Map<string, VaultItem[]>()
  for (const item of logins) {
    if (!item.password) continue
    const group = byPassword.get(item.password)
    if (group) group.push(item)
    else byPassword.set(item.password, [item])
  }
  const reused = Array.from(byPassword.values())
    .filter((group) => group.length > 1)
    .map((group) => ({ items: group }))
    .sort((a, b) => b.items.length - a.items.length)

  const byBase = new Map<string, VaultItem[]>()
  for (const item of logins) {
    if (!item.password) continue
    const base = passwordBase(item.password)
    if (base.length < 6) continue
    const group = byBase.get(base)
    if (group) group.push(item)
    else byBase.set(base, [item])
  }
  const similar = Array.from(byBase.values())
    .filter((group) => {
      if (group.length < 2) return false
      return new Set(group.map((item) => (item as LoginItem).password)).size > 1
    })
    .map((group) => ({ items: group }))
    .sort((a, b) => b.items.length - a.items.length)

  const old = logins.filter((item) => oldEnough(item, now))
  const no2fa = logins.filter((item) => item.password.length > 0 && !item.totp.trim())
  const incomplete = logins.filter((item) => incompleteReason(item) !== '')

  const byUrl = new Map<string, VaultItem[]>()
  for (const item of logins) {
    for (const raw of item.urls) {
      const url = normalizeUrl(raw)
      if (!url) continue
      const group = byUrl.get(url)
      if (group) group.push(item)
      else byUrl.set(url, [item])
    }
  }
  const duplicates = Array.from(byUrl.entries())
    .filter(([, group]) => new Set(group.map((item) => item.id)).size > 1)
    .map(([url, group]) => ({
      url,
      items: Array.from(new Map(group.map((item) => [item.id, item])).values()),
    }))
    .sort((a, b) => b.items.length - a.items.length)

  const affectedIds = new Set<string>()
  for (const item of [...weak, ...old, ...no2fa, ...incomplete]) affectedIds.add(item.id)
  for (const group of reused) for (const item of group.items) affectedIds.add(item.id)
  for (const group of similar) for (const item of group.items) affectedIds.add(item.id)
  for (const group of duplicates) for (const item of group.items) affectedIds.add(item.id)

  const reusedIds = new Set(reused.flatMap((group) => group.items.map((item) => item.id)))
  const similarIds = new Set(similar.flatMap((group) => group.items.map((item) => item.id)))
  const duplicateIds = new Set(
    duplicates.flatMap((group) => group.items.map((item) => item.id)),
  )

  const strong = logins.filter(
    (item) =>
      item.password.length >= STRONG_LENGTH &&
      estimateEntropy(item.password) >= STRONG_ENTROPY &&
      weakPasswordReason(item) === null,
  )
  const strongIds = new Set(strong.map((item) => item.id))
  const medium = logins.filter(
    (item) =>
      item.password.length > 0 &&
      weakPasswordReason(item) === null &&
      !strongIds.has(item.id),
  )

  let score = 100
  if (total > 0) {
    score -= (weak.length / total) * 35
    score -= (reusedIds.size / total) * 25
    score -= (no2fa.length / total) * 15
    score -= (old.length / total) * 10
    score -= (duplicateIds.size / total) * 10
    score -= (incomplete.length / total) * 5
    score -= (similarIds.size / total) * 5
  }
  const rounded = Math.max(0, Math.min(100, Math.round(score)))

  return {
    total,
    score: rounded,
    scoreLabel: securityLabel(rounded),
    weak,
    reused,
    similar,
    old,
    no2fa,
    duplicates,
    incomplete,
    strongCount: strong.length,
    mediumCount: medium.length,
    affected: affectedIds.size,
    issueIds: [...affectedIds],
  }
}

export function securityTone(score: number): 'good' | 'warning' | 'danger' {
  if (score >= 80) return 'good'
  if (score >= 50) return 'warning'
  return 'danger'
}
