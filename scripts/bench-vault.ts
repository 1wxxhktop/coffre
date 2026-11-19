/**
 * Mesure locale de l’index de recherche sur un très gros coffre.
 *
 * Usage : bun scripts/bench-vault.ts [nombre]
 * Le script n’écrit rien sur le disque et ne fait aucun appel réseau.
 */

import { analyzeSecurity } from '../src/lib/security'
import { buildSearchIndex, normalizeSearchText } from '../src/lib/vaultSearch'
import type { LoginItem } from '../src/lib/types'

const count = Math.max(1, Number(process.argv[2] ?? 100_000))
const timestamp = '2026-01-01T00:00:00.000Z'
const items: LoginItem[] = Array.from({ length: count }, (_, index) => ({
  id: `login-${index}`,
  vaultId: 'vault-1',
  type: 'login',
  title: `Compte ${index} — Café ${index % 97}`,
  favorite: index % 10 === 0,
  notes: index % 3 === 0 ? `Note de travail ${index}` : '',
  tags: index % 5 === 0 ? ['travail', 'important'] : [],
  customFields:
    index % 7 === 0
      ? [
          {
            id: `field-${index}`,
            label: 'Environnement',
            type: 'text',
            value: index % 2 === 0 ? 'production' : 'staging',
          },
        ]
      : [],
  attachments: [],
  deletedAt: null,
  expiresAt: '',
  createdAt: timestamp,
  updatedAt: timestamp,
  username: `ada${index}@example.com`,
  password: `secret-${index}`,
  urls: [`https://example.com/${index}`],
  totp: '',
}))

const start = performance.now()
const index = buildSearchIndex(items)
const buildMs = performance.now() - start

const queries = [
  'cafe 42',
  'ada9999',
  'travail',
  'production',
  'example.com/99999',
  'introuvable',
]
const searchStart = performance.now()
let matches = 0
for (let round = 0; round < 20; round += 1) {
  const query = normalizeSearchText(queries[round % queries.length])
  for (const item of items) {
    if ((index.get(item.id) ?? '').includes(query)) matches += 1
  }
}
const searchMs = performance.now() - searchStart

const securityStart = performance.now()
analyzeSecurity(items)
const securityFirstMs = performance.now() - securityStart

const cachedStart = performance.now()
analyzeSecurity(items)
const securityCachedMs = performance.now() - cachedStart

const memory = process.memoryUsage()
console.log(`Éléments            : ${count.toLocaleString('fr-FR')}`)
console.log(`Index               : ${buildMs.toFixed(0)} ms`)
console.log(`120 recherches      : ${searchMs.toFixed(0)} ms`)
console.log(`Correspondances     : ${matches.toLocaleString('fr-FR')}`)
console.log(`Analyse sécurité    : ${securityFirstMs.toFixed(0)} ms`)
console.log(`Analyse (cache)     : ${securityCachedMs.toFixed(0)} ms`)
console.log(`Mémoire (RSS)       : ${(memory.rss / 1024 / 1024).toFixed(0)} Mio`)
