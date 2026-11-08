/**
 * Primitives cryptographiques.
 *
 * Choix alignés sur ceux de Proton Pass :
 *  - Argon2id pour dériver la clé maîtresse ;
 *  - AES-256-GCM pour le chiffrement authentifié ;
 *  - nonce aléatoire de 12 octets préfixé au ciphertext ;
 *  - AAD de domaine (vaultkey, itemkey, itemcontent…) pour lier chaque
 *    ciphertext à son usage et empêcher les substitutions.
 *
 * Toute la crypto s'exécute localement, avec WebCrypto et hash-wasm.
 */

import { argon2id } from 'hash-wasm'
import type { KdfParams, Sealed } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const KDF_DEFAULTS = {
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 4,
  keyLength: 32,
} as const

/**
 * Bornes de sécurité appliquées aux paramètres lus dans un fichier ou fournis
 * par un appelant. Sans plafond, un fichier malveillant peut demander 1 Gio et
 * bloquer l’appareil.
 */
export const KDF_LIMITS = {
  minMemoryKiB: 8_192,
  maxMemoryKiB: 262_144,
  minIterations: 1,
  maxIterations: 6,
  minParallelism: 1,
  maxParallelism: 8,
} as const

export const NONCE_BYTES = 12
export const KEY_BYTES = 32

export class CryptoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CryptoError'
  }
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

export function randomId(prefix = ''): string {
  const bytes = randomBytes(16)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return prefix ? `${prefix}_${hex}` : hex
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function utf8(value: string): Uint8Array {
  return encoder.encode(value)
}

/** Efface une clé ou un buffer sensible lorsqu'on n'en a plus besoin. */
export function wipe(...buffers: Array<Uint8Array | undefined>): void {
  for (const buffer of buffers) {
    if (buffer) buffer.fill(0)
  }
}

export function newKdfParams(): KdfParams {
  return {
    algorithm: 'argon2id',
    salt: toBase64(randomBytes(16)),
    ...KDF_DEFAULTS,
  }
}

interface KdfWorkerRequest {
  id: number
  password: Uint8Array
  salt: Uint8Array
  memorySize: number
  iterations: number
  parallelism: number
  hashLength: number
}

let kdfWorker: Worker | null = null
let kdfWorkerUnavailable = false
let kdfRequestId = 0

function getKdfWorker(): Worker | null {
  if (kdfWorkerUnavailable || typeof Worker === 'undefined') return null
  if (kdfWorker) return kdfWorker
  try {
    kdfWorker = new Worker(new URL('./kdf.worker.ts', import.meta.url), {
      type: 'module',
    })
    kdfWorker.addEventListener('error', () => {
      kdfWorkerUnavailable = true
      kdfWorker?.terminate()
      kdfWorker = null
    })
    return kdfWorker
  } catch {
    kdfWorkerUnavailable = true
    return null
  }
}

function deriveInWorker(
  passwordBytes: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  const worker = getKdfWorker()
  if (!worker) return Promise.reject(new Error('Worker indisponible'))

  const id = ++kdfRequestId
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    const onMessage = (event: MessageEvent<{ id: number; hash?: ArrayBuffer; error?: string }>) => {
      if (event.data?.id !== id) return
      cleanup()
      if (event.data.error) {
        reject(new Error(event.data.error))
        return
      }
      resolve(new Uint8Array(event.data.hash ?? new ArrayBuffer(0)))
    }
    const onError = (event: ErrorEvent) => {
      cleanup()
      kdfWorkerUnavailable = true
      worker.terminate()
      kdfWorker = null
      reject(new Error(event.message || 'Worker KDF indisponible'))
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)

    // Les copies sont transférées au worker ; il les efface après usage.
    const passwordCopy = passwordBytes.slice()
    const saltCopy = fromBase64(params.salt)
    const request: KdfWorkerRequest = {
      id,
      password: passwordCopy,
      salt: saltCopy,
      memorySize: params.memoryKiB,
      iterations: params.iterations,
      parallelism: params.parallelism,
      hashLength: params.keyLength,
    }
    worker.postMessage(request, [passwordCopy.buffer, saltCopy.buffer])
  })
}

