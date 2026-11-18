/**
 * Plan d’action du tableau de bord Sécurité.
 *
 * Les actions sont triées par urgence : une fuite connue passe avant un mot de
 * passe faible, qui passe avant une simple opportunité de passkey. Le plan ne
 * contient que des catégories et des compteurs, jamais de secret.
 */

import type { SecurityCategory, SecurityReport } from './security'

export type SecurityActionTone =
  | 'critical'
  | 'warning'
  | 'info'
  | 'opportunity'

export interface SecurityAction {
  category: SecurityCategory
  count: number
  tone: SecurityActionTone
  /** Plus grand = plus urgent. */
  priority: number
}

function groupCount(groups: Array<{ items: unknown[] }>): number {
  return groups.reduce((total, group) => total + group.items.length, 0)
}

/** Actions non vides, de la plus urgente à la plus secondaire. */
export function securityActions(report: SecurityReport): SecurityAction[] {
  const actions: SecurityAction[] = [
    {
      category: 'breached',
      count: report.breached.length,
      tone: 'critical',
      priority: 100,
    },
    {
      category: 'reused',
      count: groupCount(report.reused),
      tone: 'critical',
      priority: 90,
    },
    {
      category: 'weak',
      count: report.weak.length,
      tone: 'critical',
      priority: 80,
    },
    {
      category: 'no2fa',
      count: report.no2fa.length,
      tone: 'warning',
      priority: 70,
    },
    {
      category: 'noHttps',
      count: report.noHttps.length,
      tone: 'warning',
      priority: 60,
    },
    {
      category: 'old',
      count: report.old.length,
      tone: 'warning',
      priority: 50,
    },
    {
      category: 'similar',
      count: groupCount(report.similar),
      tone: 'info',
      priority: 40,
    },
    {
      category: 'duplicates',
      count: groupCount(report.duplicates),
      tone: 'info',
      priority: 30,
    },
    {
      category: 'incomplete',
      count: report.incomplete.length,
      tone: 'info',
      priority: 20,
    },
    {
      category: 'passkey',
      count: report.passkeyAvailable.length,
      tone: 'opportunity',
      priority: 10,
    },
  ]

  return actions
    .filter((action) => action.count > 0)
    .sort((left, right) => right.priority - left.priority)
}
