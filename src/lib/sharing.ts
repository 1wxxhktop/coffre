/**
 * Socle du partage de coffres (L10).
 *
 * Chaque utilisateur possède une paire X25519 pour HPKE et une paire Ed25519
 * pour signer les rôles. Les clés privées sont destinées à être scellées par la
 * clé du coffre ; ce module ne les persiste jamais. Les enveloppes HPKE lient
 * le chiffré à un contexte explicite (coffre, membre ou accès d’urgence).
 */

import { AeadId, CipherSuite, KdfId, KemId } from 'hpke-js'
import { fromBase64, sha256, toBase64, utf8 } from './crypto'

const suite = new CipherSuite({
  kem: KemId.DhkemX25519HkdfSha256,
  kdf: KdfId.HkdfSha256,
  aead: AeadId.Aes256Gcm,
})

export type ShareRole = 'read' | 'write'

export interface SharingIdentity {
  encryptionPublicKey: string
  encryptionPrivateKey: string
  signingPublicKey: string
  signingPrivateKey: string
  fingerprint: string
}

export interface PublicSharingIdentity {
  encryptionPublicKey: string
  signingPublicKey: string
  fingerprint: string
}

export interface SealedShareKey {
  /** Clé publique éphémère HPKE. */
  enc: string
  /** Clé de coffre chiffrée. */
  ciphertext: string
}

export interface SignedShareRole {
  vaultId: string
  memberFingerprint: string
  role: ShareRole
  issuedAt: string
  issuedBy: string
  signature: string
}

export class SharingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SharingError'
  }
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function canonicalIdentity(encryptionPublicKey: string, signingPublicKey: string): string {
  return `coffre-sharing-identity-v1|${encryptionPublicKey}|${signingPublicKey}`
}

function canonicalRole(role: Omit<SignedShareRole, 'signature'>): string {
  return [
    'coffre-sharing-role-v1',
    role.vaultId,
    role.memberFingerprint,
    role.role,
    role.issuedAt,
    role.issuedBy,
  ].join('|')
}

async function fingerprint(encryptionPublicKey: string, signingPublicKey: string): Promise<string> {
  const digest = await sha256(utf8(canonicalIdentity(encryptionPublicKey, signingPublicKey)))
  return `SHA256:${toBase64(digest)}`
}

/** Génère une identité de partage complète, non persistée. */
export async function generateSharingIdentity(): Promise<SharingIdentity> {
  const encryption = await suite.kem.generateKeyPair()
  const signing = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const encryptionPublicKey = toBase64(
    new Uint8Array(await suite.kem.serializePublicKey(encryption.publicKey)),
  )
  const encryptionPrivateKey = toBase64(
    new Uint8Array(await suite.kem.serializePrivateKey(encryption.privateKey)),
  )
  const signingPublicKey = toBase64(
    new Uint8Array(await crypto.subtle.exportKey('spki', signing.publicKey)),
  )
  const signingPrivateKey = toBase64(
    new Uint8Array(await crypto.subtle.exportKey('pkcs8', signing.privateKey)),
  )
  return {
    encryptionPublicKey,
    encryptionPrivateKey,
    signingPublicKey,
    signingPrivateKey,
    fingerprint: await fingerprint(encryptionPublicKey, signingPublicKey),
  }
}

/** Partie publiable d’une identité. */
export function publicSharingIdentity(identity: SharingIdentity): PublicSharingIdentity {
  return {
    encryptionPublicKey: identity.encryptionPublicKey,
    signingPublicKey: identity.signingPublicKey,
    fingerprint: identity.fingerprint,
  }
}

async function publicKey(value: string): Promise<CryptoKey> {
  try {
    return await suite.kem.deserializePublicKey(fromBase64(value))
  } catch {
    throw new SharingError('Clé publique X25519 invalide')
  }
}

async function privateKey(value: string): Promise<CryptoKey> {
  try {
    return await suite.kem.deserializePrivateKey(fromBase64(value))
  } catch {
    throw new SharingError('Clé privée X25519 invalide')
  }
}