export async function deriveMasterKey(
  password: string,
  params: KdfParams,
): Promise<Uint8Array> {
  if (params.algorithm !== 'argon2id') {
    throw new CryptoError(`Algorithme KDF non pris en charge : ${params.algorithm}`)
  }
  if (params.keyLength !== KEY_BYTES) {
    throw new CryptoError(`Longueur de clé invalide : ${params.keyLength}`)
  }
  if (
    !Number.isInteger(params.memoryKiB) ||
    params.memoryKiB < KDF_LIMITS.minMemoryKiB ||
    params.memoryKiB > KDF_LIMITS.maxMemoryKiB ||
    !Number.isInteger(params.iterations) ||
    params.iterations < KDF_LIMITS.minIterations ||
    params.iterations > KDF_LIMITS.maxIterations ||
    !Number.isInteger(params.parallelism) ||
    params.parallelism < KDF_LIMITS.minParallelism ||
    params.parallelism > KDF_LIMITS.maxParallelism
  ) {
    throw new CryptoError('Paramètres KDF hors limites de sécurité')
  }

  const passwordBytes = utf8(password)
  try {
    try {
      return await deriveInWorker(passwordBytes, params)
    } catch {
      // Repli sur le fil principal si les Web Workers sont indisponibles
      // (Vitest, ancien WebView, CSP restrictive).
      return await argon2id({
        password: passwordBytes,
        salt: fromBase64(params.salt),
        memorySize: params.memoryKiB,
        iterations: params.iterations,
        parallelism: params.parallelism,
        hashLength: params.keyLength,
        outputType: 'binary',
      })
    }
  } finally {
    wipe(passwordBytes)
  }
}

async function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(`La clé AES doit faire ${KEY_BYTES} octets (reçu ${key.length})`)
  }
  return crypto.subtle.importKey('raw', key as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function sealBytes(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: string,
): Promise<Sealed> {
  const cryptoKey = await importAesKey(key)
  const nonce = randomBytes(NONCE_BYTES)
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce as BufferSource,
      additionalData: utf8(aad) as BufferSource,
      tagLength: 128,
    },
    cryptoKey,
    plaintext as BufferSource,
  )

  return {
    n: toBase64(nonce),
    c: toBase64(new Uint8Array(ciphertext)),
  }
}

export async function openBytes(
  sealed: Sealed,
  key: Uint8Array,
  aad: string,
): Promise<Uint8Array> {
  const cryptoKey = await importAesKey(key)
  const nonce = fromBase64(sealed.n)
  if (nonce.length !== NONCE_BYTES) {
    throw new CryptoError('Nonce invalide')
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        additionalData: utf8(aad) as BufferSource,
        tagLength: 128,
      },
      cryptoKey,
      fromBase64(sealed.c) as BufferSource,
    )
    return new Uint8Array(plaintext)
  } catch (error) {
    throw new CryptoError('Déchiffrement impossible : mot de passe invalide ou données corrompues', {
      cause: error,
    })
  } finally {
    wipe(nonce)
  }
}

export async function sealJson<T>(
  value: T,
  key: Uint8Array,
  aad: string,
): Promise<Sealed> {
  const bytes = utf8(JSON.stringify(value))
  try {
    return await sealBytes(bytes, key, aad)
  } finally {
    wipe(bytes)
  }
}

export async function openJson<T>(
  sealed: Sealed,
  key: Uint8Array,
  aad: string,
): Promise<T> {
  const bytes = await openBytes(sealed, key, aad)
  try {
    return JSON.parse(decoder.decode(bytes)) as T
  } catch (error) {
    throw new CryptoError('Contenu déchiffré illisible', { cause: error })
  } finally {
    wipe(bytes)
  }
}

/* ------------------------------------------------------------------ */
/* AAD : chaque ciphertext est lié à son coffre, son élément et son rôle */
/* ------------------------------------------------------------------ */

export function vaultKeyAad(vaultId: string): string {
  return `coffre:v1:vault-key:${vaultId}`
}

export function vaultMetaAad(vaultId: string): string {
  return `coffre:v1:vault-meta:${vaultId}`
}

export function aliasKeyAad(service: string): string {
  return `coffre:v1:alias-key:${service}`
}

export function activityAad(eventId: string): string {
  return `coffre:v1:activity:${eventId}`
}

export function templateKeyAad(templateId: string): string {
  return `coffre:v1:template-key:${templateId}`
}

export function templateContentAad(templateId: string): string {
  return `coffre:v1:template-content:${templateId}`
}

export function templateRecoveryAad(templateId: string): string {
  return `coffre:v1:template-recovery:${templateId}`
}

export function itemKeyAad(vaultId: string, itemId: string): string {
  return `coffre:v1:item-key:${vaultId}:${itemId}`
}

