import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'src/components'
const FILES = [
  ...readdirSync(ROOT)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => join(ROOT, name)),
  'src/App.tsx',
]

const ALLOW = new Set([
  '.coffre',
  '.coffre-share',
  'docs/SECURITY.md',
  'Argon2id',
  'Add-Padding',
  'Coffre',
  'Promise',
  'Coffre/&lt;id&gt;/',
  'SUPPRIMER',
  'EFFACER',
  'AES-256-GCM',
  'otpauth://',
  'https://',
  'MM/AA',
  '123',
  'Visa, Mastercard…',
  'Local-first',
  'GPL-3.0',
  'TOTP',
  'CVC',
  'PIN',
  'API',
  'URL',
  'Coffre local',
  'https://exemple.com',
  'otpauth://totp/…',
  "0 ? 'up' : summary.delta",
  'Le fichier',
  'Coffre/&lt;id&gt;/',
  'local-first',
])

const problems = []

for (const file of FILES) {
  const source = readFileSync(file, 'utf8')

  for (const match of source.matchAll(/>[ \t]*([^<>{}\n]*[A-Za-zÀ-ÿ][^<>{}\n]*?)[ \t]*</g)) {
    const text = match[1].trim()
    if (!text || ALLOW.has(text)) continue
    if (/^[0-9\s.,;:!?()\-–—…%]+$/.test(text)) continue
    problems.push(`${file}: texte JSX non traduit « ${text.slice(0, 80)} »`)
  }

  for (const match of source.matchAll(
    /(?:placeholder|title|aria-label|description|confirmLabel|requireText|busyLabel)="([^"]*[A-Za-zÀ-ÿ][^"]*)"/g,
  )) {
    const text = match[1].trim()
    if (!text || ALLOW.has(text)) continue
    problems.push(`${file}: attribut non traduit « ${text.slice(0, 80)} »`)
  }

  for (const match of source.matchAll(/toast\('([^']*[A-Za-zÀ-ÿ][^']*)'/g)) {
    const text = match[1].trim()
    if (!text || ALLOW.has(text)) continue
    problems.push(`${file}: notification non traduite « ${text.slice(0, 80)} »`)
  }
}

if (problems.length > 0) {
  console.error(`i18n : ${problems.length} chaîne(s) en dur détectée(s)`)
  for (const problem of problems.slice(0, 80)) console.error(`  - ${problem}`)
  if (problems.length > 80) console.error(`  … et ${problems.length - 80} autre(s)`)
  process.exit(1)
}

console.log('i18n : aucune chaîne d’interface en dur détectée dans les composants.')
