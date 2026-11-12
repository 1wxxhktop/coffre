// Copie l’extension construite (dist-extension/) dans les ressources de
// l’application desktop, pour qu’elle soit embarquée dans le paquet. Lancé par
// `beforeBuildCommand` de Tauri, après `bun run extension:build`.
//
// L’application recopie ensuite ce dossier dans son dossier de données et le
// tient à jour : c’est lui que l’utilisateur charge dans son navigateur.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'dist-extension')
const target = join(root, 'src-tauri', 'resources', 'extension')
const KEEP = '.gitkeep'

if (!existsSync(join(source, 'manifest.json'))) {
  console.error('dist-extension/manifest.json est absent : lancez `bun run extension:build`.')
  process.exit(1)
}

/**
 * Traduit la version de build en version d’extension Chromium.
 *
 * Chrome n’accepte que 1 à 4 nombres séparés par des points, chacun inférieur
 * ou égal à 65535. Une bêta `0.15.0-beta.6.1` devient `0.15.0.6` : le numéro de
 * run change à chaque bêta, donc la copie gérée par l’application est remplacée
 * et l’extension se recharge dans le navigateur.
 */
function chromeVersion(buildVersion) {
  const version = buildVersion.trim()
  const beta = /^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)(?:\.\d+)?$/.exec(version)
  if (!beta) {
    const valid = /^\d+(?:\.\d+){0,3}$/.test(version)
    if (!valid) {
      throw new Error(`Version de build invalide pour l’extension : ${version}`)
    }
    return version
  }
  const [, major, minor, patch, run] = beta.map(Number)
  const build = run
  if (build > 65535) {
    throw new Error(
      `Numéro de run ${build} trop grand pour une version d’extension Chromium.`,
    )
  }
  return `${major}.${minor}.${patch}.${build}`
}

mkdirSync(target, { recursive: true })
for (const entry of readdirSync(target)) {
  if (entry !== KEEP) rmSync(join(target, entry), { recursive: true, force: true })
}
cpSync(source, target, { recursive: true })

const buildVersion = process.env.COFFRE_BUILD_VERSION?.trim()
if (buildVersion) {
  const manifestPath = join(target, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.version = chromeVersion(buildVersion)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Extension ${manifest.version} copiée dans ${target}`)
} else {
  console.log(`Extension copiée dans ${target}`)
}
