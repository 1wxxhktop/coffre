import { describe, expect, it } from 'vitest'
import { BADGE_PENDING, badgeText } from '../../extension/badge'

describe('badge de l’extension', () => {
  it('donne priorité à une proposition d’enregistrement', () => {
    expect(badgeText(1, 4, true)).toBe(BADGE_PENDING)
    expect(badgeText(2, 0, false)).toBe(BADGE_PENDING)
  })

  it('affiche le nombre de connexions du site autorisé', () => {
    expect(badgeText(0, 2, true)).toBe('2')
    expect(badgeText(0, 100, true)).toBe('99+')
  })

  it('reste vide sans autorisation ou sans connexion', () => {
    expect(badgeText(0, 3, false)).toBe('')
    expect(badgeText(0, 0, true)).toBe('')
  })
})
