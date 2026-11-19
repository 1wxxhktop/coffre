import { describe, expect, it } from 'vitest'
import { estimateEntropy, estimatePasswordBits, passwordStrength } from './strength'

describe('estimation d’entropie', () => {
  it('reste stable sur des mots de passe de référence', () => {
    expect(estimateEntropy('abc123')).toBe(17)
    expect(estimateEntropy('P@ssw0rd2024!')).toBe(25)
    expect(estimateEntropy('Marseille2024')).toBe(17)
    expect(estimateEntropy('correct horse battery staple')).toBe(81)
    expect(estimateEntropy('Très-long-mot-de-passe-aléatoire-42!')).toBe(155)
    expect(estimateEntropy('x7$Kq9!mZ2@pL5#vN8&wR3')).toBe(106)
  })

  it('garde une estimation nulle pour une chaîne vide', () => {
    expect(estimatePasswordBits('')).toBe(0)
  })

  it('classe les paliers de robustesse', () => {
    expect(passwordStrength(20).score).toBe(0)
    expect(passwordStrength(40).score).toBe(1)
    expect(passwordStrength(60).score).toBe(2)
    expect(passwordStrength(80).score).toBe(3)
    expect(passwordStrength(120).score).toBe(4)
  })
})
