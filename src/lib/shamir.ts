/**
 * Partage de secret de Shamir sur GF(256), pour la clé de récupération.
 *
 * Chaque part est un polynôme évalué en un point distinct. `k` parts
 * reconstituent le secret ; `k - 1` parts n’en révèlent rien. Les parts sont
 * encodées en mots de la liste EFF pour être recopiées à la main, et en un
 * payload compact pour les QR codes.
 *
 * Format d’une part (octets) :
 *   1 octet  version (1)
 *   1 octet  seuil k
 *   1 octet  index x (1 à n)
 *   1 octet  longueur du secret
 *   n octets  y (évaluations du polynôme)
 *   4 octets  somme de contrôle SHA-256 tronquée
 *
 * La somme de contrôle ne porte que sur la part : elle détecte une erreur de
 * recopie sans révéler d’information sur le secret.
 */

import { EFF_WORDS } from './generator'
import { fromBase64, sha256, toBase64 } from './crypto'

const VERSION = 1
const HEADER_BYTES = 4
const CHECKSUM_BYTES = 4
const WORD_BASE = BigInt(EFF_WORDS.length)
const MAX_SECRET_BYTES = 255

export class ShamirError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShamirError'
  }
}

export interface RecoveryShare {
  /** Numéro de la part, de 1 à total. */
  index: number
  /** Nombre de parts nécessaires. */
  threshold: number
  /** Nombre total de parts. */
  total: number
  /** Mots EFF séparés par des espaces. */
  words: string
  /** Payload compact pour un QR code. */
  payload: string
}

/* ------------------------------------------------------------------ */
/* Corps de Galois GF(256)                                             */
/* ------------------------------------------------------------------ */

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)

function xtime(value: number): number {
  const high = value & 0x80
  const shifted = (value << 1) & 0xff
  return high ? shifted ^ 0x1b : shifted
}

