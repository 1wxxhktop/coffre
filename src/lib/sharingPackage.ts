/**
 * Paquet de partage d’un coffre.
 *
 * Le paquet contient la clé du coffre enveloppée pour chaque membre, le rôle
 * signé par l’administrateur et les identités publiques. Il ne contient jamais
 * de clé privée ni de contenu déchiffré. Le nom du coffre reste choisi par le
 * destinataire à l’import.
 */

import {
  openVaultKeyFromMember,
  parsePublicSharingIdentity,
  publicSharingIdentity,
  signShareRole,
  verifyShareRole,
  wrapVaultKeyForMembers,
  type PublicSharingIdentity,
  type SealedShareKey,
  type ShareMember,
  type ShareRole,
  type SharingIdentity,
  type SignedShareRole,
} from './sharing'

export interface SharedVaultMember {
  identity: PublicSharingIdentity
  role: SignedShareRole
  wrap: SealedShareKey
}

export interface SharedVaultPackage {
  version: 1
  vaultId: string
  createdAt: string
  admin: PublicSharingIdentity
  members: SharedVaultMember[]
}

/** Valide un paquet reçu avant de l’exposer à l’interface. */
export async function parseSharedVaultPackage(
  value: unknown,
): Promise<SharedVaultPackage> {
  let data: unknown = value
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value)
    } catch {
      throw new Error('Paquet de partage JSON invalide')
    }
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Paquet de partage invalide')
  }
  const record = data as Record<string, unknown>
  if (
    record.version !== 1 ||
    typeof record.vaultId !== 'string' ||
    typeof record.createdAt !== 'string' ||
    Number.isNaN(Date.parse(record.createdAt)) ||
    !Array.isArray(record.members)
  ) {
    throw new Error('Paquet de partage incomplet')
  }
  const admin = await parsePublicSharingIdentity(record.admin)
  const members: SharedVaultMember[] = []
  const seenMembers = new Set<string>()
  for (const entry of record.members) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Membre de partage invalide')
    }
    const member = entry as Record<string, unknown>
    const identity = await parsePublicSharingIdentity(member.identity)
    const role = member.role as Record<string, unknown> | undefined
    const wrap = member.wrap as Record<string, unknown> | undefined
    if (
      !role ||
      typeof role.vaultId !== 'string' ||
      typeof role.memberFingerprint !== 'string' ||
      (role.role !== 'read' && role.role !== 'write') ||
      typeof role.issuedAt !== 'string' ||
      Number.isNaN(Date.parse(role.issuedAt)) ||
      typeof role.issuedBy !== 'string' ||
      typeof role.signature !== 'string' ||
      !wrap ||
      typeof wrap.enc !== 'string' ||
      typeof wrap.ciphertext !== 'string'
    ) {
      throw new Error('Membre de partage incomplet')
    }
    if (role.vaultId !== record.vaultId || role.memberFingerprint !== identity.fingerprint) {
      throw new Error('Rôle de partage incohérent')
    }
    if (seenMembers.has(identity.fingerprint)) {
      throw new Error('Membre de partage en double')
    }
    seenMembers.add(identity.fingerprint)
    const signed = {
      vaultId: role.vaultId,
      memberFingerprint: role.memberFingerprint,
      role: role.role,
      issuedAt: role.issuedAt,
      issuedBy: role.issuedBy,
      signature: role.signature,
    } as SignedShareRole
    if (!(await verifyShareRole(signed, admin.signingPublicKey))) {
      throw new Error('Signature du rôle invalide')
    }
    members.push({
      identity,
      role: signed,
      wrap: { enc: wrap.enc, ciphertext: wrap.ciphertext },
    })
  }
  return {
    version: 1,
    vaultId: record.vaultId,
    createdAt: record.createdAt,
    admin,
    members,
  }
}

export interface SharedVaultImport {
  vaultKey: Uint8Array
  vaultId: string
  role: ShareRole
  admin: PublicSharingIdentity
}

/** Crée un paquet signé pour les membres d’un coffre. */
export async function createSharedVaultPackage(input: {
  vaultId: string
  vaultKey: Uint8Array
  admin: SharingIdentity
  members: ShareMember[]
  createdAt?: string
}): Promise<SharedVaultPackage> {
  const createdAt = input.createdAt ?? new Date().toISOString()
  const wraps = await wrapVaultKeyForMembers(
    input.vaultKey,
    input.members,
    input.vaultId,
  )
  const members: SharedVaultMember[] = []
  for (const member of input.members) {
    const role = await signShareRole(input.admin, {
      vaultId: input.vaultId,
      memberFingerprint: member.identity.fingerprint,
      role: member.role,
      issuedAt: createdAt,
    })
    const wrap = wraps.find(
      (entry) => entry.memberFingerprint === member.identity.fingerprint,
    )
    if (!wrap) throw new Error('Enveloppe de membre absente')
    members.push({
      identity: member.identity,
      role,
      wrap: {
        enc: wrap.enc,
        ciphertext: wrap.ciphertext,
      },
    })
  }
  return {
    version: 1,
    vaultId: input.vaultId,
    createdAt,
    admin: publicSharingIdentity(input.admin),
    members,
  }
}

/** Vérifie le rôle et ouvre la clé du coffre pour un destinataire. */
export async function openSharedVaultPackage(
  pkg: SharedVaultPackage,
  identity: SharingIdentity,
): Promise<SharedVaultImport> {
  if (pkg.version !== 1) throw new Error('Version de paquet de partage inconnue')
  const member = pkg.members.find(
    (entry) => entry.identity.fingerprint === identity.fingerprint,
  )
  if (!member) throw new Error('Ce paquet ne contient pas votre identité')
  if (
    member.role.vaultId !== pkg.vaultId ||
    member.role.memberFingerprint !== identity.fingerprint ||
    member.role.issuedBy !== pkg.admin.fingerprint
  ) {
    throw new Error('Rôle de partage incohérent')
  }
  if (!(await verifyShareRole(member.role, pkg.admin.signingPublicKey))) {
    throw new Error('Signature du rôle invalide')
  }
  const vaultKey = await openVaultKeyFromMember(
    member.wrap,
    identity,
    pkg.vaultId,
  )
  return {
    vaultKey,
    vaultId: pkg.vaultId,
    role: member.role.role,
    admin: pkg.admin,
  }
}
