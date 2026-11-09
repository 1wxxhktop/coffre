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
  type PublicSharingIdentity,
  type SharingIdentity,
} from './sharing'
import type { EmergencyAccessRecord } from './types'

export async function createEmergencyRecord(
  masterKey: Uint8Array,
  contact: PublicSharingIdentity,
): Promise<EmergencyAccessRecord> {
  return {
    version: 1,
    contact,
    sealed: await createEmergencyEnvelope(masterKey, contact),
    createdAt: new Date().toISOString(),
  }
}

export async function openEmergencyRecord(
  record: EmergencyAccessRecord,
  contact: SharingIdentity,
): Promise<Uint8Array> {
  return openEmergencyEnvelope(record.sealed, contact)
}

export async function resealEmergencyRecord(
  record: EmergencyAccessRecord,
  nextMasterKey: Uint8Array,
): Promise<EmergencyAccessRecord> {
  return {
    ...record,
    sealed: await createEmergencyEnvelope(nextMasterKey, record.contact),
  }
}