{
  let value = 1
  for (let exponent = 0; exponent < 255; exponent += 1) {
    EXP[exponent] = value
    LOG[value] = exponent
    // Générateur 3 : x ↦ x·3 dans GF(2^8).
    value = xtime(value) ^ value
  }
  for (let exponent = 255; exponent < EXP.length; exponent += 1) {
    EXP[exponent] = EXP[exponent - 255]
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new ShamirError('Division par zéro dans GF(256)')
  if (a === 0) return 0
  return EXP[LOG[a] + 255 - LOG[b]]
}

/* ------------------------------------------------------------------ */
/* Découpage et reconstitution                                         */
/* ------------------------------------------------------------------ */

function validateParameters(threshold: number, total: number): void {
  if (!Number.isInteger(threshold) || !Number.isInteger(total)) {
    throw new ShamirError('Le seuil et le nombre de parts doivent être entiers')
  }
  if (threshold < 2) throw new ShamirError('Le seuil doit être au moins de 2 parts')
  if (total < threshold) {
    throw new ShamirError('Le nombre de parts doit être supérieur ou égal au seuil')
  }
  if (total > 255) throw new ShamirError('255 parts au maximum')
}

function evaluate(coefficients: Uint8Array, x: number): number {
  let value = 0
  for (let index = coefficients.length - 1; index >= 0; index -= 1) {
    value = gfMul(value, x) ^ coefficients[index]
  }
  return value
}

async function checksum(share: Uint8Array): Promise<Uint8Array> {
  const digest = await sha256(share)
  return digest.slice(0, CHECKSUM_BYTES)
}

function shareWithoutChecksum(share: Uint8Array): Uint8Array {
  return share.slice(0, share.length - CHECKSUM_BYTES)
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

/**
 * Découpe `secret` en `total` parts, dont `threshold` sont nécessaires.
 * Les parts retournées sont dans l’ordre de leur index.
 */
export async function splitSecret(
  secret: Uint8Array,
  threshold: number,
  total: number,
): Promise<Uint8Array[]> {
  validateParameters(threshold, total)
  if (secret.length === 0) throw new ShamirError('Le secret est vide')
  if (secret.length > MAX_SECRET_BYTES) {
    throw new ShamirError(`${MAX_SECRET_BYTES} octets au maximum`)
  }

  // Un coefficient aléatoire par degré et par octet du secret.
  const coefficientCount = secret.length * (threshold - 1)
  const random = new Uint8Array(coefficientCount)
  crypto.getRandomValues(random)

  const shares: Uint8Array[] = []
  for (let index = 1; index <= total; index += 1) {
    const y = new Uint8Array(secret.length)
    for (let byte = 0; byte < secret.length; byte += 1) {
      const coefficients = new Uint8Array(threshold)
      coefficients[0] = secret[byte]
      for (let degree = 1; degree < threshold; degree += 1) {
        coefficients[degree] = random[byte * (threshold - 1) + degree - 1]
      }
      y[byte] = evaluate(coefficients, index)
    }

    const share = new Uint8Array(HEADER_BYTES + secret.length + CHECKSUM_BYTES)
    share[0] = VERSION
    share[1] = threshold
    share[2] = index
    share[3] = secret.length
    share.set(y, HEADER_BYTES)
    share.set(await checksum(shareWithoutChecksum(share)), HEADER_BYTES + secret.length)
    shares.push(share)
  }

  random.fill(0)
  return shares
}

interface ParsedShare {
  threshold: number
  index: number
  length: number
  y: Uint8Array
}

async function parseShare(share: Uint8Array): Promise<ParsedShare> {
  if (share.length < HEADER_BYTES + 1 + CHECKSUM_BYTES) {
    throw new ShamirError('Part trop courte')
  }
  if (share[0] !== VERSION) throw new ShamirError('Version de part inconnue')
  const threshold = share[1]
  const index = share[2]
  const length = share[3]
  if (threshold < 2) throw new ShamirError('Seuil de part invalide')
  if (index === 0) throw new ShamirError('Index de part invalide')
  if (length === 0) throw new ShamirError('Longueur de secret invalide')
  const expected = HEADER_BYTES + length + CHECKSUM_BYTES
  if (share.length !== expected) throw new ShamirError('Taille de part incohérente')

  const expectedChecksum = await checksum(shareWithoutChecksum(share))
  const actualChecksum = share.slice(share.length - CHECKSUM_BYTES)
  if (!equalBytes(expectedChecksum, actualChecksum)) {
    throw new ShamirError('Somme de contrôle invalide : la part a été mal recopiée')
  }

  return {
    threshold,
    index,
    length,
    y: share.slice(HEADER_BYTES, HEADER_BYTES + length),
  }
}

/** Reconstruit le secret à partir d’au moins `k` parts valides. */
export async function combineShares(shares: Uint8Array[]): Promise<Uint8Array> {
  if (shares.length < 2) throw new ShamirError('Au moins deux parts sont nécessaires')

  const parsed: ParsedShare[] = []
  const indices = new Set<number>()
  for (const share of shares) {
    const entry = await parseShare(share)
    if (indices.has(entry.index)) {
      throw new ShamirError('Deux parts portent le même numéro')
    }
    indices.add(entry.index)
    parsed.push(entry)
  }

  const threshold = parsed[0].threshold
  const length = parsed[0].length
  for (const entry of parsed) {
    if (entry.threshold !== threshold) {
      throw new ShamirError('Les parts n’ont pas le même seuil')
    }
    if (entry.length !== length) {
      throw new ShamirError('Les parts n’ont pas la même longueur')
    }
  }
  if (parsed.length < threshold) {
    throw new ShamirError(
      `${threshold} parts sont nécessaires ; ${parsed.length} ont été fournies`,
    )
  }

  // Interpolation de Lagrange en x = 0.
  const secret = new Uint8Array(length)
  for (let byte = 0; byte < length; byte += 1) {
    let value = 0
    for (let i = 0; i < parsed.length; i += 1) {
      let numerator = 1
      let denominator = 1
      for (let j = 0; j < parsed.length; j += 1) {
        if (i === j) continue
        numerator = gfMul(numerator, parsed[j].index)
        denominator = gfMul(denominator, parsed[i].index ^ parsed[j].index)
      }
      value ^= gfMul(parsed[i].y[byte], gfDiv(numerator, denominator))
    }
    secret[byte] = value
  }
  return secret
}

/* ------------------------------------------------------------------ */
/* Encodage en mots EFF                                                */
/* ------------------------------------------------------------------ */

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

function bigIntToBytes(value: bigint, minimumLength = 0): Uint8Array {
  const bytes: number[] = []
  let remaining = value
  while (remaining > 0n) {
    bytes.push(Number(remaining & 0xffn))
    remaining >>= 8n
  }
  while (bytes.length < minimumLength) bytes.push(0)
  return new Uint8Array(bytes.reverse())
}

const WORD_INDEX = new Map(EFF_WORDS.map((word, index) => [word, index]))

/** Encode un secret quelconque en mots EFF, séparés par des espaces. */
export function encodeSecretWords(bytes: Uint8Array): string {
  if (bytes.length === 0) throw new ShamirError('Secret vide')
  let value = bytesToBigInt(bytes)
  const words: string[] = []
  while (value > 0n) {
    words.push(EFF_WORDS[Number(value % WORD_BASE)])
    value /= WORD_BASE
  }
  if (words.length === 0) words.push(EFF_WORDS[0])
  return words.reverse().join(' ')
}

/**
 * Décode des mots EFF. `expectedLength` complète les zéros de tête perdus par
 * la conversion en grand entier (utile pour une clé de taille fixe).
 */
export function decodeSecretWords(text: string, expectedLength?: number): Uint8Array {
  const tokens = text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^a-z-]+/)
    .filter(Boolean)
  if (tokens.length === 0) throw new ShamirError('Aucun mot fourni')

  let value = 0n
  const append = (word: string) => {
    const index = WORD_INDEX.get(word)
    if (index === undefined) {
      throw new ShamirError(`Mot inconnu : « ${word} »`)
    }
    value = value * WORD_BASE + BigInt(index)
  }

  for (const token of tokens) {
    if (WORD_INDEX.has(token)) {
      append(token)
      continue
    }
    // Tolère des mots séparés par des tirets (« abacus-abdomen »). Les mots
    // EFF eux-mêmes peuvent contenir un tiret (« drop-down »), traité avant.
    const parts = token.split('-').filter(Boolean)
    if (parts.length > 1 && parts.every((part) => WORD_INDEX.has(part))) {
      for (const part of parts) append(part)
      continue
    }
    throw new ShamirError(`Mot inconnu : « ${token} »`)
  }

  return bigIntToBytes(value, expectedLength ?? 0)
}

