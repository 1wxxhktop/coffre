/**
 * Codes d’erreur stables des sauvegardes planifiées.
 *
 * Ils sont les seuls conservés dans les préférences et affichés par
 * l’interface. Un message natif, un chemin ou un secret ne doit jamais y être
 * enregistré.
 */
export const BACKUP_ERROR_CODES = new Set([
  'desktop-only',
  'missing-folder',
  'not-a-directory',
  'invalid-name',
  'symlink-refused',
  'invalid-backup',
  'no-vault',
  'invalid-vault',
  'vault-too-large',
  'copy-verification-failed',
  'backup-failed',
  'no-folder',
  'travel',
  'integrity-check-failed',
])

export function isBackupErrorCode(value: unknown): value is string {
  return typeof value === 'string' && BACKUP_ERROR_CODES.has(value)
}
