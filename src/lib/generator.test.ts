import { describe, expect, it } from 'vitest'
import {
  generatePassphrase,
  generatePassword,
  generatedEntropy,
  passphraseEntropy,
  wordlistSize,
} from './generator'

describe('générateur de mots de passe', () => {
  it('respecte la longueur et les classes demandées', () => {
    for (const length of [8, 12, 20, 32, 64]) {
      const password = generatePassword({
        length,
        lowercase: true,
        uppercase: true,
        digits: true,
        symbols: true,
        excludeAmbiguous: false,
      })
      expect(password).toHaveLength(length)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[0-9]/)
      expect(password).toMatch(/[^a-zA-Z0-9]/)
    }
  })

  it('évite les caractères ambigus', () => {
    for (let i = 0; i < 100; i++) {
      const password = generatePassword({
        length: 64,
        lowercase: true,
        uppercase: true,
        digits: true,
        symbols: true,
        excludeAmbiguous: true,
      })
      expect(password).not.toMatch(/[O0oIl1|`'"]/)
    }
  })

  it('ne génère pas deux fois le même mot de passe', () => {
    const values = new Set(
      Array.from({ length: 50 }, () =>
        generatePassword({
          length: 20,
          lowercase: true,
          uppercase: true,
          digits: true,
          symbols: true,
          excludeAmbiguous: true,
        }),
      ),
    )
    expect(values.size).toBe(50)
  })

  it('lève une erreur sans classe sélectionnée', () => {
    expect(() =>
      generatePassword({
        length: 20,
        lowercase: false,
        uppercase: false,
        digits: false,
        symbols: false,
        excludeAmbiguous: true,
      }),
    ).toThrow()
  })

  it('calcule une entropie positive', () => {
    expect(
      generatedEntropy({
        length: 20,
        lowercase: true,
        uppercase: true,
        digits: true,
        symbols: true,
        excludeAmbiguous: true,
      }),
    ).toBeGreaterThan(100)
  })
})

describe('phrases de passe', () => {
  it('respecte le nombre de mots et le séparateur', () => {
    const phrase = generatePassphrase({
      words: 5,
      separator: '-',
      capitalize: true,
      includeNumber: true,
    })
    const parts = phrase.split('-')
    expect(parts).toHaveLength(5)
    for (const part of parts) expect(part[0]).toBe(part[0].toUpperCase())
    expect(parts[parts.length - 1]).toMatch(/\d{2}$/)
  })

  it('utilise la liste EFF de 7776 mots', () => {
    expect(wordlistSize()).toBe(7776)
  })

  it('calcule une entropie croissante avec le nombre de mots', () => {
    const base = {
      separator: '-',
      capitalize: true,
      includeNumber: false,
    }
    expect(passphraseEntropy({ ...base, words: 6 })).toBeGreaterThan(
      passphraseEntropy({ ...base, words: 4 }),
    )
  })
})
