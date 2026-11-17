import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_GENERATOR_PREFERENCES,
  loadGeneratorPreferences,
  sanitizePassphraseOptions,
  sanitizePasswordOptions,
  saveGeneratorPreferences,
} from './generatorOptions'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('préférences du générateur', () => {
  it('retombe sur les valeurs par défaut sans préférences enregistrées', () => {
    expect(loadGeneratorPreferences()).toEqual(DEFAULT_GENERATOR_PREFERENCES)
  })

  it('ignore un contenu invalide', () => {
    vi.stubGlobal(
      'localStorage',
      memoryStorage({ 'coffre:generator-options:v1': '{ pas du json' }),
    )
    expect(loadGeneratorPreferences()).toEqual(DEFAULT_GENERATOR_PREFERENCES)
  })

  it('borne la longueur et conserve les classes désactivées', () => {
    const options = sanitizePasswordOptions({
      length: 999,
      lowercase: false,
      uppercase: false,
      digits: false,
      symbols: false,
      excludeAmbiguous: false,
    })
    expect(options).toEqual({
      length: 64,
      lowercase: true,
      uppercase: false,
      digits: false,
      symbols: false,
      excludeAmbiguous: false,
    })
  })

  it('ignore une longueur absente ou invalide', () => {
    expect(sanitizePasswordOptions({ length: null }).length).toBe(20)
    expect(sanitizePasswordOptions({ length: '' }).length).toBe(20)
    expect(sanitizePasswordOptions({ length: '32' }).length).toBe(20)
    expect(sanitizePasswordOptions({ length: Number.NaN }).length).toBe(20)
  })

  it('valide le séparateur et le nombre de mots', () => {
    expect(
      sanitizePassphraseOptions({
        words: 99,
        separator: '--',
        capitalize: false,
        includeNumber: false,
      }),
    ).toEqual({
      words: 10,
      separator: '-',
      capitalize: false,
      includeNumber: false,
    })
  })

  it('enregistre et relit les options choisies', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    saveGeneratorPreferences({
      mode: 'passphrase',
      password: {
        length: 32,
        lowercase: true,
        uppercase: false,
        digits: true,
        symbols: false,
        excludeAmbiguous: true,
      },
      passphrase: {
        words: 7,
        separator: '_',
        capitalize: false,
        includeNumber: true,
      },
    })
    expect(loadGeneratorPreferences()).toEqual({
      mode: 'passphrase',
      password: {
        length: 32,
        lowercase: true,
        uppercase: false,
        digits: true,
        symbols: false,
        excludeAmbiguous: true,
      },
      passphrase: {
        words: 7,
        separator: '_',
        capitalize: false,
        includeNumber: true,
      },
    })
  })

  it('ne casse pas le générateur si le stockage refuse l’écriture', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() =>
      saveGeneratorPreferences(DEFAULT_GENERATOR_PREFERENCES),
    ).not.toThrow()
  })
})
