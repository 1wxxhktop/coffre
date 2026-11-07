import { describe, expect, it } from 'vitest'
import { applyUsage, MAX_USAGE_ENTRIES, parseUsage } from './usage'

describe('historique d’utilisation', () => {
  it('ajoute puis rafraîchit un élément', () => {
    const first = applyUsage({}, 'a', 1_000)
    expect(first).toEqual({ a: 1_000 })

    const second = applyUsage(first, 'a', 2_000)
    expect(second).toEqual({ a: 2_000 })
  })

  it('élague les entrées les plus anciennes', () => {
    const usage: Record<string, number> = {}
    for (let index = 0; index < MAX_USAGE_ENTRIES; index += 1) {
      usage[`id-${index}`] = index + 1
    }

    const next = applyUsage(usage, 'nouveau', MAX_USAGE_ENTRIES + 1)
    expect(Object.keys(next)).toHaveLength(MAX_USAGE_ENTRIES)
    expect(next.nouveau).toBe(MAX_USAGE_ENTRIES + 1)
    expect(next['id-0']).toBeUndefined()
  })

  it('ignore les valeurs corrompues', () => {
    expect(parseUsage(null)).toEqual({})
    expect(parseUsage('pas du json')).toEqual({})
    expect(parseUsage('[]')).toEqual({})
    expect(parseUsage(JSON.stringify({ a: 10, b: 'x', c: -1, d: 0 }))).toEqual({
      a: 10,
    })
  })
})
