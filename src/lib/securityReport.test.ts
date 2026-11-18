import { describe, expect, it } from 'vitest'
import type { SecurityReport } from './security'
import { buildSecurityReportExport } from './securityReport'
import type { SecuritySnapshot } from './securityHistory'
import type { VaultItem } from './types'

function items(count: number): VaultItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `secret-${index}`,
    title: `Titre secret ${index}`,
    username: `utilisateur-${index}`,
  })) as VaultItem[]
}

function report(overrides: Partial<SecurityReport> = {}): SecurityReport {
  return {
    total: 12,
    score: 68,
    scoreLabel: 'Moyen',
    scoreReason: '',
    weak: items(2),
    reused: [{ items: items(3) }],
    similar: [],
    old: items(1),
    no2fa: items(2),
    passkeyAvailable: items(1),
    noHttps: [],
    duplicates: [],
    incomplete: items(1),
    breached: items(1),
    strongCount: 7,
    mediumCount: 3,
    affected: 6,
    weakOrReusedCount: 4,
    issueIds: [],
    ...overrides,
  }
}

const history: SecuritySnapshot[] = [
  { date: '2026-11-01', score: 60, total: 10, weak: 3, reused: 2, no2fa: 2, affected: 5 },
  { date: '2026-11-02', score: 68, total: 12, weak: 2, reused: 3, no2fa: 2, affected: 6 },
]

describe('export du rapport de sécurité', () => {
  it('agrège les compteurs sans aucune donnée nominative', () => {
    const payload = buildSecurityReportExport(
      report(),
      history,
      new Date('2026-11-18T10:00:00.000Z'),
    )
    expect(payload.format).toBe('coffre-security-report')
    expect(payload.version).toBe(1)
    expect(payload.generatedAt).toBe('2026-11-18T10:00:00.000Z')
    expect(payload.score).toEqual({
      value: 68,
      total: 12,
      affected: 6,
      strong: 7,
      medium: 3,
      weak: 2,
    })
    expect(payload.counts).toEqual({
      breached: 1,
      reused: 3,
      weak: 2,
      no2fa: 2,
      noHttps: 0,
      old: 1,
      similar: 0,
      duplicates: 0,
      incomplete: 1,
      passkey: 1,
    })
    expect(payload.actions[0]).toEqual({
      category: 'breached',
      count: 1,
      tone: 'critical',
    })
    expect(payload.history).toEqual([
      { date: '2026-11-01', score: 60 },
      { date: '2026-11-02', score: 68 },
    ])
    expect(JSON.stringify(payload)).not.toContain('Titre secret')
    expect(JSON.stringify(payload)).not.toContain('utilisateur-')
    expect(JSON.stringify(payload)).not.toContain('secret-')
  })
})
