import { describe, expect, it } from 'vitest'
import {
  aliasTagFromSite,
  generateEmailAlias,
  isValidAlias,
} from './emailAlias'

describe('alias e-mail hors ligne', () => {
  it('génère une adresse plus', () => {
    const result = generateEmailAlias({
      baseEmail: 'Ada.Lovelace@Example.com',
      site: 'https://www.github.com/login',
      mode: 'plus',
      tag: 'GitHub',
    })
    expect(result).toEqual({ alias: 'ada.lovelace+github@example.com', tag: 'github' })
    expect(isValidAlias(result.alias)).toBe(true)
  })

  it('génère une adresse catch-all sur un domaine personnel', () => {
    const result = generateEmailAlias({
      baseEmail: 'ada@lovelace.dev',
      site: 'github.com',
      mode: 'catch-all',
      tag: 'gh',
    })
    expect(result.alias).toBe('gh@lovelace.dev')
  })

  it('déduit un tag du domaine et ajoute un suffixe aléatoire', () => {
    expect(aliasTagFromSite('https://www.news.ycombinator.com')).toBe('news')
    const result = generateEmailAlias({
      baseEmail: 'ada@example.com',
      site: 'https://news.ycombinator.com',
      mode: 'plus',
    })
    expect(result.alias).toMatch(/^ada\+news-[0-9a-f]{4}@example\.com$/)
  })

  it('refuse une adresse de base invalide', () => {
    expect(() =>
      generateEmailAlias({ baseEmail: 'pas-une-adresse', site: 'x', mode: 'plus' }),
    ).toThrow(/invalide/)
    expect(isValidAlias('pas-une-adresse')).toBe(false)
  })
})
