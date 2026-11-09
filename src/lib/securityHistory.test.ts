import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_SECURITY_HISTORY_DAYS,
  clearSecurityHistory,
  loadSecurityHistory,
  mergeSecuritySnapshot,
  recordSecuritySnapshot,
  summarizeSecurityHistory,
} from './securityHistory'
import type { SecurityReport } from './security'
import type { LoginItem } from './types'

const STAMP = '2026-11-08T10:00:00.000Z'

class MemoryStorage {
  #values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  clear(): void {
    this.#values.clear()
  }
}

const storage = new MemoryStorage()

function stamp(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function item(id: string): LoginItem {
  return {
    id,
    vaultId: 'v1',
    type: 'login',
    title: id,
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: STAMP,
    updatedAt: STAMP,
    username: id,
    password: 'secret',
    urls: [],
    totp: '',
  }
}

function report(score: number, weak = 1): SecurityReport {
  return {
    total: 10,
    score,
    scoreLabel: 'Bon',
    scoreReason: 'Résumé',
    weak: Array.from({ length: weak }, (_, index) => item(`weak-${index}`)),
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
    mediumCount: 4,
    affected: weak,
    weakOrReusedCount: weak,
    issueIds: [],
  }
}

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('window', { localStorage: storage })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('historique du score de sécurité', () => {
  it('enregistre une mesure par jour et remplace celle du jour', () => {
    const first = recordSecuritySnapshot(report(40), new Date(2026, 10, 8, 9))
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      date: '2026-11-08',
      scoreVersion: 2,
      score: 40,
      total: 10,
      weak: 1,
      affected: 1,
    })

    const updated = recordSecuritySnapshot(report(62, 2), new Date(2026, 10, 8, 18))
    expect(updated).toHaveLength(1)
    expect(updated[0].score).toBe(62)
    expect(updated[0].weak).toBe(2)

    const nextDay = recordSecuritySnapshot(report(80, 0), new Date(2026, 10, 9, 8))
    expect(nextDay.map((entry) => entry.date)).toEqual(['2026-11-08', '2026-11-09'])
  })

  it('fusionne une mesure sans écrire avant l’enregistrement', () => {
    const history = [
      {
        date: '2026-11-07',
        score: 30,
        total: 10,
        weak: 5,
        reused: 0,
        no2fa: 0,
        affected: 5,
      },
    ]
    const merged = mergeSecuritySnapshot(
      history,
      report(72, 2),
      new Date(2026, 10, 8, 9),
    )
    expect(merged).toHaveLength(2)
    expect(merged[1]).toMatchObject({ date: '2026-11-08', score: 72, weak: 2 })
    // La fusion est pure : l’écriture reste du ressort de recordSecuritySnapshot.
    expect(loadSecurityHistory()).toEqual([])
  })

  it('ignore un coffre sans connexion', () => {
    const empty: SecurityReport = {
      ...report(100, 0),
      total: 0,
      affected: 0,
      strongCount: 0,
      mediumCount: 0,
      weak: [],
    }
    expect(recordSecuritySnapshot(empty, new Date(2026, 10, 8))).toEqual([])
  })

  it('plafonne l’historique à un an', () => {
    for (let day = 0; day < MAX_SECURITY_HISTORY_DAYS + 10; day += 1) {
      recordSecuritySnapshot(
        report(50 + (day % 40)),
        new Date(2026, 0, 1 + day, 12),
      )
    }
    const history = loadSecurityHistory()
    expect(history).toHaveLength(MAX_SECURITY_HISTORY_DAYS)
    expect(history[history.length - 1].date).toBe(
      stamp(new Date(2026, 0, 1 + MAX_SECURITY_HISTORY_DAYS + 9, 12)),
    )
  })

  it('résume les extrêmes et la variation', () => {
    const history = [
      { date: '2026-11-01', score: 30, total: 10, weak: 5, reused: 0, no2fa: 0, affected: 5 },
      { date: '2026-11-02', score: 70, total: 10, weak: 2, reused: 0, no2fa: 0, affected: 2 },
      { date: '2026-11-03', score: 55, total: 10, weak: 3, reused: 0, no2fa: 0, affected: 3 },
    ]
    expect(summarizeSecurityHistory(history)).toMatchObject({
      first: { score: 30 },
      last: { score: 55 },
      min: { score: 30 },
      max: { score: 70 },
      delta: 25,
    })
    expect(summarizeSecurityHistory([])).toBeNull()
  })

  it('annote les mesures antérieures au nouveau calcul', () => {
    storage.setItem(
      'coffre:security-history:v1',
      JSON.stringify([
        {
          date: '2026-11-01',
          score: 50,
          total: 10,
          weak: 2,
          reused: 0,
          no2fa: 0,
          affected: 2,
        },
      ]),
    )
    expect(loadSecurityHistory()[0].scoreVersion).toBe(1)
    const merged = mergeSecuritySnapshot(
      loadSecurityHistory(),
      report(60),
      new Date(2026, 10, 8),
    )
    expect(merged.map((entry) => entry.scoreVersion)).toEqual([1, 2])
  })

  it('résiste à un stockage corrompu et peut être effacé', () => {
    storage.setItem('coffre:security-history:v1', '{pas du json')
    expect(loadSecurityHistory()).toEqual([])

    storage.setItem(
      'coffre:security-history:v1',
      JSON.stringify([
        { date: '2026-11-01', score: 'x' },
        {
          date: '2026-11-02',
          score: 50,
          total: 10,
          weak: 2,
          reused: 0,
          no2fa: 0,
          affected: 2,
        },
      ]),
    )
    expect(loadSecurityHistory()).toHaveLength(1)

    clearSecurityHistory()
    expect(loadSecurityHistory()).toEqual([])
  })
})
