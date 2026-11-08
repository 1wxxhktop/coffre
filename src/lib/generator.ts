/**
 * Générateur de mots de passe et de phrases de passe.
 *
 * Les fonctions de mot de passe sont réexportées depuis `password.ts`, sans
 * charger la liste EFF. Le tirage uniforme par rejet évite tout biais modulo.
 */

import wordlistRaw from '../assets/eff_large_wordlist.txt?raw'
import { randomInt } from './password'

export {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
  generatedEntropy,
} from './password'
export type { PasswordOptions } from './password'

export const EFF_WORDS: string[] = wordlistRaw
  .split('\n')
  .map((line) => line.trim().split(/\s+/)[1])
  .filter((word): word is string => Boolean(word))

export interface PassphraseOptions {
  words: number
  separator: string
  capitalize: boolean
  includeNumber: boolean
}

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: 5,
  separator: '-',
  capitalize: true,
  includeNumber: true,
}

export function generatePassphrase(
  options: PassphraseOptions = DEFAULT_PASSPHRASE_OPTIONS,
): string {
  const count = Math.min(12, Math.max(3, Math.round(options.words)))
  const separator = options.separator.slice(0, 3) || '-'
  const words: string[] = []

  for (let i = 0; i < count; i++) {
    let word = EFF_WORDS[randomInt(EFF_WORDS.length)]
    if (options.capitalize) word = word.charAt(0).toUpperCase() + word.slice(1)
    words.push(word)
  }

  if (options.includeNumber) {
    words[words.length - 1] += String(randomInt(100)).padStart(2, '0')
  }

  return words.join(separator)
}

export function passphraseEntropy(options: PassphraseOptions): number {
  const words = Math.min(12, Math.max(3, Math.round(options.words)))
  return Math.round(words * Math.log2(EFF_WORDS.length) + (options.includeNumber ? 6.6 : 0))
}

export function wordlistSize(): number {
  return EFF_WORDS.length
}
