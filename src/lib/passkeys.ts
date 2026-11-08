/**
 * Passkeys WebAuthn (ES256) côté application Coffre.
 *
 * La clé privée ne quitte jamais l’application : le content script relaie les
 * options publiques, l’application crée ou signe, puis renvoie uniquement les
 * données WebAuthn destinées à la page.
 */

import { sha256 } from './crypto'
import { encodeCbor, type CborValue } from './cbor'
import type { PasskeyItem } from './types'

export class PasskeyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PasskeyError'
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const BASE64URL = /^[A-Za-z0-9_-]+$/
const AAGUID = Uint8Array.of(
  0xc0,
  0xff,
  0xee,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x01,
)

/**
 * Suffixes publics multi-étiquettes les plus courants. Une liste complète
 * (Public Suffix List) serait préférable ; cette liste couvre les cas usuels
 * et rejette surtout les suffixes à une seule étiquette.
 */
const PUBLIC_SUFFIXES = new Set([
  'com',
  'net',
  'org',
  'io',
  'co',
  'dev',
  'app',
  'ai',
  'fr',
  'de',
  'uk',
  'us',
  'ca',
  'au',
  'jp',
  'cn',
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'co.nz',
  'co.jp',
  'com.br',
  'com.mx',
  'co.in',
  'com.cn',
  'github.io',
  'gitlab.io',
  'pages.dev',
  'workers.dev',
  'appspot.com',
  'herokuapp.com',
  'netlify.app',
  'vercel.app',
  'web.app',
  'firebaseapp.com',
  'azurewebsites.net',
  'cloudfront.net',
])

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function toBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Convertit une chaîne base64 standard en base64url, sans re-encoder. */
export function base64ToBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array {
  if (!BASE64URL.test(value)) throw new PasskeyError('Base64url invalide')
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return decodeBase64(padded + padding)
}

/**
 * Recalcule la clé publique COSE ES256 à partir d’une clé privée PKCS#8
 * (base64 standard). Utilisé par l’import CXF, qui ne transporte que la clé
 * privée.
 */
export async function publicKeyCoseFromPrivateKey(
  privateKeyBase64: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodeBase64(privateKeyBase64) as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', key)
  if (!jwk.x || !jwk.y) throw new PasskeyError('Clé privée P-256 invalide')
  const x = fromBase64Url(jwk.x)
  const y = fromBase64Url(jwk.y)
  if (x.length !== 32 || y.length !== 32) {
    throw new PasskeyError('Clé publique P-256 invalide')
  }
  const publicKey = new Uint8Array(65)
  publicKey[0] = 0x04
  publicKey.set(x, 1)
  publicKey.set(y, 33)
  return encodeBase64(cosePublicKey(publicKey))
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function uint32(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  )
}

function isIpAddress(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')
}

function secureOrigin(origin: string): URL {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new PasskeyError('Origine WebAuthn invalide')
  }
  const local =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new PasskeyError(
      'WebAuthn exige une origine sécurisée (HTTPS ou localhost).',
    )
  }
  return url
}

/**
 * Vérifie que `rpId` est le domaine de l’origine ou un parent enregistrable.
 * Refuse les suffixes publics (`com`, `github.io`), les IP et les domaines
 * d’une seule étiquette hors `localhost`.
 */
export function isValidRpId(rpId: string, origin: string): boolean {
  const value = rpId.trim().toLowerCase()
  if (!value || value.length > 253 || value.includes('/')) return false
  if (isIpAddress(value)) return false
  if (PUBLIC_SUFFIXES.has(value)) return false
  if (value !== 'localhost' && !value.includes('.')) return false

  const url = secureOrigin(origin)
  const host = url.hostname.toLowerCase()
  if (value === host) return true
  return host.endsWith(`.${value}`)
}

export interface PasskeyCreateInput {
  rpId: string
  origin: string
  challenge: string
  userName: string
  userHandle?: string
}

export interface CreatedPasskey {
  credentialId: string
  userHandle: string
  privateKey: string
  publicKeyCose: string
  clientDataJSON: string
  authenticatorData: string
  attestationObject: string
  signCount: number
}

function clientData(
  type: 'webauthn.create' | 'webauthn.get',
  challenge: string,
  origin: string,
): Uint8Array {
  if (!BASE64URL.test(challenge)) {
    throw new PasskeyError('Challenge WebAuthn invalide')
  }
  return encoder.encode(
    JSON.stringify({
      type,
      challenge,
      origin,
      crossOrigin: false,
    }),
  )
}

function cosePublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new PasskeyError('Clé publique P-256 invalide')
  }
  const map = new Map<CborValue, CborValue>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, publicKey.slice(1, 33)],
    [-3, publicKey.slice(33, 65)],
  ])
  return encodeCbor(map)
}

