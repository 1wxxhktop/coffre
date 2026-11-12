#!/usr/bin/env bun
/**
 * Vérifie que les SBOM contiennent les composants runtime attendus.
 *
 * Le contrôle est volontairement limité aux dépendances qui doivent
 * absolument figurer dans un SBOM distribué : une régression silencieuse de
 * l’outil de génération ne doit pas passer la CI.
 */
import { readFileSync } from 'node:fs'

const root = process.argv[2] ?? 'sbom'

function components(file) {
  const sbom = JSON.parse(readFileSync(`${root}/${file}`, 'utf8'))
  return new Set(
    (sbom.components ?? [])
      .filter((component) => component && typeof component.name === 'string')
      .map((component) => component.name),
  )
}

function requireComponents(file, expected) {
  let names
  try {
    names = components(file)
  } catch (error) {
    console.error(`SBOM illisible : ${file}`, error)
    process.exit(1)
  }
  const missing = expected.filter((name) => !names.has(name))
  if (missing.length > 0) {
    console.error(`Composants absents de ${file} : ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log(`${file} : ${expected.length} composants attendus présents.`)
}

requireComponents('web.cdx.json', [
  'react',
  'react-dom',
  'zod',
  'idb',
  'hash-wasm',
  'aes-js',
  'fast-xml-parser',
  'fflate',
  'hpke-js',
  'simple-icons',
  'uqr',
  '@tauri-apps/api',
  '@tauri-apps/plugin-dialog',
])

requireComponents('rust-coffre-core.cdx.json', [
  'aes-gcm',
  'argon2',
  'base64',
  'getrandom',
  'hmac',
  'serde',
  'serde_json',
  'sha2',
  'zeroize',
])

requireComponents('rust-coffre-core-ffi.cdx.json', [
  'uniffi',
  'thiserror',
  'zeroize',
  'serde_json',
])