/** Scelle une clé de coffre pour un destinataire avec HPKE base mode. */
export async function sealForRecipient(
  plaintext: Uint8Array,
  recipientPublicKey: string,
  info: string,
): Promise<SealedShareKey> {
  const sender = await suite.createSenderContext({
    recipientPublicKey: await publicKey(recipientPublicKey),
    info: utf8(info),
  })
  const ciphertext = await sender.seal(plaintext)
  return {
    enc: toBase64(new Uint8Array(sender.enc)),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }
}

/** Ouvre une enveloppe HPKE avec la clé privée du destinataire. */
export async function openSealed(
  sealed: SealedShareKey,
  recipientPrivateKey: string,
  info: string,
): Promise<Uint8Array> {
  try {
    const recipient = await suite.createRecipientContext({
      recipientKey: await privateKey(recipientPrivateKey),
      enc: fromBase64(sealed.enc),
      info: utf8(info),
    })
    return new Uint8Array(await recipient.open(fromBase64(sealed.ciphertext)))
  } catch {
    throw new SharingError('Enveloppe HPKE invalide ou contexte différent')
  }
}

/** Contexte AAD d’une clé de coffre partagée. */
export function shareInfo(vaultId: string, memberFingerprint: string): string {
  return `coffre:v1:share-key|${vaultId}|${memberFingerprint}`
}

/** Contexte AAD d’une clé d’accès d’urgence. */
export function emergencyInfo(contactFingerprint: string): string {
  return `coffre:v1:emergency-key|${contactFingerprint}`
}

/** Scelle une clé de coffre pour un membre. */
export async function sealVaultKeyForMember(
  vaultKey: Uint8Array,
  member: PublicSharingIdentity,
  vaultId: string,
): Promise<SealedShareKey> {
  return sealForRecipient(
    vaultKey,
    member.encryptionPublicKey,
    shareInfo(vaultId, member.fingerprint),
  )
}

/** Ouvre la clé de coffre destinée à un membre. */
export async function openVaultKeyFromMember(
  sealed: SealedShareKey,
  identity: SharingIdentity,
  vaultId: string,
): Promise<Uint8Array> {
  return openSealed(
    sealed,
    identity.encryptionPrivateKey,
    shareInfo(vaultId, identity.fingerprint),
  )
}

/** Signe un rôle de membre avec la clé Ed25519 de l’administrateur. */
export async function signShareRole(
  identity: SharingIdentity,
  role: Omit<SignedShareRole, 'signature' | 'issuedBy'>,
): Promise<SignedShareRole> {
  const unsigned: Omit<SignedShareRole, 'signature'> = {
    ...role,
    issuedBy: identity.fingerprint,
  }
  const key = await crypto.subtle.importKey(
    'pkcs8',
    buffer(fromBase64(identity.signingPrivateKey)),
    'Ed25519',
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('Ed25519', key, buffer(utf8(canonicalRole(unsigned))))
  return { ...unsigned, signature: toBase64(new Uint8Array(signature)) }
}

/** Vérifie la signature d’un rôle avec la clé publique de l’administrateur. */
export async function verifyShareRole(
  role: SignedShareRole,
  signingPublicKey: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      buffer(fromBase64(signingPublicKey)),
      'Ed25519',
      false,
      ['verify'],
    )
    const { signature, ...unsigned } = role
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      buffer(fromBase64(signature)),
      buffer(utf8(canonicalRole(unsigned))),
    )
  } catch {
    return false
  }
}

/** Crée une enveloppe d’accès d’urgence pour un contact. */
export async function createEmergencyEnvelope(
  masterKey: Uint8Array,
  contact: PublicSharingIdentity,
): Promise<SealedShareKey> {
  return sealForRecipient(
    masterKey,
    contact.encryptionPublicKey,
    emergencyInfo(contact.fingerprint),
  )
}

/** Ouvre une enveloppe d’accès d’urgence avec l’identité du contact. */
export async function openEmergencyEnvelope(
  sealed: SealedShareKey,
  contact: SharingIdentity,
): Promise<Uint8Array> {
  return openSealed(
    sealed,
    contact.encryptionPrivateKey,
    emergencyInfo(contact.fingerprint),
  )
}
