/**
 * Analyse de santé du coffre.
 *
 * Tout est calculé localement à partir des éléments déjà déchiffrés. Aucun
 * mot de passe, aucune URL et aucun identifiant ne quitte l’appareil. Les
 * résultats ne contiennent que des références d’éléments et des compteurs.
 */

import { estimateEntropy } from './strength'
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
  /** Explication courte et honnête du score. */
  scoreReason: string
  weak: VaultItem[]
  reused: ReusedPasswordGroup[]
  similar: SimilarPasswordGroup[]
  old: VaultItem[]
  no2fa: VaultItem[]
  duplicates: DuplicateUrlGroup[]
  incomplete: VaultItem[]
  /** Connexions dont le mot de passe apparaît dans une fuite connue. */
  breached: VaultItem[]
  strongCount: number
  mediumCount: number
  /** Nombre d’éléments concernés par au moins un problème. */
  affected: number
  /** Connexions faibles ou réutilisées (union, sans doublon). */
  weakOrReusedCount: number
  /** Identifiants des éléments concernés, pour les badges de liste. */
  issueIds: string[]
}

/** Catégories ouvrant une liste filtrée dans la vue principale. */
export type SecurityCategory =
  | 'breached'
  | 'weak'
  | 'reused'
  | 'similar'
  | 'no2fa'
  | 'old'
  | 'incomplete'
  | 'duplicates'

export interface ItemSecurityIssue {
  category: SecurityCategory
  /** Libellé court, affichable dans la liste. */
  label: string
  /** Variante très courte pour les pastilles compactes. */
  shortLabel: string
  /** Explication d’une phrase, pour le détail. */
  description: string
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
  if (estimateEntropy(item.password) < WEAK_ENTROPY) reasons.push('facile à deviner')
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
export function analyzeSecurity(
  items: VaultItem[],
  now = Date.now(),
  breachedIds: ReadonlySet<string> = new Set(),
): SecurityReport {
  const logins = activeLogins(items)
  const total = logins.length

  const breached = logins.filter((item) => breachedIds.has(item.id))
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
  for (const item of [...breached, ...weak, ...old, ...no2fa, ...incomplete]) {
    affectedIds.add(item.id)
  }
  for (const group of reused) for (const item of group.items) affectedIds.add(item.id)
  for (const group of similar) for (const item of group.items) affectedIds.add(item.id)
  for (const group of duplicates) for (const item of group.items) affectedIds.add(item.id)

  const reusedIds = new Set(reused.flatMap((group) => group.items.map((item) => item.id)))
  const weakOrReusedIds = new Set([
    ...weak.map((item) => item.id),
    ...reusedIds,
  ])
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
    score -= (breached.length / total) * 30
    score -= (weak.length / total) * 35
    score -= (reusedIds.size / total) * 25
    score -= (no2fa.length / total) * 15
    score -= (old.length / total) * 10
    score -= (duplicateIds.size / total) * 10
    score -= (incomplete.length / total) * 5
    score -= (similarIds.size / total) * 5

    // Un coffre dont la majorité des connexions sont faibles ou réutilisées ne
    // peut pas afficher un score rassurant : le plafond rend le verdict honnête.
    if (weakOrReusedIds.size > total / 2) {
      score = Math.min(score, 40)
    }
    // Un mot de passe retrouvé dans une fuite ne doit jamais produire un score
    // rassurant, même s’il est long et unique.
    if (breached.length > 0) {
      score = Math.min(score, 60)
    }
  }
  const rounded = Math.max(0, Math.min(100, Math.round(score)))

  const scoreReason =
    total === 0
      ? 'Ajoutez une connexion pour commencer l’analyse.'
      : affectedIds.size === 0
        ? 'Aucun problème détecté sur les connexions actives.'
        : weakOrReusedIds.size > 0
          ? `${weakOrReusedIds.size} connexion${
              weakOrReusedIds.size > 1 ? 's' : ''
            } sur ${total} ${weakOrReusedIds.size > 1 ? 'sont' : 'est'} faible${
              weakOrReusedIds.size > 1 ? 's' : ''
            } ou réutilisée${weakOrReusedIds.size > 1 ? 's' : ''}.`
          : `${affectedIds.size} connexion${affectedIds.size > 1 ? 's' : ''} sur ${total} à vérifier.`

