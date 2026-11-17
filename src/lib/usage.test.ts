import { describe, expect, it } from 'vitest'
import {
  applyUsage,
  MAX_USAGE_ENTRIES,
  parseUsage,
  usageCount,
  usageTimestamp,
} from './usage'

describe('historique d’utilisation', () => {
  it('ajoute puis incrémente le compteur d’un élément', () => {
    const first = applyUsage({}, 'a', 1_000)
    expect(first.a).toEqual({ count: 1, lastUsedAt: 1_000 })
    expect(usageCount(first, 'a')).toBe(1)
    expect(usageTimestamp(first, 'a')).toBe(1_000)

    const second = applyUsage(first, 'a', 2_000)
    expect(second.a).toEqual({ count: 2, lastUsedAt: 2_000 })
    expect(usageCount(second, 'a')).toBe(2)
  })

  it('élague les entrées les moins récemment utilisées', () => {
    const usage: Record<string, { count: number; lastUsedAt: number }> = {}
    for (let index = 0; index < MAX_USAGE_ENTRIES; index += 1) {
      usage[`id-${index}`] = { count: 1, lastUsedAt: index + 1 }
    }

    const next = applyUsage(usage, 'nouveau', MAX_USAGE_ENTRIES + 1)
    expect(Object.keys(next)).toHaveLength(MAX_USAGE_ENTRIES)
    expect(next.nouveau).toEqual({
      count: 1,
      lastUsedAt: MAX_USAGE_ENTRIES + 1,
    })
    expect(next['id-0']).toBeUndefined()
  })

  it('migre l’ancien format horodaté en une utilisation unique', () => {
    expect(parseUsage(JSON.stringify({ a: 10, b: 20 }))).toEqual({
      b: { count: 1, lastUsedAt: 20 },
      a: { count: 1, lastUsedAt: 10 },
    })
  })

  it('ignore les valeurs corrompues', () => {
    expect(parseUsage(null)).toEqual({})
    expect(parseUsage('pas du json')).toEqual({})
    expect(parseUsage('[]')).toEqual({})
    expect(
      parseUsage(
        JSON.stringify({
          valid: { count: 3, lastUsedAt: 10 },
          zero: { count: 0, lastUsedAt: 10 },
          negatif: { count: -1, lastUsedAt: 10 },
          sansDate: { count: 2 },
          dateInvalide: { count: 2, lastUsedAt: -1 },
          chaîne: 'x',
        }),
      ),
    ).toEqual({ valid: { count: 3, lastUsedAt: 10 } })
  })
})
