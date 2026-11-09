#!/usr/bin/env node
/**
 * Génère la table réduite de confusables Unicode utilisée par la protection
 * anti-hameçonnage.
 *
 * Source : Unicode UTS #39, fichier `confusables.txt` (Unicode License V3).
 * Le script peut relire un fichier local avec `--source`, ou télécharger la
 * dernière version depuis unicode.org lorsqu’il est lancé explicitement par un
 * mainteneur. Aucun appel réseau n’est fait par l’application.
 *
 * Utilisation :
 *   node scripts/update-confusables.mjs
 *   node scripts/update-confusables.mjs --source /tmp/confusables.txt
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const TARGET = join(ROOT, 'src/assets/confusables.json')
const SOURCE_URL =
  'https://www.unicode.org/Public/security/latest/confusables.txt'

/**
 * Correspondances fréquentes ajoutées à la table officielle : l’UTR #39 renvoie
 * parfois vers des petites capitales ou des suites combinées, alors que les
 * domaines utilisent des lettres latines simples.
 */
const EXTRA = {
  α: 'a',
  β: 'b',
  γ: 'y',
  δ: 'd',
  ε: 'e',
  ζ: 'z',
  η: 'n',
  θ: 'o',
  ι: 'i',
  κ: 'k',
  λ: 'l',
  μ: 'u',
  ν: 'v',
  ξ: 'e',
  ο: 'o',
  π: 'n',
  ρ: 'p',
  σ: 'o',
  τ: 't',
  υ: 'u',
  φ: 'f',
  χ: 'x',
  ψ: 'w',
  ω: 'w',
}

function parseCodePoints(value) {
  return String.fromCodePoint(
    ...value
      .split(/\s+/)
      .filter(Boolean)
      .map((hex) => Number.parseInt(hex, 16)),
  )
}

function parse(text) {
  const mappings = new Map()
  let version = 'inconnue'
  let snapshot = new Date().toISOString().slice(0, 10)

  for (const line of text.split('\n')) {
    const versionMatch = /^# Version:\s*(\S+)/.exec(line)
    if (versionMatch) version = versionMatch[1]
    const dateMatch = /^# Date:\s*([^\n]+)/.exec(line)
    if (dateMatch) {
      const parsed = Date.parse(dateMatch[1])
      if (Number.isFinite(parsed)) snapshot = new Date(parsed).toISOString().slice(0, 10)
    }

    const clean = line.split('#')[0].trim()
    if (!clean) continue
    const [sourceHex, targetHex] = clean.split(';').map((part) => part.trim())
    if (!sourceHex || !targetHex) continue

    const source = parseCodePoints(sourceHex)
    const target = parseCodePoints(targetHex)
    // On ne garde que les caractères isolés non ASCII qui se réduisent à une
    // suite de lettres ou de chiffres ASCII : c’est tout ce dont un domaine a
    // besoin.
    if (source.length !== 1 || (source.codePointAt(0) ?? 0) < 128) continue
    if (!/^[a-z0-9]+$/.test(target)) continue
    if (!mappings.has(source) || target.length < mappings.get(source).length) {
      mappings.set(source, target)
    }
  }

  for (const [source, target] of Object.entries(EXTRA)) {
    mappings.set(source, target)
  }

  return { version, snapshot, mappings: Object.fromEntries(mappings) }
}

async function readSource() {
  const index = process.argv.indexOf('--source')
  if (index >= 0) {
    const path = process.argv[index + 1]
    if (!path) throw new Error('Chemin manquant après --source')
    return readFileSync(path, 'utf8')
  }
  const response = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'Coffre-dataset-updater' },
  })
  if (!response.ok) throw new Error(`Téléchargement impossible : ${response.status}`)
  return response.text()
}

const text = await readSource()
const { version, snapshot, mappings } = parse(text)
const payload = {
  version: 1,
  unicodeVersion: version,
  snapshot,
  source: 'Unicode UTS #39 confusables.txt',
  license: 'Unicode License V3',
  mappings,
}
writeFileSync(TARGET, `${JSON.stringify(payload, null, 2)}\n`)
console.log(
  `Confusables : ${Object.keys(mappings).length} correspondances (Unicode ${version}) écrites dans ${TARGET}`,
)
