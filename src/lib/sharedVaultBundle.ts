/**
 * Paquet de contenu d’un coffre partagé.
 *
 * Le paquet contient la clé enveloppée pour chaque membre (via
 * `SharedVaultPackage`) et les enregistrements déjà chiffrés du coffre :
 * éléments, pièces jointes et versions. Aucun contenu clair n’est exporté.
 * L’échange est manuel : il n’y a pas encore de synchronisation automatique
 * entre les fichiers personnels des membres.
 */

import {
  equalBytes,
  itemKeyAad,
  openBytes,
  sealBytes,
  vaultKeyAad,
  vaultMetaAad,
  wipe,
} from './crypto'
import {
  openSharedVaultPackage,
  parseSharedVaultPackage,
  type SharedVaultPackage,
} from './sharingPackage'
import {
  signSharingPayload,
  verifySharingPayload,
  type SharingIdentity,
} from './sharing'
import type {
  EncryptedAttachmentRecord,
  EncryptedItemRecord,
  EncryptedVersionRecord,
  Sealed,
  VaultFile,
  VaultSharingMember,
  VaultTombstone,
} from './types'
import {
  adoptVaultKey,
  adoptVaultSharingMembers,
  canonicalJson,
  readVaultSharing,
  type VaultSession,
} from './vault'

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const MAX_ITEMS = 20_000
const MAX_ATTACHMENTS = 20_000
const MAX_VERSIONS = 20_000

export interface SharedVaultBundle {
  format: 'coffre-shared-vault'
  version: 1
  package: SharedVaultPackage
  vault: {
    id: string
    name: Sealed
    createdAt: string
    updatedAt: string
  }
  items: EncryptedItemRecord[]
  attachments: EncryptedAttachmentRecord[]
  versions: EncryptedVersionRecord[]
  tombstones: VaultTombstone[]
  exportedAt: string
  /** Signature Ed25519 de l’expéditeur, ajoutée pour la synchronisation. */
  sender?: {
    fingerprint: string
    signature: string
  }
}

export interface SharedVaultBundleImport {
  file: VaultFile
  vaultName: string
  imported: number
  updated: number
  deleted: number
  conflicts: number
  role: 'read' | 'write'
  changed: boolean
}

function newer(
  left: { updatedAt?: string; createdAt?: string; clock?: { rev: number } },
  right: { updatedAt?: string; createdAt?: string; clock?: { rev: number } },
): boolean {
  return (left.updatedAt ?? left.createdAt ?? '') >= (right.updatedAt ?? right.createdAt ?? '')
}

/** Construit un paquet de contenu pour un coffre et un paquet de clés. */
export function createSharedVaultBundle(
  file: VaultFile,
  vaultId: string,
  pkg: SharedVaultPackage,
  exportedAt = new Date().toISOString(),
): SharedVaultBundle {
  if (pkg.vaultId !== vaultId) throw new Error('Paquet de partage incohérent')
  const vault = file.vaults.find((entry) => entry.id === vaultId)
  if (!vault) throw new Error('Coffre introuvable')
  const items = file.items.filter((item) => item.vaultId === vaultId)
  const itemIds = new Set(items.map((item) => item.id))
  return {
    format: 'coffre-shared-vault',
    version: 1,
    package: pkg,
    vault: {
      id: vault.id,
      name: vault.name,
      createdAt: vault.createdAt,
      updatedAt: vault.updatedAt,
    },
    items,
    attachments: file.attachments.filter((attachment) => itemIds.has(attachment.itemId)),
    versions: file.versions.filter((version) => itemIds.has(version.itemId)),
    tombstones: (file.tombstones ?? []).filter((tombstone) => tombstone.kind === 'item'),
    exportedAt,
  }
}

function bundlePayload(bundle: Omit<SharedVaultBundle, 'sender'>): string {
  return canonicalJson({
    format: bundle.format,
    version: bundle.version,
    package: bundle.package,
    vault: bundle.vault,
    items: bundle.items,
    attachments: bundle.attachments,
    versions: bundle.versions,
    tombstones: bundle.tombstones,
    exportedAt: bundle.exportedAt,
  })
}