/** Encode une part en mots EFF, séparés par des espaces. */
export function encodeShareWords(share: Uint8Array): string {
  return encodeSecretWords(share)
}

/** Décode une suite de mots EFF en part binaire. */
export function decodeShareWords(text: string): Uint8Array {
  const bytes = decodeSecretWords(text)
  if (bytes.length < HEADER_BYTES) {
    throw new ShamirError('Part incomplète')
  }
  const expected = HEADER_BYTES + bytes[3] + CHECKSUM_BYTES
  if (bytes.length !== expected) {
    throw new ShamirError('Part incomplète ou trop longue')
  }
  return bytes
}

/** Payload compact pour un QR code. */
export function shareToPayload(share: Uint8Array): string {
  const base64 = toBase64(share)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `coffre-share:v1:${base64}`
}

/** Décode un payload de QR code. */
export function payloadToShare(payload: string): Uint8Array {
  const match = /^coffre-share:v1:([A-Za-z0-9_-]+)$/i.exec(payload.trim())
  if (!match) throw new ShamirError('QR code de part invalide')
  const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return fromBase64(padded)
}

/** Accepte indifféremment les mots ou le payload d’un QR code. */
export function parseShareInput(text: string): Uint8Array {
  const trimmed = text.trim()
  if (trimmed.toLowerCase().startsWith('coffre-share:')) {
    return payloadToShare(trimmed)
  }
  return decodeShareWords(trimmed)
}

/** Regroupe les mots par blocs lisibles de cinq. */
export function groupShareWords(words: string, size = 5): string[] {
  const parts = words.split(' ').filter(Boolean)
  const groups: string[] = []
  for (let index = 0; index < parts.length; index += size) {
    groups.push(parts.slice(index, index + size).join(' '))
  }
  return groups
}
