/**
 * Export du rapport de sécurité.
 *
 * Le fichier ne contient que des scores, des dates et des compteurs. Aucun
 * titre d’élément, identifiant, nom d’utilisateur, URL ou secret n’est inclus.
 */

import type { SecurityReport } from './security'
import { securityActions } from './securityPlan'
import type { SecuritySnapshot } from './securityHistory'

export interface SecurityReportExport {
  format: 'coffre-security-report'
  version: 1
  generatedAt: string
  score: {
    value: number
    total: number
    affected: number
    strong: number
    medium: number
    weak: number
  }
  counts: {
    breached: number
    reused: number
    weak: number
    no2fa: number
    noHttps: number
    old: number
    similar: number
    duplicates: number
    incomplete: number
    passkey: number
  }
  actions: Array<{
    category: string
    count: number
    tone: string
  }>
  history: Array<{ date: string; score: number }>
}

function groupCount(groups: Array<{ items: unknown[] }>): number {
  return groups.reduce((total, group) => total + group.items.length, 0)
}

/** Construit le JSON exportable, sans aucune donnée nominative. */
export function buildSecurityReportExport(
  report: SecurityReport,
  history: SecuritySnapshot[],
  now: Date = new Date(),
): SecurityReportExport {
  return {
    format: 'coffre-security-report',
    version: 1,
    generatedAt: now.toISOString(),
    score: {
      value: report.score,
      total: report.total,
      affected: report.affected,
      strong: report.strongCount,
      medium: report.mediumCount,
      weak: report.weak.length,
    },
    counts: {
      breached: report.breached.length,
      reused: groupCount(report.reused),
      weak: report.weak.length,
      no2fa: report.no2fa.length,
      noHttps: report.noHttps.length,
      old: report.old.length,
      similar: groupCount(report.similar),
      duplicates: groupCount(report.duplicates),
      incomplete: report.incomplete.length,
      passkey: report.passkeyAvailable.length,
    },
    actions: securityActions(report).map((action) => ({
      category: action.category,
      count: action.count,
      tone: action.tone,
    })),
    history: history.slice(-90).map((snapshot) => ({
      date: snapshot.date,
      score: snapshot.score,
    })),
  }
}
