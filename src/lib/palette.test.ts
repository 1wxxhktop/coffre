import { describe, expect, it } from 'vitest'
import { moveEntry, quickAccessItems, searchPalette, type PaletteAction } from './palette'
import type { LoginItem, VaultItem } from './types'

const NOW = '2026-01-01T00:00:00.000Z'

function login(id: string, title: string, overrides: Partial<LoginItem> = {}): LoginItem {
  return {
    id,
    vaultId: 'v1',
    type: 'login',
    title,
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: NOW,
    updatedAt: NOW,
    username: '',
    password: '',
    urls: [],
    totp: '',
    ...overrides,
  }
}

const ACTIONS: PaletteAction[] = [
  { id: 'new', label: 'Nouvel élément', keywords: 'creer ajouter' },
  { id: 'lock', label: 'Verrouiller le coffre', keywords: 'lock' },
  { id: 'settings', label: 'Réglages', keywords: 'settings preferences' },
]

const ITEMS: VaultItem[] = [
  login('a', 'Banque Postale', { username: 'ada@exemple.fr' }),
  login('b', 'GitHub', { username: 'ada', urls: ['https://github.com'] }),
  login('c', 'Ma banque en ligne', { password: 'secret-github' }),
  login('d', 'Ancien compte', { deletedAt: NOW }),
  login('e', 'Impôts', { notes: 'banque', customFields: [
    { id: 'f1', label: 'Code', value: 'banque', type: 'hidden' },
  ] }),
]

describe('palette de commandes', () => {
  it('sans requête : toutes les actions et les éléments utilisés récemment', () => {
    const result = searchPalette('', ACTIONS, ITEMS, { b: 20, a: 10, d: 30 })
    expect(result.actions).toHaveLength(3)
    // « d » est en corbeille : ignoré même s’il est le plus récent.
    expect(result.items.map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('ignore les accents et la casse', () => {
    expect(searchPalette('reglages', ACTIONS, ITEMS, {}).actions.map((a) => a.id)).toEqual([
      'settings',
    ])
    expect(searchPalette('IMPOTS', ACTIONS, ITEMS, {}).items.map((i) => i.id)).toEqual(['e'])
  })

  it('reconnaît les mots-clés d’une action', () => {
    expect(searchPalette('lock', ACTIONS, ITEMS, {}).actions.map((a) => a.id)).toEqual(['lock'])
  })

  it('classe d’abord les titres qui commencent par la requête', () => {
    expect(searchPalette('banque', ACTIONS, ITEMS, {}).items.map((i) => i.id)).toEqual([
      'a',
      'c',
    ])
  })

  it('cherche dans l’identifiant et l’adresse, jamais dans les secrets', () => {
    expect(searchPalette('ada@exemple', ACTIONS, ITEMS, {}).items.map((i) => i.id)).toEqual(['a'])
    expect(searchPalette('github.com', ACTIONS, ITEMS, {}).items.map((i) => i.id)).toEqual(['b'])
    // « secret-github » est un mot de passe ; « banque » est dans des notes
    // et un champ masqué : aucun des deux ne doit faire remonter l’élément.
    expect(searchPalette('secret-github', ACTIONS, ITEMS, {}).items).toEqual([])
    expect(
      searchPalette('banque', ACTIONS, ITEMS, {}).items.some((item) => item.id === 'e'),
    ).toBe(false)
  })

  it('exige tous les mots de la requête', () => {
    expect(searchPalette('banque ligne', ACTIONS, ITEMS, {}).items.map((i) => i.id)).toEqual(['c'])
    expect(searchPalette('banque zzz', ACTIONS, ITEMS, {}).items).toEqual([])
  })
})

describe('accès rapide', () => {
  it('garde les éléments utilisés, du plus récent au plus ancien', () => {
    expect(
      quickAccessItems(ITEMS, { a: 5, c: 50, b: 20, d: 99 }, 2).map((item) => item.id),
    ).toEqual(['c', 'b'])
    expect(quickAccessItems(ITEMS, {})).toEqual([])
  })
})

describe('déplacement d’un champ', () => {
  it('déplace sans modifier le tableau d’origine', () => {
    const list = ['a', 'b', 'c', 'd']
    expect(moveEntry(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveEntry(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })

  it('renvoie le même tableau pour un déplacement impossible', () => {
    const list = ['a', 'b']
    expect(moveEntry(list, 0, 0)).toBe(list)
    expect(moveEntry(list, -1, 1)).toBe(list)
    expect(moveEntry(list, 1, 2)).toBe(list)
  })
})
