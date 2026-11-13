#!/usr/bin/env node
/**
 * Paquets de distribution de l’extension (E13).
 *
 * Chromium (Chrome/Edge) et Firefox acceptent tous deux une archive ZIP dont
 * le manifeste est à la racine. L’XPI Firefox est la même archive avec une
 * autre extension. Le script vérifie la version et les fichiers indispensables
 * avant de produire les paquets et leurs empreintes.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'

const root = process.cwd()
const dist = join(root, 'dist-extension')
const manifestPath = join(dist, 'manifest.json')
const packagePath = join(root, 'package.json')
const chromiumPath = join(root, 'coffre-extension.zip')
const firefoxPath = join(root, 'coffre-extension.xpi')
const sumsPath = join(root, 'SHA256SUMS-extension')

if (!existsSync(manifestPath)) {
  console.error('Build introuvable : lancer `bun run extension:build`.')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.version !== pkg.version) {
  console.error(
    `Version incohérente : manifeste ${manifest.version}, paquet ${pkg.version}.`,
  )
  process.exit(1)
}

const required = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'menu.html',
  'options.html',
]
const missing = required.filter((file) => !existsSync(join(dist, file)))
if (missing.length > 0) {
  console.error(`Fichiers manquants dans dist-extension : ${missing.join(', ')}`)
  process.exit(1)
}

for (const file of [chromiumPath, firefoxPath, sumsPath]) {
  rmSync(file, { force: true })
}

// L’archive est créée depuis le contenu, jamais depuis un dossier parent :
// les stores exigent manifest.json à la racine.
execFileSync('zip', ['-qr', chromiumPath, '.'], { cwd: dist })
copyFileSync(chromiumPath, firefoxPath)

const sha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const sums = [chromiumPath, firefoxPath]
  .map((path) => `${sha256(path)}  ${basename(path)}`)
  .join('\n')
writeFileSync(sumsPath, `${sums}\n`)

console.log(`Chromium/Edge : ${basename(chromiumPath)}`)
console.log(`Firefox       : ${basename(firefoxPath)}`)
console.log(`Empreintes    : ${basename(sumsPath)}`)
