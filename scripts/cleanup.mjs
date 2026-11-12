#!/usr/bin/env node
/**
 * Nettoyage local de Coffre.
 *
 * Objectif : supprimer les artefacts générés, les caches et les worktrees
 * orphelins sans jamais toucher aux sources, aux coffres `.coffre`, aux
 * secrets ou à `node_modules`.
 *
 * Usage :
 *   bun run clean                 artefacts de build/test (release/ conservé)
 *   bun run clean:build           + cible Rust et caches locales
 *   bun run clean:all             + caches globales (Bun, Playwright, Cargo)
 *   bun run clean:worktrees       + worktrees Git propres sous .claude/
 *   bun run clean -- --dry-run    afficher ce qui serait supprimé
 *
 * Le dossier release/ n’est jamais supprimé : il conserve toujours la dernière
 * version collectée. Utiliser `bun run release:update` pour l’actualiser.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readlinkSync, readdirSync, rmSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = new Set(process.argv.slice(2))
const known = new Set(['--dry-run', '--build', '--caches', '--worktrees', '--all', '--help'])

for (const arg of argv) {
  if (!known.has(arg)) {
    console.error(`Erreur : option inconnue « ${arg} ».`)
    process.exit(2)
  }
}

if (argv.has('--help')) {
  console.log(`Usage : bun run clean [options]

  --dry-run    Affiche les éléments qui seraient supprimés, sans rien effacer.
  --build      Supprime aussi la cible Rust et les caches locales de build.
  --caches     Supprime les caches globaux (Bun, Playwright, Cargo, Tauri).
  --worktrees  Supprime les worktrees Git propres sous .claude/worktrees.
  --all        Équivalent à --build --caches.

Ne supprime jamais les sources, les fichiers .coffre, les secrets, node_modules
ni le dossier release/.`)
  process.exit(0)
}

const dryRun = argv.has('--dry-run')
const all = argv.has('--all')
const withBuild = all || argv.has('--build')
const withCaches = all || argv.has('--caches')
const withWorktrees = argv.has('--worktrees')

let reclaimed = 0
let errors = 0

function human(bytes) {
  if (!bytes) return '0 o'
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

/** Taille récursive sans suivre les liens symboliques. */
function sizeOf(path) {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return stat.size
    let total = 0
    for (const entry of readdirSync(path)) total += sizeOf(join(path, entry))
    return total
  } catch {
    return 0
  }
}

/** Garde-fou : ne jamais sortir du dépôt pour les cibles projet. */
function isInsideRoot(path) {
  const rel = relative(ROOT, path)
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..'
}

/** Garde-fou : ne jamais supprimer un fichier suivi par Git. */
function hasTrackedFiles(path) {
  if (!isInsideRoot(path)) return false
  try {
    return execFileSync('git', ['ls-files', '--', relative(ROOT, path)], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().length > 0
  } catch {
    return false
  }
}

/** Garde-fou : ne jamais supprimer un coffre, un secret ou une clé. */
function isSensitiveName(path) {
  const name = path.split(sep).pop() ?? ''
  return (
    /\.(coffre|coffre-share|pem|key|p12|pfx|mobileprovision)$/i.test(name) ||
    name === '.env' ||
    name.startsWith('.env.')
  )
}

function containsSensitiveFiles(path) {
  try {
    const stat = lstatSync(path)
    if (!stat.isDirectory()) return isSensitiveName(path)
    for (const entry of readdirSync(path)) {
      if (containsSensitiveFiles(join(path, entry))) return true
    }
  } catch {
    return false
  }
  return false
}

function remove(path, label) {
  if (!existsSync(path)) return
  if (!isInsideRoot(path)) {
    console.warn(`⚠ ${label} : hors du dépôt, ignoré (${path}).`)
    return
  }
  if (hasTrackedFiles(path)) {
    console.warn(`⚠ ${label} : contient des fichiers suivis par Git, ignoré.`)
    return
  }
  if (containsSensitiveFiles(path)) {
    console.warn(`⚠ ${label} : contient un coffre, un secret ou une clé, ignoré.`)
    return
  }

  const bytes = sizeOf(path)
  if (dryRun) {
    console.log(`… ${label} — ${human(bytes)} (dry-run)`)
    return
  }

  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    reclaimed += bytes
    console.log(`✓ ${label} — ${human(bytes)}`)
  } catch (error) {
    errors += 1
    console.warn(`⚠ ${label} : suppression impossible (${error.code ?? error.message}).`)
  }
}

/** Suppression d’un cache global : chemin explicitement autorisé sous $HOME. */
function removeGlobal(path, label) {
  if (!existsSync(path)) return
  if (!path.startsWith(`${homedir()}${sep}`)) {
    console.warn(`⚠ ${label} : hors du dossier personnel, ignoré.`)
    return
  }

  const bytes = sizeOf(path)
  if (dryRun) {
    console.log(`… ${label} — ${human(bytes)} (dry-run)`)
    return
  }

  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    reclaimed += bytes
    console.log(`✓ ${label} — ${human(bytes)}`)
  } catch (error) {
    errors += 1
    console.warn(`⚠ ${label} : suppression impossible (${error.code ?? error.message}).`)
  }
}

function removeStagedExtension() {
  const staged = join(ROOT, 'src-tauri/resources/extension')
  if (!existsSync(staged)) return
  for (const entry of readdirSync(staged)) {
    if (entry === '.gitkeep') continue
    remove(join(staged, entry), `extension stagée — ${entry}`)
  }
}

