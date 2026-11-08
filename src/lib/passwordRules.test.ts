import { describe, expect, it } from 'vitest'
import {
  generatePasswordForRules,
  parsePasswordRules,
  passwordRulesForUrl,
  sitePasswordEntropy,
  sitePasswordRuleDomains,
} from './passwordRules'

describe('règles de mot de passe par site', () => {
  it('parse les contraintes simples et les classes', () => {
    const rules = parsePasswordRules(
      'minlength: 12; maxlength: 20; max-consecutive: 3; required: lower, upper; required: digit; allowed: lower, upper, digit, [-!"#$%&\'()*+,./:;<=>?@[^_{|}~]];',
    )
    expect(rules.minLength).toBe(12)
    expect(rules.maxLength).toBe(20)
    expect(rules.maxConsecutive).toBe(3)
    expect(rules.required).toHaveLength(3)
    expect(rules.allowed).toContain('[')
    expect(rules.allowed).toContain(']')
    expect(rules.allowed).toContain(';')
  })

  it('génère un mot de passe conforme pour Google', () => {
    const found = passwordRulesForUrl('https://accounts.google.com/connexion')
    expect(found?.domain).toBe('google.com')
    const password = generatePasswordForRules(found!.rules, 20)
    expect(password.length).toBeGreaterThanOrEqual(8)
    for (const character of password) {
      expect(found!.rules.allowed).toContain(character)
    }
    expect(sitePasswordEntropy(found!.rules, 20)).toBeGreaterThan(0)
  })

  it('respecte la longueur et les classes de PayPal', () => {
    const found = passwordRulesForUrl('paypal.com')
    expect(found?.domain).toBe('paypal.com')
    for (let index = 0; index < 20; index += 1) {
      const password = generatePasswordForRules(found!.rules, 64)
      expect(password.length).toBeLessThanOrEqual(20)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[0-9]/)
      expect(password).toMatch(/[^a-zA-Z0-9]/)
    }
  })

  it('parse toutes les règles du dataset', () => {
    const domains = sitePasswordRuleDomains()
    expect(domains.length).toBeGreaterThan(400)
    for (const domain of domains) {
      expect(() => passwordRulesForUrl(domain)).not.toThrow()
      expect(passwordRulesForUrl(domain)).not.toBeNull()
    }
  })

  it('ignore un hôte inconnu ou vide', () => {
    expect(passwordRulesForUrl('inconnu.invalid')).toBeNull()
    expect(passwordRulesForUrl('   ')).toBeNull()
  })
})
