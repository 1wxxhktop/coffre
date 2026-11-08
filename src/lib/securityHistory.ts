/**
 * Historique local du score de santé.
 *
 * Une seule mesure par jour est conservée dans `localStorage` : date, score et
 * quelques compteurs. Aucun mot de passe, aucune URL et aucun identifiant n’y
 * figure. L’historique est plafonné à un an et peut être effacé depuis les
 * réglages.
 */

import type { SecurityReport } from './security'

const HISTORY_KEY = 'coffre:security-history:v1'
export const MAX_SECURITY_HISTORY_DAYS = 365

export interface SecuritySnapshot {
  /** Date locale AAAA-MM-JJ. */
  date: string
  score: number
  total: number
  weak: number
  reused: number
  no2fa: number
  affected: number
}

function dateStamp(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseSnapshot(value: unknown): SecuritySnapshot | null {
  const record = asRecord(value)
  if (!record) return null
  if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    return null
  }
  const numbers = ['score', 'total', 'weak', 'reused', 'no2fa', 'affected'] as const
  const parsed = { date: record.date } as SecuritySnapshot
  for (const key of numbers) {
    const number = Number(record[key])
    if (!Number.isFinite(number) || number < 0) return null
    parsed[key] = Math.round(number)
  }
  if (parsed.score > 100) parsed.score = 100
  return parsed
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Charge l’historique, du plus ancien au plus récent. */
export function loadSecurityHistory(): SecuritySnapshot[] {
  const store = storage()
  if (!store) return []
  try {
    const raw = store.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(parseSnapshot)
      .filter((entry): entry is SecuritySnapshot => entry !== null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-MAX_SECURITY_HISTORY_DAYS)
  } catch {
    return []
  }
}

function saveSecurityHistory(history: SecuritySnapshot[]): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_SECURITY_HISTORY_DAYS)))
  } catch {
    // Le stockage local peut être indisponible ; le graphique reste optionnel.
  }
}

/**
 * Enregistre la mesure du jour. Si une mesure existe déjà pour aujourd’hui,
 * elle est remplacée : le graphique garde le dernier score de la journée.
 */
export function recordSecuritySnapshot(
  report: SecurityReport,
  now: Date = new Date(),
): SecuritySnapshot[] {
  const history = loadSecurityHistory()
  if (report.total === 0) return history

  const snapshot: SecuritySnapshot = {
    date: dateStamp(now),
    score: report.score,
    total: report.total,
    weak: report.weak.length,
    reused: report.reused.reduce((total, group) => total + group.items.length, 0),
    no2fa: report.no2fa.length,
    affected: report.affected,
  }

  const last = history[history.length - 1]
  const next =
    last?.date === snapshot.date
      ? [...history.slice(0, -1), snapshot]
      : [...history, snapshot]
  saveSecurityHistory(next)
  return next
}

/** Efface l’historique local du score. */
export function clearSecurityHistory(): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(HISTORY_KEY)
  } catch {
    // Rien à faire.
  }
}

export interface SecurityHistorySummary {
  first: SecuritySnapshot
  last: SecuritySnapshot
  min: SecuritySnapshot
  max: SecuritySnapshot
  delta: number
}

/** Résumé pour l’affichage et l’accessibilité du graphique. */
export function summarizeSecurityHistory(
  history: SecuritySnapshot[],
): SecurityHistorySummary | null {
  if (history.length === 0) return null
  let min = history[0]
  let max = history[0]
  for (const snapshot of history) {
    if (snapshot.score < min.score) min = snapshot
    if (snapshot.score > max.score) max = snapshot
  }
  const first = history[0]
  const last = history[history.length - 1]
  return { first, last, min, max, delta: last.score - first.score }
}
