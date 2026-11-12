/**
 * Protocole du pont natif entre l’extension navigateur et l’application
 * desktop.
 *
 * Le relais (mode « hôte de messagerie native » du binaire Coffre) ne voit que
 * des trames JSON. Après appairage, chaque requête et chaque réponse est
 * chiffrée en AES-256-GCM avec une clé de session dérivée par ECDH P-256 puis
 * HKDF-SHA-256. Un identifiant de session et un compteur par direction
 * empêchent le rejeu après redémarrage.
 *
 * L’extension ne stocke que la clé de session (dans `chrome.storage.local`) ;
 * l’application la conserve dans le trousseau du système.
 */

export const BRIDGE_PROTOCOL_VERSION = 2
export const BRIDGE_HOST_NAME = 'app.coffre.bridge'
export const BRIDGE_SESSION_STORAGE_KEY = 'bridgeSession'
export const BRIDGE_KEYCHAIN_ACCOUNT = 'bridge:session'

export type BridgeDirection = 'extension-to-app' | 'app-to-extension'

export interface BridgeKeyPair {
  privateKey: CryptoKey
  /** Clé publique brute P-256, encodée en base64. */
  publicKey: string
}

export interface BridgePairBegin {
  id: string
  type: 'pair-begin'
  publicKey: string
}

export interface BridgePairPending {
  id: string
  type: 'pair-pending'
  code: string
  publicKey: string
}

export interface BridgeEncryptedEnvelope {
  id: string
  type: 'enc'
  session: string
  counter: number
  iv: string
  data: string
}

export interface BridgeHello {
  id: string
  type: 'hello'
  session: string
  paired: boolean
  unlocked: boolean
}

export interface BridgePlainMessage {
  id: string
  type: string
  [key: string]: unknown
}

export class BridgeCryptoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BridgeCryptoError'
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/** Identifiant aléatoire d’une requête ou d’une session. */
export function bridgeRandomId(): string {
  return encodeBase64(randomBytes(16)).replace(/[+/=]/g, '').slice(0, 22)
}

/** Code à six chiffres affiché pendant l’appairage. */
export function bridgePairingCode(): string {
  const value = new DataView(randomBytes(4).buffer).getUint32(0)
  return String(value % 1_000_000).padStart(6, '0')
}

export async function createBridgeKeyPair(): Promise<BridgeKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey)
  return {
    privateKey: pair.privateKey,
    publicKey: encodeBase64(new Uint8Array(raw)),
  }
}

/**
 * Dérive la clé de session. La clé publique locale et celle du pair sont
 * triées et incluses dans l’information HKDF : les deux côtés obtiennent la
 * même clé, et une substitution de clé publique change la dérivation.
 */
export async function deriveBridgeSessionKey(
  privateKey: CryptoKey,
  ownPublicKey: string,
  peerPublicKey: string,
): Promise<string> {
  let peerKey: CryptoKey
  try {
    peerKey = await crypto.subtle.importKey(
      'raw',
      decodeBase64(peerPublicKey) as BufferSource,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    )
  } catch (error) {
    throw new BridgeCryptoError('Clé publique de pair invalide', { cause: error })
  }

  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerKey },
    privateKey,
    256,
  )
  const pair = [ownPublicKey, peerPublicKey].sort().join(':')
  const info = encoder.encode(`aes-256-gcm:${pair}`)
  const sharedBytes = new Uint8Array(shared)
  try {
    // HKDF-SHA-256 (extract puis expand) implémenté avec HMAC WebCrypto :
    // évite de dépendre de l’algorithme HKDF des anciennes WebViews.
    const salt = encoder.encode('coffre-bridge-v1')
    const prk = await hmacSha256(salt, sharedBytes)
    const blockInput = new Uint8Array(info.length + 1)
    blockInput.set(info)
    blockInput[info.length] = 1
    try {
      const okm = await hmacSha256(prk, blockInput)
      try {
        return encodeBase64(okm)
      } finally {
        okm.fill(0)
      }
    } finally {
      prk.fill(0)
      blockInput.fill(0)
    }
  } finally {
    sharedBytes.fill(0)
    info.fill(0)
  }
}

async function hmacSha256(
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

function bridgeAad(
  session: string,
  direction: BridgeDirection,
  counter: number,
): Uint8Array {
  return encoder.encode(`coffre-bridge:v1:${session}:${direction}:${counter}`)
}

async function importSessionKey(key: string): Promise<CryptoKey> {
  const bytes = decodeBase64(key)
  if (bytes.length !== 32) {
    throw new BridgeCryptoError('Clé de session invalide')
  }
  try {
    return await crypto.subtle.importKey(
      'raw',
      bytes as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    )
  } finally {
    bytes.fill(0)
  }
}

export async function encryptBridgePayload(
  key: string,
  session: string,
  counter: number,
  direction: BridgeDirection,
  payload: unknown,
): Promise<{ iv: string; data: string }> {
  const cryptoKey = await importSessionKey(key)
  const nonce = randomBytes(12)
  const plaintext = encoder.encode(JSON.stringify(payload))
  try {
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        additionalData: bridgeAad(session, direction, counter) as BufferSource,
        tagLength: 128,
      },
      cryptoKey,
      plaintext as BufferSource,
    )
    return {
      iv: encodeBase64(nonce),
      data: encodeBase64(new Uint8Array(ciphertext)),
    }
  } finally {
    nonce.fill(0)
    plaintext.fill(0)
  }
}

export async function decryptBridgePayload(
  key: string,
  session: string,
  counter: number,
  direction: BridgeDirection,
  envelope: { iv: string; data: string },
): Promise<unknown> {
  const cryptoKey = await importSessionKey(key)
  const nonce = decodeBase64(envelope.iv)
  if (nonce.length !== 12) {
    nonce.fill(0)
    throw new BridgeCryptoError('Nonce invalide')
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        additionalData: bridgeAad(session, direction, counter) as BufferSource,
        tagLength: 128,
      },
      cryptoKey,
      decodeBase64(envelope.data) as BufferSource,
    )
    return JSON.parse(decoder.decode(plaintext)) as unknown
  } catch (error) {
    throw new BridgeCryptoError('Message du pont illisible ou altéré', {
      cause: error,
    })
  } finally {
    nonce.fill(0)
  }
}
