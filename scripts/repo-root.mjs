// Racine du dépôt principal, même quand un script est lancé depuis un
// worktree : tous les worktrees partagent le dossier .git du dépôt principal.
// Le dossier `release/` n’existe qu’à cette racine (voir collect-release.sh).

import { execFileSync } from 'node:child_process'
import { basename, dirname } from 'node:path'

export function mainRepoRoot(fallback) {
  try {
    const commonDir = execFileSync(
      'git',
      ['-C', fallback, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    return basename(commonDir) === '.git' ? dirname(commonDir) : fallback
  } catch {
    return fallback
  }
}
