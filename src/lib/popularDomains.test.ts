import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { popularPhishingIndex } from './phishing'

interface CruxDataset {
  version: number
  snapshot: string
  source: string
  sourceUrl: string
  license: string
  licenseUrl: string
  rankLimit: number
  origins: number
  sourceSha256: string
  domains: string[]
}

function crux(): CruxDataset {
  return JSON.parse(
    readFileSync(
      new URL('../assets/popular-domains-crux.json', import.meta.url),
      'utf8',
    ),
  ) as CruxDataset
}

describe('seconde liste de domaines populaires (CrUX)', () => {
  it('conserve les métadonnées de source et de licence', () => {
    const data = crux()
    expect(data.version).toBe(1)
    expect(data.source).toBe('Chrome UX Report (CrUX)')
    expect(data.license).toBe('CC BY 4.0')
    expect(data.licenseUrl).toContain('creativecommons.org/licenses/by/4.0')
    expect(data.rankLimit).toBeGreaterThanOrEqual(1_000)
    expect(data.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(data.snapshot).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('contient des domaines enregistrables uniques et normalisés', () => {
    const domains = crux().domains
    expect(domains.length).toBeGreaterThan(500)
    expect(new Set(domains).size).toBe(domains.length)
    for (const domain of domains) {
      expect(domain).toBe(domain.toLowerCase())
      expect(domain.startsWith('www.')).toBe(false)
      expect(domain.includes('.')).toBe(true)
      expect(domain).toMatch(/^[a-z0-9.-]+$/)
    }
    expect(domains).toEqual([...domains].sort((a, b) => a.localeCompare(b, 'en')))
  })

  it('alimente l’index populaire avec un domaine absent de la liste Apple', () => {
    const index = popularPhishingIndex()
    expect(index.byHost.has('cricbuzz.com')).toBe(true)
    expect(index.byHost.has('google.com')).toBe(true)
  })
})