/** Signe un bundle avec l’identité du membre qui l’exporte. */
export async function signSharedVaultBundle(
  bundle: SharedVaultBundle,
  identity: SharingIdentity,
): Promise<SharedVaultBundle> {
  const member = bundle.package.members.find(
    (entry) => entry.identity.fingerprint === identity.fingerprint,
  )
  if (!member && bundle.package.admin.fingerprint !== identity.fingerprint) {
    throw new Error('Cette identité n’est pas membre du coffre partagé')
  }
  const signature = await signSharingPayload(identity, bundlePayload(bundle))
  return {
    ...bundle,
    sender: { fingerprint: identity.fingerprint, signature },
  }
}

/** Valide un paquet de contenu reçu avant import. */
export async function parseSharedVaultBundle(
  value: unknown,
  options: { requireSignature?: boolean } = {},
): Promise<SharedVaultBundle> {
  let data: unknown = value
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value)
    } catch {
      throw new Error('Paquet de contenu JSON invalide')
    }
  }
  if (!data || typeof data !== 'object') throw new Error('Paquet de contenu invalide')
  const record = data as Record<string, unknown>
  if (
    record.format !== 'coffre-shared-vault' ||
    record.version !== 1 ||
    typeof record.exportedAt !== 'string' ||
    !Array.isArray(record.items) ||
    !Array.isArray(record.attachments) ||
    !Array.isArray(record.versions) ||
    !record.vault ||
    typeof record.vault !== 'object'
  ) {
    throw new Error('Paquet de contenu incomplet')
  }
  const vault = record.vault as Record<string, unknown>
  if (
    typeof vault.id !== 'string' ||
    typeof vault.createdAt !== 'string' ||
    typeof vault.updatedAt !== 'string' ||
    !vault.name ||
    typeof vault.name !== 'object'
  ) {
    throw new Error('Coffre partagé invalide')
  }
  const pkg = await parseSharedVaultPackage(record.package)
  if (pkg.vaultId !== vault.id) throw new Error('Coffre et paquet incohérents')
  if (
    record.items.length > MAX_ITEMS ||
    record.attachments.length > MAX_ATTACHMENTS ||
    record.versions.length > MAX_VERSIONS
  ) {
    throw new Error('Paquet de contenu trop volumineux')
  }
  const items = record.items as EncryptedItemRecord[]
  if (
    items.some(
      (item) =>
        !item ||
        typeof item.id !== 'string' ||
        item.vaultId !== vault.id ||
        !item.key ||
        !item.content,
    )
  ) {
    throw new Error('Élément partagé invalide')
  }
  const bundle: SharedVaultBundle = {
    format: 'coffre-shared-vault',
    version: 1,
    package: pkg,
    vault: {
      id: vault.id,
      name: vault.name as Sealed,
      createdAt: vault.createdAt,
      updatedAt: vault.updatedAt,
    },
    items,
    attachments: record.attachments as EncryptedAttachmentRecord[],
    versions: record.versions as EncryptedVersionRecord[],
    tombstones: Array.isArray(record.tombstones)
      ? (record.tombstones as VaultTombstone[]).filter(
          (tombstone) =>
            tombstone &&
            tombstone.kind === 'item' &&
            typeof tombstone.id === 'string' &&
            typeof tombstone.deletedAt === 'string',
        )
      : [],
    exportedAt: record.exportedAt,
  }
  if (record.sender !== undefined) {
    if (!record.sender || typeof record.sender !== 'object') {
      throw new Error('Signature d’expéditeur invalide')
    }
    const sender = record.sender as Record<string, unknown>
    if (
      typeof sender.fingerprint !== 'string' ||
      typeof sender.signature !== 'string'
    ) {
      throw new Error('Signature d’expéditeur incomplète')
    }
    const signer =
      pkg.admin.fingerprint === sender.fingerprint
        ? pkg.admin
        : pkg.members.find(
            (member) => member.identity.fingerprint === sender.fingerprint,
          )?.identity
    if (!signer) throw new Error('Expéditeur du paquet inconnu')
    if (
      !(await verifySharingPayload(
        sender.signature,
        signer.signingPublicKey,
        bundlePayload(bundle),
      ))
    ) {
      throw new Error('Signature du paquet de contenu invalide')
    }
    bundle.sender = {
      fingerprint: sender.fingerprint,
      signature: sender.signature,
    }
  } else if (options.requireSignature) {
    throw new Error('Le paquet de contenu doit être signé')
  }
  return bundle
}

