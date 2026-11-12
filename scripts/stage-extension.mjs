// Copie l’extension construite (dist-extension/) dans les ressources de
// l’application desktop, pour qu’elle soit embarquée dans le paquet. Lancé par
// `beforeBuildCommand` de Tauri, après `bun run extension:build`.
//
// L’application recopie ensuite ce dossier dans son dossier de données et le
// tient à jour : c’est lui que l’utilisateur charge dans son navigateur.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
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

mkdirSync(target, { recursive: true })
for (const entry of readdirSync(target)) {
  if (entry !== KEEP) rmSync(join(target, entry), { recursive: true, force: true })
}
cpSync(source, target, { recursive: true })
console.log(`Extension copiée dans ${target}`)
