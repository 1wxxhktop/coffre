/**
 * Générateur de mots de passe et de phrases de passe.
 *
 * Tirage uniforme par rejet (pas de biais modulo), garantie qu’au moins un
 * caractère de chaque classe sélectionnée est présent. La liste de mots est
 * la liste EFF « large wordlist » (7 776 mots, ~12,9 bits/mot), également
 * utilisée par Proton Pass.
 */

import wordlistRaw from '../assets/eff_large_wordlist.txt?raw'

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/'
const AMBIGUOUS = new Set(['O', '0', 'o', 'I', 'l', '1', '|', '`', "'", '"'])

export const EFF_WORDS: string[] = wordlistRaw
  .split('\n')
  .map((line) => line.trim().split(/\s+/)[1])
  .filter((word): word is string => Boolean(word))

export interface PasswordOptions {
  length: number
  lowercase: boolean
  uppercase: boolean
  digits: boolean
  symbols: boolean
  excludeAmbiguous: boolean
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
}

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

function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
    throw new RangeError('Borne aléatoire invalide')
  }
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive
  const buffer = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]
  } while (value >= limit)
  return value % maxExclusive
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)]
}

function filterAmbiguous(chars: string, enabled: boolean): string {
  if (!enabled) return chars
  return Array.from(chars)
    .filter((char) => !AMBIGUOUS.has(char))
    .join('')
}

function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars
}

export function generatePassword(options: PasswordOptions = DEFAULT_PASSWORD_OPTIONS): string {
  const length = Math.min(128, Math.max(4, Math.round(options.length)))
  const sets: string[] = []

  if (options.lowercase) sets.push(filterAmbiguous(LOWERCASE, options.excludeAmbiguous))
  if (options.uppercase) sets.push(filterAmbiguous(UPPERCASE, options.excludeAmbiguous))
  if (options.digits) sets.push(filterAmbiguous(DIGITS, options.excludeAmbiguous))
  if (options.symbols) sets.push(filterAmbiguous(SYMBOLS, options.excludeAmbiguous))

  const activeSets = sets.filter((set) => set.length > 0)
  if (activeSets.length === 0) {
    throw new Error('Sélectionnez au moins une classe de caractères')
  }

  const all = activeSets.join('')
  const result: string[] = []

  // Un caractère de chaque classe pour garantir la composition annoncée.
  for (const set of activeSets) {
    if (result.length < length) result.push(pick(set))
  }
  while (result.length < length) result.push(pick(all))

  return shuffle(result).join('')
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

export function generatedEntropy(options: PasswordOptions): number {
  let pool = 0
  if (options.lowercase) pool += 26
  if (options.uppercase) pool += 26
  if (options.digits) pool += 10
  if (options.symbols) pool += SYMBOLS.length
  if (options.excludeAmbiguous) pool -= 10
  return Math.max(0, Math.round(Math.max(pool, 1) && Math.log2(Math.max(pool, 1)) * options.length))
}

export function passphraseEntropy(options: PassphraseOptions): number {
  const words = Math.min(12, Math.max(3, Math.round(options.words)))
  return Math.round(words * Math.log2(EFF_WORDS.length) + (options.includeNumber ? 6.6 : 0))
}

export function wordlistSize(): number {
  return EFF_WORDS.length
}
