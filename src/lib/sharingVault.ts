/**
 * Persistance de l’identité de partage dans le fichier `.coffre`.
 *
 * Seules les clés publiques et l’empreinte sont en clair ; les clés privées
 * sont sérialisées puis scellées par la clé maîtresse. L’AAD lie le ciphertext
 * au fichier et aux deux clés publiques : remplacer une clé ou déplacer
 * l’enveloppe vers un autre fichier fait échouer l’ouverture.
 */

import { openBytes, sealBytes, wipe } from './crypto'
import { generateSharingIdentity, sharingFingerprint, type SharingIdentity } from './sharing'
import type { SealedSharingIdentity } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function sharingAad(
  fileId: string,
  encryptionPublicKey: string,
  signingPublicKey: string,
): string {
  return `coffre:v1:sharing-identity|${fileId}|${encryptionPublicKey}|${signingPublicKey}`
}

interface PrivateKeyPayload {
  encryptionPrivateKey: string
  signingPrivateKey: string
}

/** Scelle une identité de partage pour un fichier donné. */
export async function sealSharingIdentity(
  identity: SharingIdentity,
  masterKey: Uint8Array,
  fileId: string,
  createdAt = new Date().toISOString(),
): Promise<SealedSharingIdentity> {
  const fingerprint = await sharingFingerprint(
    identity.encryptionPublicKey,
    identity.signingPublicKey,
  )
  if (fingerprint !== identity.fingerprint) {
    throw new Error('Empreinte de partage incohérente')
  }
  const payload: PrivateKeyPayload = {
    encryptionPrivateKey: identity.encryptionPrivateKey,
    signingPrivateKey: identity.signingPrivateKey,
  }
  const bytes = encoder.encode(JSON.stringify(payload))
  try {
    return {
      version: 1,
      encryptionPublicKey: identity.encryptionPublicKey,
      signingPublicKey: identity.signingPublicKey,
      fingerprint,
      privateKeys: await sealBytes(
        bytes,
        masterKey,
        sharingAad(fileId, identity.encryptionPublicKey, identity.signingPublicKey),
      ),
      createdAt,
    }
  } finally {
    wipe(bytes)
  }
}

/** Ouvre l’identité de partage d’un fichier. */
export async function openSharingIdentity(
  record: SealedSharingIdentity,
  masterKey: Uint8Array,
  fileId: string,
): Promise<SharingIdentity> {
  const expected = await sharingFingerprint(
    record.encryptionPublicKey,
    record.signingPublicKey,
  )
  if (expected !== record.fingerprint) {
    throw new Error('Empreinte de partage incohérente')
  }
  const bytes = await openBytes(
    record.privateKeys,
    masterKey,
    sharingAad(fileId, record.encryptionPublicKey, record.signingPublicKey),
  )
  try {
    const payload = JSON.parse(decoder.decode(bytes)) as Partial<PrivateKeyPayload>
    if (
      typeof payload.encryptionPrivateKey !== 'string' ||
      typeof payload.signingPrivateKey !== 'string'
    ) {
      throw new Error('Clés privées de partage invalides')
    }
    return {
      encryptionPublicKey: record.encryptionPublicKey,
      encryptionPrivateKey: payload.encryptionPrivateKey,
      signingPublicKey: record.signingPublicKey,
      signingPrivateKey: payload.signingPrivateKey,
      fingerprint: record.fingerprint,
    }
  } finally {
    wipe(bytes)
  }
}

/** Crée et scelle une nouvelle identité pour un fichier. */
export async function createSharingIdentity(
  masterKey: Uint8Array,
  fileId: string,
): Promise<{ identity: SharingIdentity; record: SealedSharingIdentity }> {
  const identity = await generateSharingIdentity()
  const record = await sealSharingIdentity(identity, masterKey, fileId)
  return { identity, record }
}

/** Ré-enveloppe l’identité lors d’une rotation de clé maîtresse. */
export async function resealSharingIdentity(
  record: SealedSharingIdentity,
  oldMasterKey: Uint8Array,
  newMasterKey: Uint8Array,
  fileId: string,
): Promise<SealedSharingIdentity> {
  const identity = await openSharingIdentity(record, oldMasterKey, fileId)
  return sealSharingIdentity(identity, newMasterKey, fileId, record.createdAt)
}
