/**
 * Générateur de mots de passe autonome.
 *
 * Ce module ne dépend pas de la liste EFF afin de pouvoir être embarqué dans
 * l’extension sans charger la wordlist complète.
 */

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/'
const AMBIGUOUS = new Set(['O', '0', 'o', 'I', 'l', '1', '|', '`', "'", '"'])

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

export function randomInt(maxExclusive: number): number {
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

  for (const set of activeSets) {
    if (result.length < length) result.push(pick(set))
  }
  while (result.length < length) result.push(pick(all))

  return shuffle(result).join('')
}

export function generatedEntropy(options: PasswordOptions): number {
  let pool = 0
  if (options.lowercase) pool += 26
  if (options.uppercase) pool += 26
  if (options.digits) pool += 10
  if (options.symbols) pool += SYMBOLS.length
  if (options.excludeAmbiguous) pool -= 10
  return Math.max(0, Math.round(Math.log2(Math.max(pool, 1)) * options.length))
}