/** Importe le contenu d’un coffre partagé dans un fichier local. */
export async function importSharedVaultBundle(
  bundle: SharedVaultBundle,
  identity: SharingIdentity,
  file: VaultFile,
  session: VaultSession,
  nameOverride?: string,
): Promise<SharedVaultBundleImport> {
  const imported = await openSharedVaultPackage(bundle.package, identity)
  const vaultId = bundle.vault.id
  let vaultKey = imported.vaultKey
  let vaults = file.vaults
  let changed = false
  const memberRecords = bundle.package.members.map((member) => ({
    encryptionPublicKey: member.identity.encryptionPublicKey,
    signingPublicKey: member.identity.signingPublicKey,
    fingerprint: member.identity.fingerprint,
    role: member.role.role,
  }))
  const existing = file.vaults.find((vault) => vault.id === vaultId)
  let previousPackage: SharedVaultPackage | undefined
  if (existing) {
    const localSharing = await readVaultSharing(file, session, vaultId)
    const localKey = session.vaultKey(vaultId)
    if (!equalBytes(localKey, vaultKey)) {
      if (
        !localSharing.adminFingerprint ||
        localSharing.adminFingerprint !== bundle.package.admin.fingerprint
      ) {
        throw new Error(
          'Rotation refusée : le paquet ne vient pas de l’administrateur du coffre.',
        )
      }
      file = await adoptVaultKey(
        file,
        session,
        vaultId,
        vaultKey,
        bundle.package,
        memberRecords,
        bundle.package.admin.fingerprint,
        imported.role,
      )
      session.setVaultRole(vaultId, imported.role)
      previousPackage = bundle.package
      changed = true
    } else {
      previousPackage = localSharing.package
      session.setVaultKey(vaultId, vaultKey)
    }
    vaults = file.vaults
  } else {
    changed = true
    const now = new Date().toISOString()
    const initialName = await openBytes(bundle.vault.name, vaultKey, vaultMetaAad(vaultId))
    let name = 'Coffre partagé'
    try {
      const meta = JSON.parse(decoder.decode(initialName)) as { name?: unknown }
      if (typeof meta.name === 'string' && meta.name.trim()) name = meta.name
    } finally {
      wipe(initialName)
    }
    const metadata = encoder.encode(
      JSON.stringify({
        name: nameOverride?.trim() ? nameOverride.trim().slice(0, 80) : name,
        role: imported.role,
        adminFingerprint: imported.admin.fingerprint,
        members: memberRecords,
        package: bundle.package,
      }),
    )
    try {
      vaults = [
        ...file.vaults,
        {
          id: vaultId,
          key: await sealBytes(vaultKey, session.masterKey, vaultKeyAad(vaultId)),
          name: await sealBytes(metadata, vaultKey, vaultMetaAad(vaultId)),
          createdAt: bundle.vault.createdAt,
          updatedAt: now,
        },
      ]
    } finally {
      wipe(metadata)
    }
    session.setVaultKey(vaultId, vaultKey)
  }
  if (!existing) session.setVaultRole(vaultId, imported.role)

  let vaultName = 'Coffre partagé'
  try {
    const bytes = await openBytes(bundle.vault.name, vaultKey, vaultMetaAad(vaultId))
    try {
      const meta = JSON.parse(decoder.decode(bytes)) as { name?: unknown }
      if (typeof meta.name === 'string' && meta.name.trim()) vaultName = meta.name
    } finally {
      wipe(bytes)
    }
  } catch {
    // Le nom reste générique si les métadonnées sont illisibles.
  }
  if (nameOverride?.trim()) vaultName = nameOverride.trim().slice(0, 80)

  const itemsById = new Map(file.items.map((item) => [item.id, item]))
  const attachmentsById = new Map(
    file.attachments.map((attachment) => [attachment.id, attachment]),
  )
  const versionsById = new Map(file.versions.map((version) => [version.id, version]))
  const tombstonesById = new Map(
    (file.tombstones ?? []).map((tombstone) => [
      `${tombstone.kind}:${tombstone.id}`,
      tombstone,
    ]),
  )
  const importedIds = new Set<string>()
  let added = 0
  let updated = 0
  let deleted = 0
  let conflicts = 0
  for (const tombstone of bundle.tombstones) {
    const local = itemsById.get(tombstone.id)
    if (!local || local.vaultId !== vaultId) continue
    const key = `item:${tombstone.id}`
    const existing = tombstonesById.get(key)
    if (!existing || existing.deletedAt < tombstone.deletedAt) {
      tombstonesById.set(key, tombstone)
      changed = true
    }
    if (Date.parse(tombstone.deletedAt) >= Date.parse(local.updatedAt)) {
      changed = true
      itemsById.delete(tombstone.id)
      for (const [id, attachment] of attachmentsById) {
        if (attachment.itemId === tombstone.id) attachmentsById.delete(id)
      }
      for (const [id, version] of versionsById) {
        if (version.itemId === tombstone.id) versionsById.delete(id)
      }
      deleted += 1
    }
  }
  for (const candidate of bundle.items) {
    if (candidate.vaultId !== vaultId) continue
    let itemKey: Uint8Array | null = null
    try {
      itemKey = await openBytes(candidate.key, vaultKey, itemKeyAad(vaultId, candidate.id))
    } finally {
      if (itemKey) wipe(itemKey)
    }
    const local = itemsById.get(candidate.id)
    if (!local) {
      itemsById.set(candidate.id, candidate)
      importedIds.add(candidate.id)
      added += 1
      changed = true
      continue
    }
    importedIds.add(candidate.id)
    const identical =
      candidate.key.n === local.key.n &&
      candidate.key.c === local.key.c &&
      candidate.content.n === local.content.n &&
      candidate.content.c === local.content.c &&
      (candidate.updatedAt ?? '') === (local.updatedAt ?? '')
    if (identical) continue
    if (newer(candidate, local)) {
      itemsById.set(candidate.id, candidate)
      updated += 1
      changed = true
    } else if (
      candidate.content.n !== local.content.n ||
      candidate.content.c !== local.content.c
    ) {
      conflicts += 1
    }
  }

  for (const attachment of bundle.attachments) {
    if (!importedIds.has(attachment.itemId)) continue
    const local = attachmentsById.get(attachment.id)
    if (
      !local ||
      (canonicalJson(local) !== canonicalJson(attachment) &&
        newer(attachment, local))
    ) {
      if (!local || canonicalJson(local) !== canonicalJson(attachment)) changed = true
      attachmentsById.set(attachment.id, attachment)
    }
  }
  for (const version of bundle.versions) {
    if (!importedIds.has(version.itemId)) continue
    const local = versionsById.get(version.id)
    if (
      !local ||
      (canonicalJson(local) !== canonicalJson(version) &&
        newer(version, local))
    ) {
      if (!local || canonicalJson(local) !== canonicalJson(version)) changed = true
      versionsById.set(version.id, version)
    }
  }

  let nextFile: VaultFile = {
    ...file,
    updatedAt: new Date().toISOString(),
    vaults,
    items: Array.from(itemsById.values()),
    attachments: Array.from(attachmentsById.values()),
    versions: Array.from(versionsById.values()),
    tombstones: Array.from(tombstonesById.values()),
  }
  if (existing) {
    if (
      !previousPackage ||
      previousPackage.createdAt < bundle.package.createdAt
    ) {
      nextFile = await adoptVaultSharingMembers(
        nextFile,
        session,
        vaultId,
        memberRecords,
        bundle.package.admin.fingerprint,
        bundle.package,
        imported.role,
      )
      session.setVaultRole(vaultId, imported.role)
      changed = true
    }
  }
  return {
    file: nextFile,
    vaultName,
    imported: added,
    updated,
    deleted,
    conflicts,
    role: imported.role,
    changed,
  }
}

/** Utilitaire d’affichage : membres sans secret. */
export function bundleMembers(bundle: SharedVaultBundle): VaultSharingMember[] {
  return bundle.package.members.map((member) => ({
    encryptionPublicKey: member.identity.encryptionPublicKey,
    signingPublicKey: member.identity.signingPublicKey,
    fingerprint: member.identity.fingerprint,
    role: member.role.role,
  }))
}