function removeDsStore(dir = ROOT) {
  const skipped = new Set([
    '.git',
    '.claude',
    'node_modules',
    'target',
    'dist',
    'dist-extension',
    'coverage',
    'release',
  ])
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (skipped.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      removeDsStore(path)
    } else if (entry.name === '.DS_Store') {
      remove(path, relative(ROOT, path))
    }
  }
}

console.log(
  `Nettoyage de Coffre${dryRun ? ' (simulation)' : ''}${withBuild ? ' · build' : ''}${
    withCaches ? ' · caches' : ''
  }${withWorktrees ? ' · worktrees' : ''}\n`,
)

// Artefacts de build et de test. Ils sont tous reproductibles.
const artifacts = [
  ['dist', 'build Web/PWA'],
  ['dist-extension', 'build extension'],
  ['coverage', 'rapport de couverture'],
  ['test-results', 'résultats Playwright'],
  ['playwright-report', 'rapport Playwright'],
  ['blob-report', 'rapport Playwright blob'],
  ['sbom', 'SBOM générés'],
  ['.tauri', 'cache Tauri local'],
]

for (const [path, label] of artifacts) remove(join(ROOT, path), label)
removeStagedExtension()
removeDsStore()

// release/ est volontairement exclu : il doit toujours conserver la dernière
// version collectée. On se contente de rappeler son état.
const releaseDir = join(ROOT, 'release')
if (existsSync(releaseDir)) {
  let target = ''
  try {
    target = readlinkSync(join(releaseDir, 'latest'))
  } catch {
    // Pas de lien `latest` (ou système sans lien symbolique) : le dossier reste
    // conservé, on ne tente pas de le recréer ici.
  }
  console.log(`↷ release/ conservé${target ? ` — ${target}` : ''}`)
} else {
  console.log('↷ release/ absent — lancer bun run release:update pour collecter la dernière version.')
}

if (withBuild) {
  remove(join(ROOT, 'src-tauri/target'), 'cible Rust (target)')
  remove(join(ROOT, 'src-tauri/gen'), 'schémas Tauri générés')
  remove(join(ROOT, 'src-tauri/permissions/autogenerated'), 'permissions Tauri générées')
  remove(join(ROOT, 'node_modules/.vite'), 'cache Vite')
  remove(join(ROOT, 'node_modules/.cache'), 'cache locale node_modules')
}

if (withCaches) {
  // Cache Bun : la commande officielle évite de supprimer un cache en cours
  // d’utilisation. On mesure avant pour afficher le gain.
  const bunCache = join(homedir(), '.bun/install/cache')
  if (existsSync(bunCache)) {
    const bytes = sizeOf(bunCache)
    if (dryRun) {
      console.log(`… cache Bun — ${human(bytes)} (dry-run)`)
    } else {
      try {
        execFileSync('bun', ['pm', 'cache', 'rm'], { cwd: ROOT, stdio: 'ignore' })
        reclaimed += bytes
        console.log(`✓ cache Bun — ${human(bytes)}`)
      } catch {
        errors += 1
        console.warn('⚠ cache Bun : suppression impossible.')
      }
    }
  }

  const localCache = platform() === 'darwin'
    ? join(homedir(), 'Library/Caches')
    : platform() === 'win32'
      ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'))
      : join(homedir(), '.cache')

  removeGlobal(join(localCache, 'ms-playwright'), 'navigateurs Playwright')
  removeGlobal(join(localCache, 'tauri'), 'cache Tauri globale')
  removeGlobal(join(homedir(), '.cargo/registry/cache'), 'cache des crates Cargo')
}

if (withWorktrees) {
  let porcelain = ''
  try {
    porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
  } catch {
    errors += 1
    console.warn('⚠ worktrees : impossible de lister les worktrees Git.')
  }

  for (const block of porcelain.trim().split('\n\n')) {
    if (!block) continue
    const lines = block.split('\n')
    const pathLine = lines.find((line) => line.startsWith('worktree '))
    if (!pathLine) continue
    const path = pathLine.slice('worktree '.length)
    const rel = relative(ROOT, path)
    if (path === ROOT || !rel.startsWith(`.claude${sep}worktrees${sep}`)) continue

    let status = ''
    try {
      status = execFileSync('git', ['-C', path, 'status', '--porcelain'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      continue
    }

    if (status) {
      console.log(`↷ worktree conservé (modifications locales) : ${rel}`)
      continue
    }

    if (dryRun) {
      console.log(`… worktree propre — ${rel} — ${human(sizeOf(path))} (dry-run)`)
      continue
    }

    const bytes = sizeOf(path)
    try {
      if (lines.some((line) => line === 'locked' || line.startsWith('locked '))) {
        execFileSync('git', ['worktree', 'unlock', path], { cwd: ROOT, stdio: 'ignore' })
      }
      execFileSync('git', ['worktree', 'remove', '--force', path], {
        cwd: ROOT,
        stdio: 'ignore',
      })
      reclaimed += bytes
      console.log(`✓ worktree propre — ${rel} — ${human(bytes)}`)
    } catch {
      errors += 1
      console.warn(`⚠ worktree ${rel} : suppression impossible.`)
    }
  }

  if (!dryRun) {
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: ROOT, stdio: 'ignore' })
    } catch {
      errors += 1
      console.warn('⚠ worktrees : prune impossible.')
    }
  }
}

if (!dryRun) {
  console.log(
    reclaimed > 0 ? `\nEspace libéré : ${human(reclaimed)}` : '\nRien à nettoyer.',
  )
}

if (errors > 0) {
  console.error(`\n${errors} élément(s) n’ont pas pu être nettoyés.`)
  process.exitCode = 1
}