/** Crée une paire ECDSA P-256 et les données d’attestation `none`. */
export async function createPasskey(
  input: PasskeyCreateInput,
): Promise<CreatedPasskey> {
  if (!isValidRpId(input.rpId, input.origin)) {
    throw new PasskeyError('RP ID non autorisé pour cette origine')
  }
  const rpId = input.rpId.trim().toLowerCase()
  const challenge = input.challenge
  const credentialIdBytes = randomBytes(32)
  const credentialId = toBase64Url(credentialIdBytes)
  const userHandle = input.userHandle
    ? input.userHandle
    : toBase64Url(randomBytes(16))
  if (!BASE64URL.test(userHandle) || userHandle.length > 500) {
    throw new PasskeyError('Identifiant utilisateur WebAuthn invalide')
  }

  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const privateKey = encodeBase64(
    new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
  )
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey),
  )
  const publicKeyCose = encodeBase64(cosePublicKey(publicKey))

  const rpIdHash = await sha256(encoder.encode(rpId))
  // UP | AT | BE | BS : présence utilisateur, credential, backup eligible/state.
  const flags = 0x59
  const count = 0
  const credentialLength = Uint8Array.of(
    (credentialIdBytes.length >> 8) & 0xff,
    credentialIdBytes.length & 0xff,
  )
  const authenticatorData = concat(
    rpIdHash,
    Uint8Array.of(flags),
    uint32(count),
    AAGUID,
    credentialLength,
    credentialIdBytes,
    cosePublicKey(publicKey),
  )

  const client = clientData('webauthn.create', challenge, input.origin)
  const attestationObject = encodeCbor(
    new Map<CborValue, CborValue>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authenticatorData],
    ]),
  )

  return {
    credentialId,
    userHandle,
    privateKey,
    publicKeyCose,
    clientDataJSON: toBase64Url(client),
    authenticatorData: toBase64Url(authenticatorData),
    attestationObject: toBase64Url(attestationObject),
    signCount: count,
  }
}

export interface PasskeyGetInput {
  rpId: string
  origin: string
  challenge: string
}

export interface PasskeyAssertion {
  credentialId: string
  userHandle: string
  clientDataJSON: string
  authenticatorData: string
  signature: string
  signCount: number
}

function rawSignatureToDer(signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) {
    throw new PasskeyError('Signature ECDSA brute invalide')
  }
  const integer = (bytes: Uint8Array): Uint8Array => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    let value = bytes.subarray(start)
    if (value[0] & 0x80) value = concat(Uint8Array.of(0), value)
    return concat(Uint8Array.of(0x02, value.length), value)
  }
  const r = integer(signature.slice(0, 32))
  const s = integer(signature.slice(32, 64))
  return concat(Uint8Array.of(0x30, r.length + s.length), r, s)
}

/** Convertit une signature DER en r‖s, pour les tests et WebCrypto. */
export function derSignatureToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30 || der[1] !== der.length - 2 || der[2] !== 0x02) {
    throw new PasskeyError('Signature DER invalide')
  }
  const readInteger = (offset: number): { value: Uint8Array; next: number } => {
    const length = der[offset + 1]
    const value = der.subarray(offset + 2, offset + 2 + length)
    return { value, next: offset + 2 + length }
  }
  const first = readInteger(2)
  const second = readInteger(first.next)
  const normalize = (value: Uint8Array): Uint8Array => {
    let start = 0
    while (start < value.length - 1 && value[start] === 0) start++
    const trimmed = value.subarray(start)
    const result = new Uint8Array(32)
    result.set(trimmed.subarray(Math.max(0, trimmed.length - 32)), Math.max(0, 32 - trimmed.length))
    return result
  }
  return concat(normalize(first.value), normalize(second.value))
}

/** Signe une assertion avec la clé privée d’une passkey stockée. */
export async function signPasskey(
  item: PasskeyItem,
  input: PasskeyGetInput,
): Promise<PasskeyAssertion> {
  if (item.type !== 'passkey') throw new PasskeyError('Élément passkey attendu')
  if (!isValidRpId(input.rpId, input.origin)) {
    throw new PasskeyError('RP ID non autorisé pour cette origine')
  }
  if (item.rpId.toLowerCase() !== input.rpId.toLowerCase()) {
    throw new PasskeyError('Cette passkey n’appartient pas à ce domaine')
  }

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    decodeBase64(item.privateKey) as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const rpIdHash = await sha256(encoder.encode(item.rpId.toLowerCase()))
  // Les passkeys logicielles de Coffre utilisent un compteur nul, comme de
  // nombreux authentificateurs de plateforme : le serveur ne peut pas s’appuyer
  // sur un compteur croissant pour détecter un clonage.
  const signCount = item.signCount
  const authenticatorData = concat(
    rpIdHash,
    Uint8Array.of(0x01),
    uint32(signCount),
  )
  const client = clientData('webauthn.get', input.challenge, input.origin)
  const clientHash = await sha256(client)
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      concat(authenticatorData, clientHash) as BufferSource,
    ),
  )

  return {
    credentialId: item.credentialId,
    userHandle: item.userHandle,
    clientDataJSON: toBase64Url(client),
    authenticatorData: toBase64Url(authenticatorData),
    signature: toBase64Url(rawSignatureToDer(signature)),
    signCount,
  }
}

export function decodeClientData(value: string): {
  type: string
  challenge: string
  origin: string
} {
  return JSON.parse(decoder.decode(fromBase64Url(value))) as {
    type: string
    challenge: string
    origin: string
  }
}
