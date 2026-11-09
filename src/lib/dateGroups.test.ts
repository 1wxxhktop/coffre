import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dateGroupInfo, groupItemsByDate } from './dateGroups'
import { formatMonthYear } from './settings'

const NOW = new Date(2026, 10, 9, 12, 0, 0) // 9 novembre 2026, heure locale.

describe('regroupement par date', () => {
  it('classe aujourd’hui, hier, la semaine et le mois', () => {
    expect(dateGroupInfo(new Date(2026, 10, 9, 8).toISOString(), NOW)).toMatchObject({
      kind: 'today',
      rank: 0,
    })
    expect(dateGroupInfo(new Date(2026, 10, 8, 23).toISOString(), NOW)).toMatchObject({
      kind: 'yesterday',
      rank: 1,
    })
    expect(dateGroupInfo(new Date(2026, 10, 6, 10).toISOString(), NOW)).toMatchObject({
      kind: 'week',
      rank: 2,
    })
    expect(dateGroupInfo(new Date(2026, 10, 1, 10).toISOString(), NOW)).toMatchObject({
      kind: 'month',
      rank: 3,
    })
  })

  it('regroupe les dates anciennes par mois', () => {
    const october = dateGroupInfo(new Date(2026, 9, 20, 10).toISOString(), NOW)
    expect(october.kind).toBe('month-year')
    expect(october.key).toBe('month-2026-10')
    expect(october.rank).toBeGreaterThan(3)

    const december = dateGroupInfo(new Date(2025, 11, 20, 10).toISOString(), NOW)
    expect(december.kind).toBe('month-year')
    expect(december.key).toBe('month-2025-12')
    expect(december.rank).toBeGreaterThan(october.rank)
  })

  it('traite les dates futures comme aujourd’hui et les valeurs invalides à part', () => {
    expect(dateGroupInfo(new Date(2026, 10, 10, 10).toISOString(), NOW).kind).toBe('today')
    expect(dateGroupInfo(null, NOW).kind).toBe('unknown')
    expect(dateGroupInfo('pas une date', NOW).kind).toBe('unknown')
    expect(dateGroupInfo(undefined, NOW).rank).toBe(1000)
  })

  it('conserve l’ordre des éléments à l’intérieur des groupes', () => {
    const items = [
      { id: 'today-1', date: new Date(2026, 10, 9, 9).toISOString() },
      { id: 'october', date: new Date(2026, 9, 20, 9).toISOString() },
      { id: 'yesterday', date: new Date(2026, 10, 8, 9).toISOString() },
      { id: 'today-2', date: new Date(2026, 10, 9, 10).toISOString() },
      { id: 'unknown', date: null },
    ]

    const groups = groupItemsByDate(items, (item) => item.date, NOW)
    expect(groups.map((group) => group.kind)).toEqual([
      'today',
      'yesterday',
      'month-year',
      'unknown',
    ])
    expect(groups[0].items.map((item) => item.id)).toEqual(['today-1', 'today-2'])
  })

  it('formate le libellé de mois avec une majuscule', () => {
    const label = formatMonthYear(new Date(2026, 9, 15, 12).toISOString(), 'fr-FR')
    expect(label).toContain('2026')
    expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase())
  })
})

describe('regroupement par date autour d’un changement d’heure', () => {
  // Un jour de changement d’heure dure 23 ou 25 heures : « Hier » et
  // « 7 derniers jours » doivent suivre le calendrier, pas des tranches de 24 h.
  const previousTz = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'Europe/Paris'
  })
  afterAll(() => {
    process.env.TZ = previousTz
  })

  it('reconnaît la veille après le passage à l’heure d’été', () => {
    const now = new Date(2026, 2, 30, 12) // lundi 30 mars : la veille dure 23 h
    expect(dateGroupInfo(new Date(2026, 2, 29, 10).toISOString(), now).kind).toBe('yesterday')
    expect(dateGroupInfo(new Date(2026, 2, 28, 10).toISOString(), now).kind).toBe('week')
  })

  it('reconnaît la veille après le passage à l’heure d’hiver', () => {
    const now = new Date(2026, 9, 26, 12) // lundi 26 octobre : la veille dure 25 h
    expect(dateGroupInfo(new Date(2026, 9, 25, 10).toISOString(), now).kind).toBe('yesterday')
    expect(dateGroupInfo(new Date(2026, 9, 24, 10).toISOString(), now).kind).toBe('week')
  })

  it('arrête « 7 derniers jours » au septième jour calendaire', () => {
    const now = new Date(2026, 2, 31, 12) // la semaine écoulée contient le jour de 23 h
    expect(dateGroupInfo(new Date(2026, 2, 25, 0, 30).toISOString(), now).kind).toBe('week')
    expect(dateGroupInfo(new Date(2026, 2, 24, 23, 30).toISOString(), now).kind).not.toBe('week')
  })
})
