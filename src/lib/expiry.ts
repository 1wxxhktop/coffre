/**
 * Échéances des éléments.
 *
 * Les dates sont stockées dans le contenu chiffré de chaque élément. Le calcul
 * est purement local : aucune date, aucun titre et aucun identifiant ne quitte
 * l’appareil.
 */

import type { VaultItem } from './types'

/** Fenêtre pendant laquelle une échéance est signalée comme proche. */
export const EXPIRY_HORIZON_DAYS = 60

/** Seuil à partir duquel le badge passe en ton d’avertissement. */
export const EXPIRY_WARNING_DAYS = 30

export type ExpiryKind = 'card' | 'passport' | 'id-card' | 'license' | 'item'

export interface ExpiryEvent {
  item: VaultItem
  /** Date d’échéance au format AAAA-MM-JJ. */
  date: string
  /** Libellé du document ou du rappel. */
  label: string
  kind: ExpiryKind
  /** Jours restants (négatif si l’échéance est passée). */
  daysLeft: number
}

export interface ExpiryCandidate {
  date: string
  label: string
  kind: ExpiryKind
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Analyse une date locale AAAA-MM-JJ sans décalage de fuseau horaire. */
export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

/** Convertit une date locale en AAAA-MM-JJ. */
export function dateOnly(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Normalise une date saisie ; renvoie une chaîne vide si elle est invalide. */
export function normalizeDateOnly(value: string): string {
  const date = parseDateOnly(value)
  return date ? dateOnly(date) : ''
}

/** Dernier jour du mois d’expiration d’une carte (MM/AA ou MM/AAAA). */
export function cardExpiryDate(value: string): Date | null {
  const match = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(value.trim())
  if (!match) return null
  const month = Number(match[1])
  const rawYear = Number(match[2])
  const year = rawYear < 100 ? 2000 + rawYear : rawYear
  if (month < 1 || month > 12) return null
  // Le jour 0 du mois suivant correspond au dernier jour du mois visé.
  return new Date(year, month, 0)
}

function startOfDay(now: number | Date): Date {
  const date = now instanceof Date ? now : new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Nombre de jours calendaires entre aujourd’hui et une date. */
export function daysUntil(date: Date, now: number | Date = Date.now()): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS)
}

/** Toutes les échéances déclarées par un élément, même lointaines. */
export function itemExpiryCandidates(item: VaultItem): ExpiryCandidate[] {
  const candidates: ExpiryCandidate[] = []

  if (item.expiresAt) {
    const date = parseDateOnly(item.expiresAt)
    if (date) {
      candidates.push({
        date: dateOnly(date),
        label: item.type === 'login' ? 'Mot de passe à changer' : 'Échéance',
        kind: 'item',
      })
    }
  }

  if (item.type === 'card') {
    const date = cardExpiryDate(item.expiry)
    if (date) {
      candidates.push({
        date: dateOnly(date),
        label: 'Carte bancaire',
        kind: 'card',
      })
    }
  }

  if (item.type === 'identity') {
    const documents: Array<[string, string, ExpiryKind]> = [
      [item.passportExpiry, 'Passeport', 'passport'],
      [item.idCardExpiry, 'Carte d’identité', 'id-card'],
      [item.licenseExpiry, 'Permis de conduire', 'license'],
    ]
    for (const [value, label, kind] of documents) {
      const date = parseDateOnly(value)
      if (date) candidates.push({ date: dateOnly(date), label, kind })
    }
  }

  return candidates
}

/** Échéance la plus proche d’un élément, sans limite d’horizon. */
export function nextExpiry(item: VaultItem, now: number | Date = Date.now()): ExpiryEvent | null {
  let nearest: ExpiryEvent | null = null
  for (const candidate of itemExpiryCandidates(item)) {
    const date = parseDateOnly(candidate.date)
    if (!date) continue
    const event: ExpiryEvent = {
      ...candidate,
      item,
      daysLeft: daysUntil(date, now),
    }
    if (!nearest || event.date < nearest.date) nearest = event
  }
  return nearest
}

/**
 * Échéances passées ou proches, triées de la plus urgente à la plus lointaine.
 * Les éléments en corbeille sont ignorés.
 */
export function collectExpiries(
  items: VaultItem[],
  now: number | Date = Date.now(),
  horizonDays = EXPIRY_HORIZON_DAYS,
): ExpiryEvent[] {
  const events: ExpiryEvent[] = []
  for (const item of items) {
    if (item.deletedAt) continue
    for (const candidate of itemExpiryCandidates(item)) {
      const date = parseDateOnly(candidate.date)
      if (!date) continue
      const daysLeft = daysUntil(date, now)
      if (daysLeft > horizonDays) continue
      events.push({ ...candidate, item, daysLeft })
    }
  }

  return events.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return a.item.title.localeCompare(b.item.title, 'fr', { sensitivity: 'base' })
  })
}

/** Libellé court affiché dans la liste : « J-12 », « Aujourd’hui », « Expiré ». */
export function expiryBadgeLabel(daysLeft: number): string {
  if (daysLeft < 0) return 'Expiré'
  if (daysLeft === 0) return "Aujourd’hui"
  return `J-${daysLeft}`
}

/** Explication complète d’une échéance. */
export function expiryDescription(daysLeft: number): string {
  if (daysLeft < 0) {
    const days = Math.abs(daysLeft)
    return `Expiré depuis ${days} jour${days > 1 ? 's' : ''}`
  }
  if (daysLeft === 0) return "Expire aujourd’hui"
  if (daysLeft === 1) return 'Expire demain'
  return `Expire dans ${daysLeft} jours`
}

/** Ton visuel d’une échéance. */
export function expiryTone(daysLeft: number): 'danger' | 'warning' | 'neutral' {
  if (daysLeft < 0) return 'danger'
  if (daysLeft <= EXPIRY_WARNING_DAYS) return 'warning'
  return 'neutral'
}

/** Date lisible en français, sans décalage de fuseau horaire. */
export function formatExpiryDate(value: string): string {
  const date = parseDateOnly(value)
  if (!date) return value || '—'
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/** Date lisible pour une carte (MM/AA). */
export function formatCardExpiry(value: string): string {
  const date = cardExpiryDate(value)
  if (!date) return value || '—'
  return new Intl.DateTimeFormat('fr-FR', {
    month: '2-digit',
    year: '2-digit',
  }).format(date)
}
