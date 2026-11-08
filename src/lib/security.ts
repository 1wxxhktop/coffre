/**
 * Analyse de santé du coffre.
 *
 * Tout est calculé localement à partir des éléments déjà déchiffrés. Aucun
 * mot de passe, aucune URL et aucun identifiant ne quitte l’appareil. Les
 * résultats ne contiennent que des références d’éléments et des compteurs.
 */

import { estimateEntropy } from './crypto'
import type { VaultItem } from './types'

const WEAK_ENTROPY = 50
const OLD_DAYS = 365

export interface ReusedPasswordGroup {
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
  weak: VaultItem[]
  reused: ReusedPasswordGroup[]
  old: VaultItem[]
  no2fa: VaultItem[]
  duplicates: DuplicateUrlGroup[]
  /** Nombre d’éléments concernés par au moins un problème. */
  affected: number
}

function activeLogins(items: VaultItem[]): Array<Extract<VaultItem, { type: 'login' }>> {
  return items.filter(
    (item): item is Extract<VaultItem, { type: 'login' }> =>
      item.type === 'login' && !item.deletedAt,
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

/**
 * Analyse les connexions actives. Les notes, cartes, identités et éléments en
 * corbeille ne sont pas inclus : ils n’ont pas de mot de passe à évaluer.
 */
export function analyzeSecurity(items: VaultItem[], now = Date.now()): SecurityReport {
  const logins = activeLogins(items)
  const total = logins.length

  const weak = logins.filter(
    (item) => item.password.length < 12 || estimateEntropy(item.password) < WEAK_ENTROPY,
  )

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

  const old = logins.filter((item) => oldEnough(item, now))
  const no2fa = logins.filter((item) => item.password.length > 0 && !item.totp.trim())

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
  for (const item of [...weak, ...old, ...no2fa]) affectedIds.add(item.id)
  for (const group of reused) for (const item of group.items) affectedIds.add(item.id)
  for (const group of duplicates) for (const item of group.items) affectedIds.add(item.id)

  let score = 100
  if (total > 0) {
    score -= (weak.length / total) * 45
    score -= (new Set(reused.flatMap((group) => group.items.map((item) => item.id))).size / total) * 25
    score -= (old.length / total) * 10
    score -= (no2fa.length / total) * 10
    score -= (
      new Set(duplicates.flatMap((group) => group.items.map((item) => item.id))).size / total
    ) * 10
  }

  return {
    total,
    score: Math.max(0, Math.min(100, Math.round(score))),
    weak,
    reused,
    old,
    no2fa,
    duplicates,
    affected: affectedIds.size,
  }
}

export function securityTone(score: number): 'good' | 'warning' | 'danger' {
  if (score >= 80) return 'good'
  if (score >= 50) return 'warning'
  return 'danger'
}
