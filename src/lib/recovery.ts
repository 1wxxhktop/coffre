/**
 * Phrase de récupération optionnelle.
 *
 * Dix mots de la liste EFF « large wordlist » (7 776 mots) : environ 129 bits
 * d’entropie, soit bien au-delà de ce qu’un attaquant peut parcourir même avec
 * l’enveloppe Argon2id. La phrase n’est jamais stockée : elle sert uniquement à
 * dériver la clé qui ouvre `RecoveryEnvelope.key`.
 */

import { generatePassphrase } from './generator'

/** Nombre de mots d’une phrase de récupération. */
export const RECOVERY_WORDS = 10

export function generateRecoveryPhrase(): string {
  return generatePassphrase({
    words: RECOVERY_WORDS,
    separator: ' ',
    capitalize: false,
    includeNumber: false,
  })
}

/**
 * Normalise une phrase saisie : espaces multiples, retours à la ligne, casse et
 * espaces de bord sont neutralisés. L’ordre des mots reste significatif.
 */
export function normalizeRecoveryPhrase(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ')
}

export function isRecoveryPhrase(value: string): boolean {
  const words = normalizeRecoveryPhrase(value).split(' ').filter(Boolean)
  return words.length === RECOVERY_WORDS && words.every((word) => word.length >= 3)
}
