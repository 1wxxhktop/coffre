#!/usr/bin/env node
/**
 * Vérifie que release/ contient une et une seule version, et que le lien
 * `release/latest` pointe dessus.
 *
 * Usage : bun run release:status
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(ROOT, 'release')
const packageVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

if (!existsSync(releaseDir)) {
  console.error('release/ est absent. Lancez : bun run release:update')
  process.exit(1)
}

const latestPath = join(releaseDir, 'latest')
if (!existsSync(latestPath)) {
  console.error('release/latest est absent. Lancez : bun run release:update')
  process.exit(1)
}

let latestName
try {
  latestName = basename(realpathSync(latestPath))
} catch {
  try {
    latestName = basename(resolve(releaseDir, readlinkSync(latestPath)))
  } catch {
    console.error('release/latest est illisible. Lancez : bun run release:update')
    process.exit(1)
  }
}

const latestDir = join(releaseDir, latestName)
if (!existsSync(latestDir) || !statSync(latestDir).isDirectory()) {
  console.error(`release/latest pointe vers un dossier absent : ${latestName}`)
  process.exit(1)
}

const versions = readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('coffre-'))
  .map((entry) => entry.name)

if (versions.length !== 1) {
  console.error(
    `release/ doit contenir une seule version, trouvé : ${versions.length} (${versions.join(', ') || 'aucune'}).`,
  )
  process.exit(1)
}

const match = latestName.match(/^coffre-(.+)-([0-9a-f]{7,})$/)
if (!match) {
  console.error(`Nom de version inattendu : ${latestName}`)
  process.exit(1)
}

const [, releaseVersion] = match
if (releaseVersion !== packageVersion) {
  console.error(
    `release/ contient ${releaseVersion}, mais package.json annonce ${packageVersion}. Lancez : bun run release:update`,
  )
  process.exit(1)
}

console.log(`release/ : ${latestName} — version ${releaseVersion} (une seule version).`)
