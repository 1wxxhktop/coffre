#!/usr/bin/env bun
/**
 * Génère la seconde liste embarquée de domaines populaires à partir du Chrome
 * UX Report (CrUX), distribué par Google sous licence CC BY 4.0.
 *
 * Le fichier `current.csv.gz` de `zakird/crux-top-lists` est un export direct
 * des données publiques CrUX de Google BigQuery. Chaque origine est ramenée à
 * son domaine enregistrable, puis dédupliquée et triée.
 *
 * Utilisation : bun scripts/update-crux-domains.ts
 * Limite : variable d’environnement CRUX_RANK_LIMIT (1 000 par défaut).
 *
 * La tranche des 1 000 origines les plus populaires couvre environ 50 % des
 * chargements de page selon CrUX. Les tranches suivantes contiennent des
 * domaines de niche qui rendraient la détection de fautes de frappe trop
 * bruyante ; la limite reste réglable pour une analyse ponctuelle.
 */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isIpAddress,
  isLoopbackHost,
  normalizeHostname,
  registrableDomain,
} from '../src/lib/domains'

const SOURCE_URL =
  'https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/current.csv.gz'
const TARGET = join(process.cwd(), 'src/assets/popular-domains-crux.json')
const RANK_LIMIT = Number(process.env.CRUX_RANK_LIMIT ?? 1_000)

if (!Number.isInteger(RANK_LIMIT) || RANK_LIMIT < 1_000 || RANK_LIMIT > 1_000_000) {
  throw new Error('CRUX_RANK_LIMIT doit être un entier entre 1 000 et 1 000 000')
}

console.log(`Téléchargement de ${SOURCE_URL}…`)
const response = await fetch(SOURCE_URL)
if (!response.ok) {
  throw new Error(`Téléchargement impossible : HTTP ${response.status}`)
}
const compressed = new Uint8Array(await response.arrayBuffer())
const sourceSha256 = createHash('sha256').update(compressed).digest('hex')
const csv = gunzipSync(compressed).toString('utf8')
const lines = csv.split('\n')

const domains = new Set<string>()
let origins = 0
let stopped = false

for (const line of lines) {
  if (!line || line.startsWith('origin,')) continue
  const separator = line.lastIndexOf(',')
  if (separator < 0) continue
  const origin = line.slice(0, separator).trim()
  const rank = Number(line.slice(separator + 1))
  if (!Number.isFinite(rank)) continue
  if (rank > RANK_LIMIT) {
    stopped = true
    break
  }
  origins += 1
  let host: string
  try {
    host = normalizeHostname(new URL(origin).hostname)
  } catch {
    continue
  }
  if (!host || isIpAddress(host) || isLoopbackHost(host)) continue
  const domain = registrableDomain(host)
  if (
    !domain ||
    !domain.includes('.') ||
    domain.length > 253 ||
    !/^[a-z0-9.-]+$/.test(domain)
  ) {
    continue
  }
  domains.add(domain)
}

if (!stopped || origins === 0 || domains.size === 0) {
  throw new Error('Le fichier CrUX ne contient pas les rangs attendus')
}

const sorted = [...domains].sort((first, second) =>
  first.localeCompare(second, 'en'),
)
const snapshot = new Date().toISOString().slice(0, 10)
const payload = {
  version: 1,
  snapshot,
  source: 'Chrome UX Report (CrUX)',
  sourceUrl: 'https://developer.chrome.com/docs/crux/',
  cacheUrl: 'https://github.com/zakird/crux-top-lists',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'Chrome UX Report, Google, CC BY 4.0',
  rankLimit: RANK_LIMIT,
  origins,
  sourceSha256,
  domains: sorted,
}

writeFileSync(TARGET, `${JSON.stringify(payload, null, 2)}\n`)
console.log(
  `Liste CrUX : ${sorted.length} domaines issus de ${origins} origines (rang ≤ ${RANK_LIMIT}) écrits dans ${TARGET}`,
)
