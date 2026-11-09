#!/usr/bin/env node
/**
 * Met à jour les instantanés embarqués de 2FA Directory et Passkeys Directory.
 *
 * Sources :
 *   - https://api.2fa.directory/v4/all.json (données MIT)
 *   - https://passkeys-api.2fa.directory/v1/supported.json (CC BY 4.0)
 *
 * Le script est prévu pour être lancé explicitement par un mainteneur. Il peut
 * relire des fichiers locaux avec `--two-factor` et `--passkeys` pour rester
 * reproductible hors ligne. L’application ne fait aucun appel réseau.
 *
 * Utilisation :
 *   node scripts/update-2fa-directory.mjs
 *   node scripts/update-2fa-directory.mjs --two-factor /tmp/2fa.json --passkeys /tmp/passkeys.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const TARGET = join(ROOT, 'src/assets/site-security.json')
const TWO_FACTOR_URL = 'https://api.2fa.directory/v4/all.json'
const PASSKEYS_URL = 'https://passkeys-api.2fa.directory/v1/supported.json'
const METHODS = new Set([
  'totp',
  'sms',
  'call',
  'email',
  'u2f',
  'custom-software',
  'custom-hardware',
])

function normalizeDomain(value) {
  if (typeof value !== 'string') return ''
  const domain = value.trim().toLowerCase().replace(/\.$/, '')
  if (!domain || domain.length > 253 || domain.includes('..')) return ''
  if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes('.')) return ''
  return domain
}

function normalizeUrl(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048) return undefined
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function compactTwoFactor(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Format 2FA inattendu')
  }
  const entries = []
  for (const [rawDomain, value] of Object.entries(data)) {
    const domain = normalizeDomain(rawDomain)
    if (!domain || !value || typeof value !== 'object') continue
    const methods = Array.isArray(value.methods)
      ? [...new Set(value.methods.filter((method) => METHODS.has(method)))].sort()
      : []
    if (methods.length === 0) continue
    const documentation = normalizeUrl(value.documentation)
    entries.push(
      documentation
        ? [domain, methods, documentation]
        : [domain, methods],
    )
  }
  entries.sort((first, second) => first[0].localeCompare(second[0], 'en'))
  return entries
}

function compactPasskeys(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Format Passkeys inattendu')
  }
  const entries = []
  for (const [rawDomain, value] of Object.entries(data)) {
    const domain = normalizeDomain(rawDomain)
    if (!domain || !value || typeof value !== 'object') continue
    const documentation = normalizeUrl(value.documentation)
    entries.push(documentation ? [domain, documentation] : [domain])
  }
  entries.sort((first, second) => first[0].localeCompare(second[0], 'en'))
  return entries
}

function readArgument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value) throw new Error(`Chemin manquant après ${name}`)
  return value
}

async function load(url, localPath) {
  if (localPath) return readFileSync(localPath, 'utf8')
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Coffre-dataset-updater' },
  })
  if (!response.ok) throw new Error(`Téléchargement impossible : ${response.status}`)
  return response.text()
}

const twoFactor = compactTwoFactor(
  JSON.parse(await load(TWO_FACTOR_URL, readArgument('--two-factor'))),
)
const passkeys = compactPasskeys(
  JSON.parse(await load(PASSKEYS_URL, readArgument('--passkeys'))),
)

const payload = {
  version: 1,
  snapshot: new Date().toISOString().slice(0, 10),
  twoFactor: {
    source: 'https://2fa.directory',
    license: 'MIT',
    data: twoFactor,
  },
  passkeys: {
    source: 'https://passkeys.directory',
    license: 'CC-BY-4.0',
    data: passkeys,
  },
}

writeFileSync(TARGET, `${JSON.stringify(payload)}\n`)
console.log(
  `Sécurité par site : ${twoFactor.length} domaines 2FA et ${passkeys.length} domaines passkeys écrits dans ${TARGET}`,
)
