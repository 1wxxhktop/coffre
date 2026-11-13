import { describe, expect, it } from 'vitest'
import { nextTabIndex } from './rovingTabs'

describe('nextTabIndex', () => {
  it('ignore les touches qui ne déplacent pas le focus', () => {
    for (const key of ['Enter', ' ', 'Tab', 'Escape', 'a']) {
      expect(nextTabIndex(key, 0, 2)).toBeNull()
    }
  })

  it('avance et recule avec bouclage', () => {
    expect(nextTabIndex('ArrowRight', 0, 2)).toBe(1)
    expect(nextTabIndex('ArrowRight', 1, 2)).toBe(0)
    expect(nextTabIndex('ArrowLeft', 0, 2)).toBe(1)
    expect(nextTabIndex('ArrowLeft', 1, 2)).toBe(0)
    expect(nextTabIndex('ArrowDown', 0, 3)).toBe(1)
    expect(nextTabIndex('ArrowUp', 0, 3)).toBe(2)
  })

  it('va au premier ou au dernier avec Home et End', () => {
    expect(nextTabIndex('Home', 2, 3)).toBe(0)
    expect(nextTabIndex('End', 0, 3)).toBe(2)
  })

  it('démarre correctement quand aucun onglet n’a le focus', () => {
    expect(nextTabIndex('ArrowRight', -1, 3)).toBe(0)
    expect(nextTabIndex('ArrowLeft', -1, 3)).toBe(2)
  })

  it('ne renvoie rien pour un groupe vide', () => {
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull()
  })
})
