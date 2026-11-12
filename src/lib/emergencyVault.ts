/**
 * Accès d’urgence persistant.
 *
 * La clé maîtresse est enveloppée avec HPKE pour l’identité publique d’un
 * contact. Le contact ne peut l’ouvrir qu’avec sa clé privée. Sans serveur,
 * aucun délai d’attente ne peut être imposé : l’enveloppe est immédiate.
 */

import {
  createEmergencyEnvelope,
  openEmergencyEnvelope,
  openSealed,
  parsePublicSharingIdentity,
  sealForRecipient,
  type PublicSharingIdentity,
  type SharingIdentity,
} from './sharing'
import { combineShares, splitSecret } from './shamir'
import { wipe } from './crypto'
import type {
  EmergencyAccessRecord,
  EmergencyImmediateRecord,
  EmergencyShamirRecord,
} from './types'

function shareInfo(contact: PublicSharingIdentity, index: number): string {
  return `coffre:v1:emergency-share|${contact.fingerprint}|${index}`
}

/**
 * Vérifie que chaque contact est cohérent : l’empreinte doit correspondre aux
 * deux clés publiques. Sans ce contrôle, un attaquant pourrait remplacer une
 * clé en conservant l’empreinte, puis attendre un changement de mot de passe
 * pour recevoir la nouvelle clé maîtresse.
 */
export async function assertEmergencyRecordContacts(
  record: EmergencyAccessRecord,
): Promise<void> {
  if (record.mode === 'immediate') {
    await parsePublicSharingIdentity(record.contact)
    return
  }
  for (const share of record.shares) {
    await parsePublicSharingIdentity(share.contact)
  }
}

export async function createEmergencyRecord(
  masterKey: Uint8Array,
  contact: PublicSharingIdentity,
): Promise<EmergencyImmediateRecord> {
  await parsePublicSharingIdentity(contact)
  return {
    version: 1,
    mode: 'immediate',
    contact,
    sealed: await createEmergencyEnvelope(masterKey, contact),
    createdAt: new Date().toISOString(),
  }
}

/** Crée un accès Shamir `threshold` sur `contacts.length`. */
export async function createShamirEmergencyRecord(
  masterKey: Uint8Array,
  contacts: PublicSharingIdentity[],
  threshold = 2,
): Promise<EmergencyShamirRecord> {
  if (contacts.length < threshold || contacts.length > 5) {
    throw new Error('Nombre de contacts invalide pour le partage Shamir')
  }
  for (const contact of contacts) {
    await parsePublicSharingIdentity(contact)
  }
  const shares = await splitSecret(masterKey, threshold, contacts.length)
  const wrapped = []
  try {
    for (const [index, share] of shares.entries()) {
      const contact = contacts[index]
      wrapped.push({
        contact,
        sealed: await sealForRecipient(
          share,
          contact.encryptionPublicKey,
          shareInfo(contact, index + 1),
        ),
      })
    }
  } finally {
    for (const share of shares) wipe(share)
  }
  return {
    version: 1,
    mode: 'shamir',
    threshold,
    total: contacts.length,
    shares: wrapped,
    createdAt: new Date().toISOString(),
  }
}

export async function openEmergencyRecord(
  record: EmergencyImmediateRecord,
  contact: SharingIdentity,
): Promise<Uint8Array> {
  return openEmergencyEnvelope(record.sealed, contact)
}

/** Ouvre un accès Shamir avec au moins `threshold` contacts. */
export async function openShamirEmergencyRecord(
  record: EmergencyShamirRecord,
  contacts: SharingIdentity[],
): Promise<Uint8Array> {
  const byFingerprint = new Map(contacts.map((contact) => [contact.fingerprint, contact]))
  const shares: Uint8Array[] = []
  try {
    for (const [index, entry] of record.shares.entries()) {
      const contact = byFingerprint.get(entry.contact.fingerprint)
      if (!contact) continue
      shares.push(
        await openSealed(
          entry.sealed,
          contact.encryptionPrivateKey,
          shareInfo(entry.contact, index + 1),
        ),
      )
    }
    if (shares.length < record.threshold) {
      throw new Error('Pas assez de contacts pour ouvrir l’accès d’urgence')
    }
    return await combineShares(shares)
  } finally {
    for (const share of shares) wipe(share)
  }
}

export async function resealEmergencyRecord(
  record: EmergencyAccessRecord,
  nextMasterKey: Uint8Array,
): Promise<EmergencyAccessRecord> {
  await assertEmergencyRecordContacts(record)
  if (record.mode === 'immediate') {
    return {
      ...record,
      sealed: await createEmergencyEnvelope(nextMasterKey, record.contact),
    }
  }
  const next = await createShamirEmergencyRecord(
    nextMasterKey,
    record.shares.map((share) => share.contact),
    record.threshold,
  )
  return { ...next, createdAt: record.createdAt }
}
