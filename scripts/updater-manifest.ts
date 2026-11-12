#!/usr/bin/env bun
/**
 * Outils de manifeste de mise à jour pour la CI de release.
 *
 *   bun scripts/updater-manifest.ts build \
 *     --version 1.2.0 --url https://…/Coffre.app.tar.gz \
 *     --signature-file Coffre.app.tar.gz.sig --notes "…" --out latest.json
 *
 *   bun scripts/updater-manifest.ts should-replace --current old.json --next new.json
 *     → code de sortie 0 si `next` est plus récent (ou `current` absent), 1 sinon.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  buildManifest,
  shouldReplaceChannel,
  type UpdaterManifest,
} from '../src/lib/updaterManifest'

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 ? process.argv[index + 1] : undefined
}

function required(name: string): string {
  const value = option(name)
  if (!value) {
    console.error(`Option requise : --${name}`)
    process.exit(2)
  }
  return value
}

function readManifest(path: string | undefined): UpdaterManifest | null {
  if (!path || !existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as UpdaterManifest
  } catch {
    return null
  }
}

const command = process.argv[2]

if (command === 'build') {
  const platforms = option('platforms')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const manifest = buildManifest({
    version: required('version'),
    url: required('url'),
    signature: readFileSync(required('signature-file'), 'utf8'),
    notes: option('notes') ?? '',
    pubDate: new Date(),
    platforms: platforms && platforms.length > 0 ? platforms : undefined,
  })
  writeFileSync(required('out'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Manifeste ${manifest.version} écrit dans ${option('out')}`)
} else if (command === 'should-replace') {
  const next = readManifest(required('next'))
  if (!next) {
    console.error('Manifeste suivant illisible.')
    process.exit(2)
  }
  const current = readManifest(option('current'))
  const replace = shouldReplaceChannel(current, next)
  console.log(
    replace
      ? `Le canal passe à ${next.version}.`
      : `Le canal reste à ${current?.version} (plus récent que ${next.version}).`,
  )
  process.exit(replace ? 0 : 1)
} else {
  console.error('Commande inconnue : build ou should-replace.')
  process.exit(2)
}
