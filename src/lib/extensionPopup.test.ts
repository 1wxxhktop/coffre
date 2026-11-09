import { describe, expect, it } from 'vitest'
import type { ExtensionLoginSummary } from './extensionProtocol'
import { groupLogins } from '../../extension/popupModel'

function login(
  id: string,
  extra: Partial<ExtensionLoginSummary> = {},
): ExtensionLoginSummary {
  return {
    id,
    title: id,
    username: 'ada',
    host: 'example.com',
    hasTotp: false,
    favorite: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  }
}

const titles = { site: 'Pour ce site', favorites: 'Favoris', recents: 'Récents' }

describe('sections de la popup', () => {
  it('sépare le site, les favoris et les cinq plus récents', () => {
    const site = [login('site')]
    const all = [
      login('site'),
      login('fav', { favorite: true }),
      login('r1', { updatedAt: '2026-03-01T00:00:00.000Z' }),
      login('r2', { updatedAt: '2026-02-01T00:00:00.000Z' }),
    ]
    const groups = groupLogins(site, all, titles)
    expect(groups.map((group) => group.title)).toEqual([
      'Pour ce site',
      'Favoris',
      'Récents',
    ])
    expect(groups[0].entries.map((entry) => entry.id)).toEqual(['site'])
    expect(groups[1].entries.map((entry) => entry.id)).toEqual(['fav'])
    expect(groups[2].entries.map((entry) => entry.id)).toEqual(['r1', 'r2'])
  })

  it('limite les récents à cinq et ignore les doublons', () => {
    const all = Array.from({ length: 8 }, (_, index) =>
      login(`r${index}`, {
        updatedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    )
    const groups = groupLogins([login('site')], [login('site'), ...all], titles)
    expect(groups[2].entries).toHaveLength(5)
    expect(groups[2].entries.map((entry) => entry.id)).toEqual([
      'r7',
      'r6',
      'r5',
      'r4',
      'r3',
    ])
  })

  it('laisse les groupes vides quand le coffre est vide', () => {
    expect(groupLogins([], [], titles)).toEqual([
      { title: 'Pour ce site', entries: [] },
      { title: 'Favoris', entries: [] },
      { title: 'Récents', entries: [] },
    ])
  })
})
