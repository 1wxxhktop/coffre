#!/usr/bin/env node
/**
 * Génère la liste embarquée des domaines populaires utilisée par la protection
 * anti-hameçonnage.
 *
 * Source : Apple « Password Manager Resources » (MIT), déjà embarquée dans
 * `src/assets/password-rules.json`. Le script ne fait aucun appel réseau : il
 * relit le fichier versionné et produit une liste compacte de domaines.
 *
 * Utilisation : node scripts/update-popular-domains.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SOURCE = join(ROOT, 'src/assets/password-rules.json')
const TARGET = join(ROOT, 'src/assets/popular-domains.json')

const raw = JSON.parse(readFileSync(SOURCE, 'utf8'))
const domains = [
  ...new Set(
    Object.keys(raw)
      .map((value) => value.trim().toLowerCase().replace(/\.$/, ''))
      .filter((value) => /^[a-z0-9.-]+$/.test(value) && value.includes('.')),
  ),
].sort((a, b) => a.localeCompare(b, 'en'))

const payload = {
  version: 1,
  snapshot: new Date().toISOString().slice(0, 10),
  source: 'Apple Password Manager Resources',
  license: 'MIT',
  domains,
}

writeFileSync(TARGET, `${JSON.stringify(payload, null, 2)}\n`)
console.log(`Liste populaire : ${domains.length} domaines écrits dans ${TARGET}`)
