import { describe, expect, it } from 'vitest'
import {
  isSiteExcluded,
  normalizeExclusions,
  siteKey,
} from '../../extension/siteExclusions'

describe('exclusions par site', () => {
  it('normalise les sous-domaines et les suffixes usuels', () => {
    expect(siteKey('https://www.Example.com/login')).toBe('example.com')
    expect(siteKey('login.example.com')).toBe('example.com')
    expect(siteKey('compte.example.co.uk')).toBe('example.co.uk')
    expect(siteKey('foo.github.io')).toBe('foo.github.io')
    expect(siteKey('localhost')).toBe('localhost')
    expect(siteKey('127.0.0.1:8099')).toBe('127.0.0.1')
  })

  it('dédoublonne et ignore les entrées invalides', () => {
    expect(
      normalizeExclusions([
        'https://www.example.com/path',
        'example.com',
        'login.example.com',
        ' ',
        42,
        'example.co.uk',
      ]),
    ).toEqual(['example.com', 'example.co.uk'])
  })

  it('reconnaît les sous-domaines d’une exclusion', () => {
    expect(isSiteExcluded(['example.com'], 'login.example.com')).toBe(true)
    expect(isSiteExcluded(['example.com'], 'example.org')).toBe(false)
    expect(isSiteExcluded(['example.co.uk'], 'www.example.co.uk')).toBe(true)
    expect(isSiteExcluded([], 'example.com')).toBe(false)
  })
})