  return {
    total,
    score: rounded,
    scoreLabel: securityLabel(rounded),
    scoreReason,
    weak,
    reused,
    similar,
    old,
    no2fa,
    duplicates,
    incomplete,
    breached,
    strongCount: strong.length,
    mediumCount: medium.length,
    affected: affectedIds.size,
    weakOrReusedCount: weakOrReusedIds.size,
    issueIds: [...affectedIds],
  }
}

export function securityTone(score: number): 'good' | 'warning' | 'danger' {
  if (score >= 75) return 'good'
  if (score >= 50) return 'warning'
  return 'danger'
}

/** Déduplique des éléments par identifiant, en conservant l’ordre. */
function uniqueItems(items: VaultItem[]): VaultItem[] {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

/** Définition partagée des catégories du tableau de bord. */
export function securityCategoryItems(
  report: SecurityReport,
  category: SecurityCategory,
): VaultItem[] {
  switch (category) {
    case 'breached':
      return report.breached
    case 'weak':
      return report.weak
    case 'reused':
      return uniqueItems(report.reused.flatMap((group) => group.items))
    case 'similar':
      return uniqueItems(report.similar.flatMap((group) => group.items))
    case 'no2fa':
      return report.no2fa
    case 'old':
      return report.old
    case 'incomplete':
      return report.incomplete
    case 'duplicates':
      return uniqueItems(report.duplicates.flatMap((group) => group.items))
  }
}

export const SECURITY_CATEGORY_LABELS: Record<SecurityCategory, string> = {
  breached: 'Mots de passe compromis',
  weak: 'Mots de passe faibles',
  reused: 'Mots de passe réutilisés',
  similar: 'Variantes proches',
  no2fa: 'Sans double authentification',
  old: 'Non modifiés depuis un an',
  incomplete: 'Connexions incomplètes',
  duplicates: 'Sites en doublon',
}

const ISSUE_DESCRIPTIONS: Record<SecurityCategory, string> = {
  breached:
    'Ce mot de passe apparaît dans une fuite connue. Changez-le immédiatement, surtout s’il est réutilisé ailleurs.',
  weak: 'Ce mot de passe est court ou facile à deviner. Générez-en un nouveau, long et unique.',
  reused: 'Le même mot de passe protège plusieurs comptes. Une fuite sur l’un ouvrirait les autres.',
  similar: 'Ce mot de passe ne diffère que légèrement d’un autre. Les variantes se devinent ensemble.',
  no2fa: 'Aucun code TOTP n’est configuré : le compte dépend uniquement du mot de passe.',
  old: 'Ce mot de passe n’a pas été modifié depuis plus d’un an. Vérifiez s’il a été exposé.',
  incomplete: 'Il manque un identifiant, un mot de passe ou une adresse pour analyser ce compte.',
  duplicates: 'Plusieurs éléments pointent vers le même site. Vérifiez s’il s’agit de comptes distincts.',
}

const ISSUE_LABELS: Record<SecurityCategory, string> = {
  breached: 'Mot de passe compromis',
  weak: 'Mot de passe faible',
  reused: 'Mot de passe réutilisé',
  similar: 'Variante proche',
  no2fa: 'Sans 2FA',
  old: 'Mot de passe ancien',
  incomplete: 'Connexion incomplète',
  duplicates: 'Site en doublon',
}

const ISSUE_SHORT_LABELS: Record<SecurityCategory, string> = {
  breached: 'Compromis',
  weak: 'Faible',
  reused: 'Réutilisé',
  similar: 'Variante',
  no2fa: 'Sans 2FA',
  old: 'Ancien',
  incomplete: 'Incomplet',
  duplicates: 'Doublon',
}

/**
 * Problème le plus important d’un élément, pour la pastille de liste et le
 * bandeau du détail. Les cartes, notes et identités n’ont pas de mot de passe.
 */
export function itemSecurityIssue(
  item: VaultItem,
  report: SecurityReport,
): ItemSecurityIssue | null {
  if (item.type !== 'login' || item.deletedAt) return null
  const order: SecurityCategory[] = [
    'breached',
    'weak',
    'reused',
    'similar',
    'no2fa',
    'old',
    'incomplete',
    'duplicates',
  ]
  for (const category of order) {
    if (securityCategoryItems(report, category).some((candidate) => candidate.id === item.id)) {
      return {
        category,
        label: ISSUE_LABELS[category],
        shortLabel: ISSUE_SHORT_LABELS[category],
        description: ISSUE_DESCRIPTIONS[category],
      }
    }
  }
  return null
}
