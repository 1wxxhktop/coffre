import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loginAllowsHost } from './extensionProtocol'

interface DomainVector {
  itemUrl: string
  service: string
  allowed: boolean
  note: string
}

const vectors = JSON.parse(
  readFileSync('test-vectors/domain-matching.json', 'utf8'),
) as { description: string; cases: DomainVector[] }

describe('vecteurs croisés de correspondance de domaines', () => {
  it('contient au moins 40 cas', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(40)
  })

  for (const vector of vectors.cases) {
    it(`${vector.itemUrl} ↔ ${vector.service || '(vide)'} : ${vector.note}`, () => {
      expect(
        loginAllowsHost({ urls: [vector.itemUrl] }, vector.service),
      ).toBe(vector.allowed)
    })
  }
})