export function itemContentAad(vaultId: string, itemId: string): string {
  return `coffre:v1:item-content:${vaultId}:${itemId}`
}

/**
 * AAD des versions historiques. La version est liée à son élément et à son
 * propre identifiant : un ciphertext de version ne peut pas être substitué au
 * contenu courant ni à une autre version.
 */
export function itemVersionAad(
  vaultId: string,
  itemId: string,
  versionId: string,
): string {
  return `coffre:v1:item-version:${vaultId}:${itemId}:${versionId}`
}

export function itemAttachmentAad(
  vaultId: string,
  itemId: string,
  attachmentId: string,
): string {
  return `coffre:v1:item-attachment:${vaultId}:${itemId}:${attachmentId}`
}

/** Clé HMAC du MAC global, scellée par la clé maîtresse. */
export function integrityKeyAad(): string {
  return 'coffre:v1:integrity-key'
}

/** Empreinte SHA-256 d’un tampon (utilisée par le manifeste d’intégrité). */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

/** Empreinte SHA-1 hexadécimale, utilisée uniquement pour le k-anonymat HIBP. */
export async function sha1Hex(value: string): Promise<string> {
  const bytes = utf8(value)
  try {
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-1', bytes as BufferSource),
    )
    try {
      return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    } finally {
      wipe(digest)
    }
  } finally {
    wipe(bytes)
  }
}

/** HMAC-SHA-256 du manifeste canonique du fichier. */
export async function hmacSha256(
  key: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, message as BufferSource),
  )
}

/** Comparaison à temps constant de deux tampons. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index]
  return difference === 0
}

/* ------------------------------------------------------------------ */
/* AAD de l’enveloppe de récupération                                  */
/* ------------------------------------------------------------------ */

/** Clé de récupération scellée par la clé dérivée de la phrase. */
export function recoveryKeyAad(): string {
  return 'coffre:v1:recovery-key'
}

/** Même clé de récupération, scellée par la clé maîtresse. */
export function recoveryGuardAad(): string {
  return 'coffre:v1:recovery-guard'
}

/** Clé de coffre scellée par la clé de récupération. */
export function recoveryVaultKeyAad(vaultId: string): string {
  return `coffre:v1:recovery-vault-key:${vaultId}`
}

/** Estimation d'entropie utilisée par l'indicateur de robustesse. */
export function estimateEntropy(password: string): number {
  if (!password) return 0

  let pool = 0
  if (/[a-z]/.test(password)) pool += 26
  if (/[A-Z]/.test(password)) pool += 26
  if (/[0-9]/.test(password)) pool += 10
  if (/[^a-zA-Z0-9]/.test(password)) pool += 33
  if (/\s/.test(password)) pool += 1

  let entropy = password.length * Math.log2(Math.max(pool, 1))

  const unique = new Set(password).size
  if (unique <= 4) entropy *= 0.5
  if (/^(.)\1+$/.test(password)) entropy = Math.min(entropy, 8)
  if (/^(.{2,})\1+$/.test(password)) entropy = Math.min(entropy, 30)

  // Mot de passe trivial : un motif courant, éventuellement suivi de quelques
  // chiffres ou symboles. On plafonne fortement, quelle que soit la longueur.
  const trivial =
    /^(?:0123|1234|abcd|qwerty|azerty|password|motdepasse|admin|welcome|letmein)[\d!?._@#$%-]{0,4}$/i
  if (trivial.test(password)) {
    entropy = Math.min(entropy, 20)
  } else if (
    /(?:^|[^a-z])(?:password|motdepasse|qwerty|azerty|admin|welcome|letmein|monkey|dragon|princesse|soleil|amour)(?:[^a-z]|$)/i.test(
      password,
    )
  ) {
    // Un mot du dictionnaire est déjà connu de l'attaquant : on retire les
    // bits qu'il apporte artificiellement, sans écraser le reste.
    entropy = Math.max(0, entropy - 10)
  }

  return Math.max(0, Math.round(entropy))
}

export function passwordStrength(entropy: number): {
  score: 0 | 1 | 2 | 3 | 4
  label: string
} {
  if (entropy < 30) return { score: 0, label: 'Très faible' }
  if (entropy < 50) return { score: 1, label: 'Faible' }
  if (entropy < 70) return { score: 2, label: 'Moyen' }
  if (entropy < 100) return { score: 3, label: 'Solide' }
  return { score: 4, label: 'Excellent' }
}
