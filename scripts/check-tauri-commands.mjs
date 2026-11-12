// Vérifie que chaque commande Tauri appelée par l’interface est réellement
// joignable : enregistrée dans `generate_handler!`, déclarée dans le manifeste
// d’application de `build.rs` et autorisée par la capacité de la fenêtre.
//
// Une commande absente de l’une de ces trois listes compile, passe les tests,
// puis est refusée à l’exécution. Ce contrôle rend l’oubli visible avant la
// fusion.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

function sourceFiles(dir) {
  const files = []
  for (const entry of readdirSync(join(root, dir))) {
    const path = join(dir, entry)
    if (statSync(join(root, path)).isDirectory()) files.push(...sourceFiles(path))
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(path)
  }
  return files
}

// Commandes appelées par l’interface : invoke('nom') ou invoke<T>('nom').
const invoked = new Map()
for (const file of sourceFiles('src')) {
  const text = read(file)
  for (const match of text.matchAll(/\binvoke(?:<[^(]*>)?\(\s*['"]([a-z0-9_]+)['"]/g)) {
    if (!invoked.has(match[1])) invoked.set(match[1], file)
  }
}

function block(text, start, end, label) {
  const from = text.indexOf(start)
  const to = from === -1 ? -1 : text.indexOf(end, from)
  if (from === -1 || to === -1) {
    console.error(`Commandes Tauri : bloc introuvable (${label}).`)
    process.exit(1)
  }
  return text.slice(from + start.length, to)
}

const handlerBlock = block(
  read('src-tauri/src/lib.rs'),
  'tauri::generate_handler![',
  ']',
  'generate_handler! dans lib.rs',
)
const registered = new Set(
  [...handlerBlock.matchAll(/([a-z0-9_]+)\s*(?:,|$)/g)].map((match) => match[1]),
)

const manifestBlock = block(read('src-tauri/build.rs'), '.commands(&[', ']', 'commands dans build.rs')
const declared = new Set([...manifestBlock.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]))

const capability = JSON.parse(read('src-tauri/capabilities/default.json'))
const allowed = new Set(
  capability.permissions.filter((permission) => typeof permission === 'string'),
)

const problems = []
for (const [command, file] of [...invoked].sort()) {
  const missing = []
  if (!registered.has(command)) missing.push('generate_handler! (src-tauri/src/lib.rs)')
  if (!declared.has(command)) missing.push('commands (src-tauri/build.rs)')
  if (!allowed.has(`allow-${command.replaceAll('_', '-')}`)) {
    missing.push('permissions (src-tauri/capabilities/default.json)')
  }
  if (missing.length > 0) {
    problems.push(`  ${command} (appelée dans ${file}) manque dans : ${missing.join(' ; ')}`)
  }
}
// Une commande déclarée mais jamais enregistrée ne peut pas fonctionner non plus.
for (const command of [...declared].sort()) {
  if (!registered.has(command)) {
    problems.push(`  ${command} est déclarée dans build.rs mais absente de generate_handler!`)
  }
}

if (problems.length > 0) {
  console.error('Commandes Tauri injoignables :')
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`Commandes Tauri : ${invoked.size} commandes appelées, toutes autorisées.`)
