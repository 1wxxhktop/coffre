#!/usr/bin/env bun
/**
 * Complète le SBOM web produit par cyclonedx-npm.
 *
 * cyclonedx-npm s’appuie sur `npm ls` et omet certains paquets installés par
 * Bun (notamment @tauri-apps/api et @tauri-apps/plugin-dialog). On ajoute les
 * composants manquants depuis `bun pm licenses --json`, qui lit le lockfile.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const path = process.argv[2] ?? 'sbom/web.cdx.json'

function licenseEntry(value) {
  if (!value) return [{ license: { id: 'NOASSERTION' } }]
  if (value.includes(' OR ') || value.includes(' AND ')) {
    return [{ expression: value }]
  }
  return [{ license: { id: value } }]
}

function purl(name, version) {
  const encoded = name.startsWith('@') ? `%40${name.slice(1)}` : name
  return `pkg:npm/${encoded}@${version}`
}

const sbom = JSON.parse(readFileSync(path, 'utf8'))
if (!Array.isArray(sbom.components)) sbom.components = []

const existing = new Set(
  sbom.components
    .filter((component) => component && component.name)
    .map((component) => `${component.name}@${component.version ?? ''}`),
)

let licenses
try {
  licenses = JSON.parse(
    execFileSync('bun', ['pm', 'licenses', '--json'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  )
} catch (error) {
  console.error('Impossible de lire bun pm licenses --json', error)
  process.exit(1)
}

let added = 0
for (const [license, packages] of Object.entries(licenses)) {
  for (const pkg of packages) {
    if (!pkg || typeof pkg.name !== 'string') continue
    const versions = Array.isArray(pkg.versions) && pkg.versions.length > 0
      ? pkg.versions
      : ['0.0.0']
    for (const version of versions) {
      const key = `${pkg.name}@${version}`
      if (existing.has(key)) continue
      existing.add(key)
      sbom.components.push({
        type: 'library',
        name: pkg.name,
        version,
        licenses: licenseEntry(pkg.license ?? license),
        purl: purl(pkg.name, version),
        ...(pkg.description ? { description: pkg.description } : {}),
        ...(pkg.homepage
          ? {
              externalReferences: [
                { type: 'website', url: String(pkg.homepage) },
              ],
            }
          : {}),
      })
      added += 1
    }
  }
}

sbom.components.sort((left, right) =>
  `${left.name}@${left.version ?? ''}`.localeCompare(
    `${right.name}@${right.version ?? ''}`,
  ),
)
writeFileSync(path, `${JSON.stringify(sbom, null, 2)}\n`)
console.log(`SBOM web complété : ${added} composant(s) ajouté(s) dans ${path}`)
