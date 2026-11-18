import { describe, expect, it } from 'vitest'
import type { SecurityReport } from './security'
import { securityActions } from './securityPlan'
import type { VaultItem } from './types'

function items(count: number): VaultItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `i${index}`,
  })) as VaultItem[]
}

function report(overrides: Partial<SecurityReport> = {}): SecurityReport {
  return {
    total: 10,
    score: 60,
    scoreLabel: '',
    scoreReason: '',
    weak: [],
    reused: [],
    similar: [],
    old: [],
    no2fa: [],
    passkeyAvailable: [],
    noHttps: [],
    duplicates: [],
    incomplete: [],
    breached: [],
    strongCount: 5,
    mediumCount: 3,
    affected: 0,
    weakOrReusedCount: 0,
    issueIds: [],
    ...overrides,
  }
}

describe('plan d’action de sécurité', () => {
  it('trie les actions de la plus urgente à la plus secondaire', () => {
    const actions = securityActions(
      report({
        breached: items(2),
        reused: [{ items: items(2) }],
        weak: items(1),
        no2fa: items(1),
        noHttps: items(1),
        old: items(1),
        similar: [{ items: items(1) }],
        duplicates: [{ url: 'example.com', items: items(2) }],
        incomplete: items(1),
        passkeyAvailable: items(1),
      }),
    )

    expect(actions.map((action) => action.category)).toEqual([
      'breached',
      'reused',
      'weak',
      'no2fa',
      'noHttps',
      'old',
      'similar',
      'duplicates',
      'incomplete',
      'passkey',
    ])
    expect(actions.find((action) => action.category === 'reused')?.count).toBe(2)
    expect(actions.find((action) => action.category === 'duplicates')?.count).toBe(2)
    expect(actions.find((action) => action.category === 'breached')?.tone).toBe(
      'critical',
    )
    expect(actions.find((action) => action.category === 'passkey')?.tone).toBe(
      'opportunity',
    )
  })

  it('ne propose aucune action quand le rapport est vide', () => {
    expect(securityActions(report())).toEqual([])
  })
})
