/**
 * Modèle de coffre local et hiérarchie de clés.
 *
 * Hiérarchie (inspirée de Proton Pass) :
 *
 *   mot de passe maître
 *          │ Argon2id + sel
 *          ▼
 *     clé maîtresse ──wrap──► clé de coffre (aléatoire, 32 octets)
 *                                   │
 *                                   ├──wrap──► clé d'élément (aléatoire)
 *                                   │                │
 *                                   │                ▼
 *                                   │          contenu chiffré
 *                                   ▼
 *                             métadonnées du coffre
 *
 * Changer le mot de passe maître ne réchiffre donc que les clés de coffre,
 * jamais les éléments.
 */

import { normalizeCustomFieldValue } from './customFields'
import {
  CryptoError,
  deriveMasterKey,
  equalBytes,
  fromBase64,
  hmacSha256,
  integrityKeyAad,
  itemAttachmentAad,
  itemContentAad,
  itemKeyAad,
  activityAad,
  generatorHistoryAad,
  aliasKeyAad,
  templateContentAad,
  templateKeyAad,
  templateRecoveryAad,
  itemVersionAad,
  KDF_DEFAULTS,
  KDF_LIMITS,
  newKdfParams,
  openBytes,
  openJson,
  randomBytes,
  randomId,
  recoveryGuardAad,
  recoveryKeyAad,
  recoveryVaultKeyAad,
  sealBytes,
  sealJson,
  sha256,
  toBase64,
  utf8,
  vaultKeyAad,
  vaultMetaAad,
  wipe,
} from './crypto'
import { normalizeDateOnly } from './expiry'
import { normalizeRecoveryPhrase } from './recovery'
import { openSharingIdentity, resealSharingIdentity } from './sharingVault'
import { parseSharedVaultPackage, type SharedVaultPackage } from './sharingPackage'
import {
  assertEmergencyRecordContacts,
  resealEmergencyRecord,
} from './emergencyVault'
import type {
  PublicSharingIdentity,
  SharingIdentity,
  ShareRole,
} from './sharing'
import type {
  ActivityEvent,
  AliasKeyService,
  AttachmentMeta,
  CustomFieldType,
  EncryptedAliasKeyRecord,
  EncryptedActivityRecord,
  EncryptedGeneratorRecord,
  EncryptedAttachmentRecord,
  EncryptedItemRecord,
  EncryptedVaultRecord,
  EncryptedTemplateRecord,
  EncryptedVersionRecord,
  EmergencyAccessRecord,
  ItemContent,
  ItemTemplate,
  ItemType,
  TemplateField,
  ItemDraft,
  GeneratorHistoryEntry,
  GeneratorHistoryState,
  KdfParams,
  RecordClock,
  RecoveryEnvelope,
  Sealed,
  RecoveryWrap,
  VaultFile,
  VaultIntegrity,
  VaultItem,
  VaultRevisionState,
  VaultSharingMember,
  VaultSummary,
  VaultTombstone,
} from './types'
import {
  isCustomFieldType,
  isItemType,
  ITEM_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_CUSTOM_FIELDS,
  MAX_ITEM_VERSIONS,
  MAX_STORED_VERSIONS,
  MAX_VAULT_ATTACHMENT_BYTES,
} from './types'
import { z } from 'zod'

export class VaultLockedError extends Error {
  constructor() {
    super('Le coffre est verrouillé')
    this.name = 'VaultLockedError'
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Mot de passe incorrect ou coffre corrompu')
    this.name = 'WrongPasswordError'
  }
}

export class VaultValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultValidationError'
  }
}

export class VaultIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultIntegrityError'
  }
}

/** Version du format `.coffre` écrite par cette version de l’application. */
export const VAULT_FILE_VERSION = 4

/**
 * Version du manifeste d’intégrité écrite par cette version. Le manifeste 3
 * couvre l’identité publique complète des contacts d’urgence.
 */
export const VAULT_MANIFEST_VERSION = 3

/** Versions de manifeste acceptées en lecture, de la plus récente à l’ancienne. */
export const VAULT_MANIFEST_VERSIONS = [3, 2, 1] as const

export type VaultManifestVersion = (typeof VAULT_MANIFEST_VERSIONS)[number]

/** Durée de conservation des pierres tombales pour la synchronisation. */
export const TOMBSTONE_RETENTION_DAYS = 180

const TOMBSTONE_RETENTION_MS = TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000

/** Plafond du nombre de pierres tombales conservées (aligné sur le schéma). */
const MAX_TOMBSTONES = 50_000

/**
 * Identifiant de l’appareil écrivain. Stable pendant la vie du processus ; il
 * sera persisté avec l’état local lors du lot de synchronisation (L3).
 */
const WRITER_ID = randomId('w')

export interface VaultIntegrityReport {
  vaults: number
  items: number
  attachments: number
  attachmentBytes: number
  versions: number
  /** Nombre d’entrées couvertes par le MAC (0 pour un fichier antérieur). */
  signedRecords: number
}

/** Version déchiffrée du contenu d’un élément. */
export interface ItemVersion {
  id: string
  itemId: string
  /** Date à laquelle cette version a été remplacée par la suivante. */
  createdAt: string
  content: ItemContent
}

export interface OpenedVault {
  file: VaultFile
  session: VaultSession
  vaults: VaultSummary[]
  items: VaultItem[]
  templates: ItemTemplate[]
  activity: ActivityEvent[]
  generatorHistory: GeneratorHistoryEntry[]
  aliasKeys: Partial<Record<AliasKeyService, string>>
  sharing: SharingIdentity | null
  warnings: string[]
  /**
   * Vrai lorsque le MAC global est absent ou invalide sur un fichier v4 : le
   * contenu est lisible, mais aucune écriture ne doit être acceptée.
   */
  readOnly: boolean
  /** État du MAC global : signé valide, fichier antérieur, ou altéré. */
  integrity: 'valid' | 'unsigned' | 'invalid'
}

export interface AttachmentInput {
  name: string
  mime: string
  bytes: Uint8Array
}

export class VaultSession {
  #masterKey: Uint8Array
  #vaultKeys = new Map<string, Uint8Array>()
  #vaultRoles = new Map<string, ShareRole>()
  #recoveryKey: Uint8Array | null = null
  #integrityKey: Uint8Array | null = null
  #locked = false

  constructor(masterKey: Uint8Array) {
    this.#masterKey = masterKey
  }

  get locked(): boolean {
    return this.#locked
  }

  get masterKey(): Uint8Array {
    this.#assertUnlocked()
    return this.#masterKey
  }

  vaultKey(vaultId: string): Uint8Array {
    this.#assertUnlocked()
    const key = this.#vaultKeys.get(vaultId)
    if (!key) throw new VaultLockedError()
    return key
  }

  hasVaultKey(vaultId: string): boolean {
    return !this.#locked && this.#vaultKeys.has(vaultId)
  }

  setVaultKey(vaultId: string, key: Uint8Array): void {
    this.#assertUnlocked()
    this.#vaultKeys.set(vaultId, key)
  }

  vaultRole(vaultId: string): ShareRole {
    this.#assertUnlocked()
    return this.#vaultRoles.get(vaultId) ?? 'write'
  }

  setVaultRole(vaultId: string, role: ShareRole): void {
    this.#assertUnlocked()
    this.#vaultRoles.set(vaultId, role)
  }

  removeVaultKey(vaultId: string): void {
    const key = this.#vaultKeys.get(vaultId)
    if (key) wipe(key)
    this.#vaultKeys.delete(vaultId)
    this.#vaultRoles.delete(vaultId)
  }

  get hasRecoveryKey(): boolean {
    return !this.#locked && this.#recoveryKey !== null
  }

  recoveryKey(): Uint8Array {
    this.#assertUnlocked()
    if (!this.#recoveryKey) throw new VaultLockedError()
    return this.#recoveryKey
  }

  setRecoveryKey(key: Uint8Array): void {
    this.#assertUnlocked()
    if (this.#recoveryKey) wipe(this.#recoveryKey)
    this.#recoveryKey = key
  }

  clearRecoveryKey(): void {
    if (this.#recoveryKey) wipe(this.#recoveryKey)
    this.#recoveryKey = null
  }

  get hasIntegrityKey(): boolean {
    return !this.#locked && this.#integrityKey !== null
  }

  integrityKey(): Uint8Array {
    this.#assertUnlocked()
    if (!this.#integrityKey) throw new VaultLockedError()
    return this.#integrityKey
  }

  setIntegrityKey(key: Uint8Array): void {
    this.#assertUnlocked()
    if (key.length !== KDF_DEFAULTS.keyLength) {
      throw new VaultValidationError('Clé d’intégrité invalide')
    }
    if (this.#integrityKey) wipe(this.#integrityKey)
    this.#integrityKey = key
  }

  clearIntegrityKey(): void {
    if (this.#integrityKey) wipe(this.#integrityKey)
    this.#integrityKey = null
  }

  replaceMasterKey(next: Uint8Array): void {
    wipe(this.#masterKey)
    this.#masterKey = next
  }

  lock(): void {
    if (this.#locked) return
    this.#locked = true
    wipe(this.#masterKey)
    if (this.#recoveryKey) wipe(this.#recoveryKey)
    this.#recoveryKey = null
    if (this.#integrityKey) wipe(this.#integrityKey)
    this.#integrityKey = null
    for (const key of this.#vaultKeys.values()) wipe(key)
    this.#vaultKeys.clear()
    this.#vaultRoles.clear()
  }

  #assertUnlocked(): void {
    if (this.#locked) throw new VaultLockedError()
  }
}

/* ------------------------------------------------------------------ */
/* Validation du format de fichier                                     */
/* ------------------------------------------------------------------ */

const idSchema = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/)

const sealedSchema = z.object({
  n: z.string().min(1).max(64),
  c: z.string().min(1),
})

const kdfSchema = z.object({
  algorithm: z.literal('argon2id'),
  salt: z.string().min(1).max(128),
  memoryKiB: z
    .number()
    .int()
    .min(KDF_LIMITS.minMemoryKiB)
    .max(KDF_LIMITS.maxMemoryKiB),
  iterations: z
    .number()
    .int()
    .min(KDF_LIMITS.minIterations)
    .max(KDF_LIMITS.maxIterations),
  parallelism: z
    .number()
    .int()
    .min(KDF_LIMITS.minParallelism)
    .max(KDF_LIMITS.maxParallelism),
  keyLength: z.literal(32),
})

const clockSchema = z.object({
  rev: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  writer: idSchema,
})

const vaultRecordSchema = z.object({
  id: idSchema,
  key: sealedSchema,
  name: sealedSchema,
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
  clock: clockSchema.optional(),
})

const itemRecordSchema = z.object({
  id: idSchema,
  vaultId: idSchema,
  key: sealedSchema,
  content: sealedSchema,
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
  clock: clockSchema.optional(),
})

const attachmentRecordSchema = z.object({
  id: idSchema,
  itemId: idSchema,
  vaultId: idSchema,
  data: sealedSchema,
  createdAt: z.string().min(1).max(40),
})

const versionRecordSchema = z.object({
  id: idSchema,
  itemId: idSchema,
  vaultId: idSchema,
  content: sealedSchema,
  createdAt: z.string().min(1).max(40),
})

const recoveryWrapSchema = z.object({
  vaultId: idSchema,
  key: sealedSchema,
})

const publicSharingIdentitySchema = z.object({
  encryptionPublicKey: z.string().min(1).max(200),
  signingPublicKey: z.string().min(1).max(200),
  fingerprint: z.string().min(1).max(200),
})

const sealedShareKeySchema = z.object({
  enc: z.string().min(1).max(200),
  ciphertext: z.string().min(1).max(20_000),
})

const emergencyShareSchema = z.object({
  contact: publicSharingIdentitySchema,
  sealed: sealedShareKeySchema,
})

const emergencyImmediateSchema = z.object({
  version: z.literal(1),
  mode: z.literal('immediate'),
  contact: publicSharingIdentitySchema,
  sealed: sealedShareKeySchema,
  createdAt: z.string().min(1).max(40),
})

const emergencyShamirSchema = z
  .object({
    version: z.literal(1),
    mode: z.literal('shamir'),
    threshold: z.number().int().min(2).max(5),
    total: z.number().int().min(2).max(5),
    shares: z.array(emergencyShareSchema).min(2).max(5),
    createdAt: z.string().min(1).max(40),
  })
  .refine(
    (value) => value.threshold <= value.total && value.shares.length === value.total,
    'Partage d’urgence incohérent',
  )

const emergencyLegacySchema = z
  .object({
    version: z.literal(1),
    contact: publicSharingIdentitySchema,
    sealed: sealedShareKeySchema,
    createdAt: z.string().min(1).max(40),
  })
  .transform((value) => ({ ...value, mode: 'immediate' as const }))

const emergencyAccessSchema = z.union([
  emergencyImmediateSchema,
  emergencyShamirSchema,
  emergencyLegacySchema,
])

const sharingIdentitySchema = z.object({
  version: z.literal(1),
  encryptionPublicKey: z.string().min(1).max(200),
  signingPublicKey: z.string().min(1).max(200),
  fingerprint: z.string().min(1).max(200),
  privateKeys: sealedSchema,
  createdAt: z.string().min(1).max(40),
})

const prfEnvelopeSchema = z.object({
  version: z.literal(1),
  credentialId: z.string().min(1).max(2_000),
  salt: z.string().min(1).max(128),
  createdAt: z.string().min(1).max(40),
  wrap: sealedSchema,
})

const recoveryEnvelopeSchema = z.object({
  version: z.literal(1),
  kdf: kdfSchema,
  createdAt: z.string().min(1).max(40),
  key: sealedSchema,
  guard: sealedSchema,
  wraps: z.array(recoveryWrapSchema).min(1).max(50),
  templateWraps: z
    .array(
      z.object({ templateId: idSchema, key: sealedSchema }),
    )
    .max(500)
    .optional(),
})

const tombstoneSchema = z.object({
  kind: z.enum(['item', 'vault', 'template']),
  id: idSchema,
  deletedAt: z.string().min(1).max(40),
})

const integritySchema = z.object({
  mac: z.string().min(1).max(128),
  key: sealedSchema,
})

const templateFieldSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  type: z.enum(['text', 'secret', 'url', 'date', 'multiline']),
  required: z.boolean().optional(),
  fillable: z.boolean().optional(),
})

const templateContentSchema = z.object({
  name: z.string().min(1).max(80),
  icon: z.string().max(16).default('📦'),
  type: z.enum(ITEM_TYPES).optional().default('note'),
  fields: z.array(templateFieldSchema).max(30),
})

const aliasKeyRecordSchema = z.object({
  service: z.enum(['simplelogin', 'addy']),
  data: sealedSchema,
  createdAt: z.string().min(1).max(40),
  clock: clockSchema.optional(),
})

const activityRecordSchema = z.object({
  id: idSchema,
  data: sealedSchema,
  createdAt: z.string().min(1).max(40),
  clock: clockSchema.optional(),
})

const generatorHistoryRecordSchema = z.object({
  id: idSchema,
  data: sealedSchema,
  createdAt: z.string().min(1).max(40),
  clock: clockSchema.optional(),
})

const generatorPayloadSchema = z.object({
  password: z.string().min(1).max(1024),
  domain: z.string().max(253).optional(),
  createdAt: z.string().max(40).optional(),
  state: z.enum(['available', 'used', 'deleted']).default('available'),
  stateAt: z.string().max(40).optional(),
  itemId: idSchema.optional(),
})

const templateRecordSchema = z.object({
  id: idSchema,
  key: sealedSchema,
  content: sealedSchema,
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
  clock: clockSchema.optional(),
})

const vaultFileSchema = z.object({
  format: z.literal('coffre'),
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  id: idSchema,
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
  kdf: kdfSchema,
  vaults: z.array(vaultRecordSchema).min(1).max(50),
  items: z.array(itemRecordSchema).max(20_000),
  attachments: z.array(attachmentRecordSchema).max(20_000).default([]),
  versions: z.array(versionRecordSchema).max(20_000).default([]),
  templates: z.array(templateRecordSchema).max(500).default([]),
  activity: z.array(activityRecordSchema).max(5_000).default([]),
  generatorHistory: z.array(generatorHistoryRecordSchema).max(200).default([]),
  aliasKeys: z.array(aliasKeyRecordSchema).max(10).default([]),
  recovery: recoveryEnvelopeSchema.optional(),
  prf: prfEnvelopeSchema.optional(),
  sharing: sharingIdentitySchema.optional(),
  emergency: emergencyAccessSchema.optional(),
  writer: idSchema.optional(),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  keyEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  tombstones: z.array(tombstoneSchema).max(50_000).optional(),
  integrity: integritySchema.optional(),
})

const customFieldSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  value: z.string().max(10_000),
  // Tolérant : un type inconnu (écrit par une version plus récente) est lu
  // comme du texte au lieu de rendre l’élément illisible.
  type: z
    .string()
    .max(40)
    .transform((type): CustomFieldType => (isCustomFieldType(type) ? type : 'text')),
})

const attachmentMetaSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  mime: z.string().max(100),
  size: z.number().int().min(0),
  createdAt: z.string().min(1).max(40),
  storage: z.enum(['inline', 'blob']).optional(),
  blobId: z.string().max(80).optional(),
  blobKey: z.string().max(200).optional(),
  sha256: z.string().max(128).optional(),
})

const itemBaseSchema = {
  title: z.string().max(200),
  favorite: z.boolean(),
  notes: z.string().max(100_000),
  tags: z.array(z.string().max(40)).max(30),
  customFields: z.array(customFieldSchema).max(MAX_CUSTOM_FIELDS).default([]),
  templateId: z.string().min(1).max(80).optional(),
  attachments: z.array(attachmentMetaSchema).max(MAX_ATTACHMENTS_PER_ITEM).default([]),
  deletedAt: z.string().max(40).nullable().optional(),
  expiresAt: z.string().max(40).default(''),
}

const loginContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('login'),
  username: z.string().max(500),
  password: z.string().max(2_000),
  urls: z.array(z.string().max(2_000)).max(30),
  totp: z.string().max(4_096),
  autotypeSequence: z.string().max(4_000).optional(),
  emailAlias: z.string().max(320).optional(),
})

const noteContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('note'),
})

const cardContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('card'),
  cardholder: z.string().max(200),
  number: z.string().max(40),
  expiry: z.string().max(10),
  cvc: z.string().max(8),
  pin: z.string().max(12),
  brand: z.string().max(40),
})

const identityContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('identity'),
  firstName: z.string().max(200),
  lastName: z.string().max(200),
  email: z.string().max(500),
  phone: z.string().max(100),
  address: z.string().max(500),
  city: z.string().max(200),
  postalCode: z.string().max(40),
  country: z.string().max(200),
  birthDate: z.string().max(40),
  passportExpiry: z.string().max(40).default(''),
  idCardExpiry: z.string().max(40).default(''),
  licenseExpiry: z.string().max(40).default(''),
})

const passkeyContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('passkey'),
  rpId: z.string().min(1).max(253),
  userHandle: z.string().max(500),
  userName: z.string().max(500),
  credentialId: z.string().min(1).max(500),
  privateKey: z.string().min(1).max(8_000),
  publicKeyCose: z.string().min(1).max(2_000),
  signCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
})

const sshKeyContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('ssh-key'),
  privateKey: z.string().max(100_000),
  publicKey: z.string().max(20_000),
  fingerprint: z.string().max(500),
  comment: z.string().max(500),
})

const wifiContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('wifi'),
  ssid: z.string().max(100),
  password: z.string().max(500),
  security: z.enum(['WPA', 'WEP', 'nopass']),
  hidden: z.boolean(),
})

const apiCredentialContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('api-credential'),
  keyId: z.string().max(500),
  secret: z.string().max(10_000),
  environment: z.string().max(100),
  endpoint: z.string().max(2_000),
})

const softwareLicenseContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('software-license'),
  licenseKey: z.string().max(10_000),
  licensedTo: z.string().max(500),
  version: z.string().max(100),
  website: z.string().max(2_000),
  purchaseDate: z.string().max(40),
})

const documentContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('document'),
  documentKind: z.enum(['identity', 'contract', 'invoice', 'certificate', 'other']),
  issuer: z.string().max(500),
  documentNumber: z.string().max(500),
  issuedAt: z.string().max(40),
})

const recoveryCodeSchema = z.object({
  id: z.string().min(1).max(80),
  code: z.string().min(1).max(200),
  usedAt: z.string().max(40).nullable().default(null),
})

const recoveryCodesContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('recovery-codes'),
  codes: z.array(recoveryCodeSchema).max(100).default([]),
})

const itemContentSchema = z.discriminatedUnion('type', [
  loginContentSchema,
  noteContentSchema,
  cardContentSchema,
  identityContentSchema,
  passkeyContentSchema,
  sshKeyContentSchema,
  wifiContentSchema,
  apiCredentialContentSchema,
  softwareLicenseContentSchema,
  documentContentSchema,
  recoveryCodesContentSchema,
])

/** Valide le contenu déchiffré d’un élément (imports, partages hors ligne). */
export function parseItemContent(raw: unknown): ItemContent {
  return itemContentSchema.parse(raw) as ItemContent
}

export function parseVaultFile(raw: unknown): VaultFile {
  let file: VaultFile
  try {
    file = vaultFileSchema.parse(raw) as VaultFile
  } catch (error) {
    throw new VaultValidationError(
      `Fichier de coffre invalide : ${error instanceof Error ? error.message : 'format inconnu'}`,
    )
  }

  const vaultIds = new Set<string>()
  const vaultById = new Map<string, EncryptedVaultRecord>()
  for (const vault of file.vaults) {
    if (vaultIds.has(vault.id)) {
      throw new VaultValidationError('Fichier invalide : identifiant de coffre en double')
    }
    vaultIds.add(vault.id)
    vaultById.set(vault.id, vault)
  }

  const itemIds = new Set<string>()
  const itemById = new Map<string, EncryptedItemRecord>()
  for (const item of file.items) {
    if (itemIds.has(item.id)) {
      throw new VaultValidationError('Fichier invalide : identifiant d’élément en double')
    }
    if (!vaultIds.has(item.vaultId)) {
      throw new VaultValidationError('Fichier invalide : élément rattaché à un coffre inconnu')
    }
    itemIds.add(item.id)
    itemById.set(item.id, item)
  }

  const attachmentIds = new Set<string>()
  for (const attachment of file.attachments) {
    if (attachmentIds.has(attachment.id)) {
      throw new VaultValidationError('Fichier invalide : identifiant de pièce jointe en double')
    }
    const item = itemById.get(attachment.itemId)
    if (!item) {
      throw new VaultValidationError(
        'Fichier invalide : pièce jointe rattachée à un élément inconnu',
      )
    }
    if (item.vaultId !== attachment.vaultId) {
      throw new VaultValidationError('Fichier invalide : coffre de pièce jointe incohérent')
    }
    attachmentIds.add(attachment.id)
  }

  const versionIds = new Set<string>()
  for (const version of file.versions) {
    if (versionIds.has(version.id)) {
      throw new VaultValidationError('Fichier invalide : identifiant de version en double')
    }
    const item = itemById.get(version.itemId)
    if (!item) {
      throw new VaultValidationError(
        'Fichier invalide : version rattachée à un élément inconnu',
      )
    }
    if (item.vaultId !== version.vaultId) {
      throw new VaultValidationError('Fichier invalide : coffre de version incohérent')
    }
    versionIds.add(version.id)
  }

  if (file.recovery) {
    const wrapped = new Set<string>()
    for (const wrap of file.recovery.wraps) {
      if (wrapped.has(wrap.vaultId)) {
        throw new VaultValidationError(
          'Fichier invalide : clé de récupération en double pour un coffre',
        )
      }
      if (!vaultIds.has(wrap.vaultId)) {
        throw new VaultValidationError(
          'Fichier invalide : clé de récupération rattachée à un coffre inconnu',
        )
      }
      wrapped.add(wrap.vaultId)
    }
    for (const vaultId of vaultIds) {
      if (!wrapped.has(vaultId)) {
        throw new VaultValidationError(
          'Fichier invalide : enveloppe de récupération incomplète',
        )
      }
    }
  }

  // Cohérence des champs du format 4. Un fichier antérieur ne doit pas en
  // contenir : accepter un v4 « dégradé » en v3 permettrait de contourner le MAC.
  const hasV4Fields =
    file.writer !== undefined ||
    file.revision !== undefined ||
    file.keyEpoch !== undefined ||
    file.tombstones !== undefined ||
    file.integrity !== undefined ||
    file.prf !== undefined ||
    file.sharing !== undefined ||
    file.emergency !== undefined

  if (file.version === 4) {
    if (
      !file.writer ||
      file.revision === undefined ||
      file.revision < 1 ||
      file.keyEpoch === undefined ||
      !file.tombstones ||
      !file.integrity
    ) {
      throw new VaultValidationError(
        'Fichier invalide : champs de synchronisation ou d’intégrité manquants pour la version 4',
      )
    }
    for (const vault of file.vaults) {
      if (!vault.clock) {
        throw new VaultValidationError(
          'Fichier invalide : horloge absente sur un coffre de version 4',
        )
      }
    }
    for (const item of file.items) {
      if (!item.clock) {
        throw new VaultValidationError(
          'Fichier invalide : horloge absente sur un élément de version 4',
        )
      }
    }

    const tombstoneKeys = new Set<string>()
    for (const tombstone of file.tombstones) {
      const key = `${tombstone.kind}:${tombstone.id}`
      if (tombstoneKeys.has(key)) {
        throw new VaultValidationError(
          'Fichier invalide : pierre tombale en double',
        )
      }
      tombstoneKeys.add(key)
      if (Number.isNaN(Date.parse(tombstone.deletedAt))) {
        throw new VaultValidationError(
          'Fichier invalide : date de pierre tombale invalide',
        )
      }
      if (tombstone.kind === 'item') {
        const item = itemById.get(tombstone.id)
        if (
          item &&
          Date.parse(tombstone.deletedAt) >= Date.parse(item.updatedAt)
        ) {
          throw new VaultValidationError(
            'Fichier invalide : un élément supprimé est encore présent',
          )
        }
      }
      if (tombstone.kind === 'vault') {
        const vault = vaultById.get(tombstone.id)
        if (
          vault &&
          Date.parse(tombstone.deletedAt) >= Date.parse(vault.updatedAt)
        ) {
          throw new VaultValidationError(
            'Fichier invalide : un coffre supprimé est encore présent',
          )
        }
      }
    }
  } else if (hasV4Fields) {
    throw new VaultValidationError(
      'Fichier invalide : champs du format 4 présents dans un fichier antérieur',
    )
  }

  // Les fichiers versions 1 et 2 n’ont ni historique ni enveloppe de
  // récupération : ils sont lus puis migrés en version 3 à l’enregistrement.
  // La migration en version 4 a lieu à la première écriture signée.
  return file.version === 4 ? file : { ...file, version: 3 }
}

export function parseVaultFileText(text: string): VaultFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new VaultValidationError('Ce fichier n’est pas un coffre Coffre valide (JSON illisible)')
  }
  return parseVaultFile(raw)
}

/* ------------------------------------------------------------------ */
/* Manifeste canonique et MAC global (format 4)                        */
/* ------------------------------------------------------------------ */

interface ManifestRecord {
  type:
    | 'vault'
    | 'item'
    | 'attachment'
    | 'version'
    | 'template'
    | 'activity'
    | 'alias-key'
    | 'sharing'
    | 'emergency'
    | 'generator-history'
  id: string
  vaultId: string
  /** Élément parent pour une pièce jointe ou une version. */
  parentId?: string
  rev: number
  writer: string
  /** SHA-256 du couple nonce + ciphertext, en base64. */
  ciphertext: string
}

interface VaultManifest {
  manifest: VaultManifestVersion
  file: string
  writer: string
  revision: number
  keyEpoch: number
  records: ManifestRecord[]
  tombstones: VaultTombstone[]
}

/**
 * Sérialisation JSON canonique : clés d’objet triées récursivement, tableaux
 * dans l’ordre fourni (les appelants trient explicitement). Deux fichiers
 * équivalents produisent donc exactement les mêmes octets.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  }
  const object = value as Record<string, unknown>
  const keys = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}

async function sealedDigest(sealed: { n: string; c: string }): Promise<string> {
  const bytes = new TextEncoder().encode(`${sealed.n}.${sealed.c}`)
  try {
    return toBase64(await sha256(bytes))
  } finally {
    wipe(bytes)
  }
}

/**
 * Empreinte du manifeste 3 pour un accès d’urgence. Contrairement au manifeste
 * 2, elle couvre les deux clés publiques du contact en plus de son empreinte et
 * de l’enveloppe scellée. Une clé remplacée sans changer le MAC invalide donc
 * le fichier.
 */
async function emergencyIdentityDigest(
  record: EmergencyAccessRecord,
): Promise<string> {
  const contact = (value: PublicSharingIdentity) => ({
    encryptionPublicKey: value.encryptionPublicKey,
    signingPublicKey: value.signingPublicKey,
    fingerprint: value.fingerprint,
  })
  const sealed = (value: { enc: string; ciphertext: string }) => ({
    enc: value.enc,
    ciphertext: value.ciphertext,
  })
  const payload =
    record.mode === 'immediate'
      ? {
          mode: 'immediate',
          contact: contact(record.contact),
          sealed: sealed(record.sealed),
        }
      : {
          mode: 'shamir',
          threshold: record.threshold,
          total: record.total,
          shares: record.shares.map((share) => ({
            contact: contact(share.contact),
            sealed: sealed(share.sealed),
          })),
        }
  const bytes = utf8(canonicalJson(payload))
  try {
    return toBase64(await sha256(bytes))
  } finally {
    wipe(bytes)
  }
}

const RECORD_TYPE_ORDER: Record<ManifestRecord['type'], number> = {
  vault: 0,
  item: 1,
  attachment: 2,
  version: 3,
  template: 4,
  activity: 5,
  'alias-key': 6,
  sharing: 7,
  emergency: 8,
  'generator-history': 9,
}

/**
 * Manifeste couvert par le MAC. Il ne contient aucun contenu déchiffré : seuls
 * les identifiants, les horloges et l’empreinte des ciphertexts.
 */
export async function computeManifest(
  file: VaultFile,
  manifestVersion: VaultManifestVersion = VAULT_MANIFEST_VERSION,
): Promise<VaultManifest> {
  if (
    file.version !== VAULT_FILE_VERSION ||
    file.revision === undefined ||
    file.keyEpoch === undefined
  ) {
    throw new VaultValidationError(
      'Le manifeste d’intégrité exige un fichier de version 4',
    )
  }

  const records: ManifestRecord[] = []

  for (const vault of file.vaults) {
    records.push({
      type: 'vault',
      id: vault.id,
      vaultId: vault.id,
      rev: vault.clock?.rev ?? 0,
      writer: vault.clock?.writer ?? '',
      ciphertext: await sealedDigest(vault.key),
    })
    records.push({
      type: 'vault',
      id: `${vault.id}:name`,
      vaultId: vault.id,
      rev: vault.clock?.rev ?? 0,
      writer: vault.clock?.writer ?? '',
      ciphertext: await sealedDigest(vault.name),
    })
  }

  for (const item of file.items) {
    records.push({
      type: 'item',
      id: item.id,
      vaultId: item.vaultId,
      rev: item.clock?.rev ?? 0,
      writer: item.clock?.writer ?? '',
      ciphertext: await sealedDigest(item.content),
    })
    // La clé d’élément et le contenu sont deux ciphertexts distincts : couvrir
    // les deux empêche de remplacer l’un sans l’autre.
    records.push({
      type: 'item',
      id: `${item.id}:key`,
      vaultId: item.vaultId,
      rev: item.clock?.rev ?? 0,
      writer: item.clock?.writer ?? '',
      ciphertext: await sealedDigest(item.key),
    })
  }

  const itemClocks = new Map(
    file.items.map((item) => [item.id, item.clock]),
  )

  for (const attachment of file.attachments) {
    records.push({
      type: 'attachment',
      id: attachment.id,
      vaultId: attachment.vaultId,
      parentId: attachment.itemId,
      rev: itemClocks.get(attachment.itemId)?.rev ?? 0,
      writer: itemClocks.get(attachment.itemId)?.writer ?? '',
      ciphertext: await sealedDigest(attachment.data),
    })
  }

  for (const alias of file.aliasKeys ?? []) {
    records.push({
      type: 'alias-key',
      id: alias.service,
      vaultId: '',
      rev: alias.clock?.rev ?? 0,
      writer: alias.clock?.writer ?? '',
      ciphertext: await sealedDigest(alias.data),
    })
  }

  if (file.sharing) {
    records.push({
      type: 'sharing',
      id: file.sharing.fingerprint,
      vaultId: '',
      rev: 0,
      writer: '',
      ciphertext: await sealedDigest(file.sharing.privateKeys),
    })
  }

  if (file.emergency) {
    const emergency = file.emergency
    const digest =
      manifestVersion >= 3
        ? await emergencyIdentityDigest(emergency)
        : emergency.mode === 'immediate'
          ? await sealedDigest({
              n: emergency.sealed.enc,
              c: emergency.sealed.ciphertext,
            })
          : await sealedDigest({
              n: emergency.shares.map((share) => share.sealed.enc).join('.'),
              c: emergency.shares
                .map((share) => share.sealed.ciphertext)
                .join('.'),
            })
    records.push({
      type: 'emergency',
      id:
        emergency.mode === 'immediate'
          ? emergency.contact.fingerprint
          : `shamir:${emergency.threshold}/${emergency.total}:${emergency.shares
              .map((share) => share.contact.fingerprint)
              .join(',')}`,
      vaultId: '',
      rev: 0,
      writer: '',
      ciphertext: digest,
    })
  }

  for (const event of file.activity ?? []) {
    records.push({
      type: 'activity',
      id: event.id,
      vaultId: '',
      rev: event.clock?.rev ?? 0,
      writer: event.clock?.writer ?? '',
      ciphertext: await sealedDigest(event.data),
    })
  }

  for (const template of file.templates ?? []) {
    records.push({
      type: 'template',
      id: template.id,
      vaultId: '',
      rev: template.clock?.rev ?? 0,
      writer: template.clock?.writer ?? '',
      ciphertext: await sealedDigest(template.key),
    })
    records.push({
      type: 'template',
      id: `${template.id}:content`,
      vaultId: '',
      rev: template.clock?.rev ?? 0,
      writer: template.clock?.writer ?? '',
      ciphertext: await sealedDigest(template.content),
    })
  }

  if (manifestVersion >= 2) {
    for (const entry of file.generatorHistory ?? []) {
      records.push({
        type: 'generator-history',
        id: entry.id,
        vaultId: '',
        rev: entry.clock?.rev ?? 0,
        writer: entry.clock?.writer ?? '',
        ciphertext: await sealedDigest(entry.data),
      })
    }
  }

  for (const version of file.versions) {
    records.push({
      type: 'version',
      id: version.id,
      vaultId: version.vaultId,
      parentId: version.itemId,
      rev: itemClocks.get(version.itemId)?.rev ?? 0,
      writer: itemClocks.get(version.itemId)?.writer ?? '',
      ciphertext: await sealedDigest(version.content),
    })
  }

  records.sort(
    (a, b) =>
      RECORD_TYPE_ORDER[a.type] - RECORD_TYPE_ORDER[b.type] ||
      a.id.localeCompare(b.id),
  )

  const tombstones = [...(file.tombstones ?? [])].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  )

  return {
    manifest: manifestVersion,
    file: file.id,
    writer: file.writer ?? '',
    revision: file.revision,
    keyEpoch: file.keyEpoch,
    records,
    tombstones,
  }
}

async function computeMac(
  file: VaultFile,
  key: Uint8Array,
  manifestVersion: VaultManifestVersion = VAULT_MANIFEST_VERSION,
): Promise<Uint8Array> {
  const manifest = await computeManifest(file, manifestVersion)
  const bytes = new TextEncoder().encode(canonicalJson(manifest))
  try {
    return await hmacSha256(key, bytes)
  } finally {
    wipe(bytes)
  }
}

/**
 * Vérifie le MAC global d’un fichier v4 avec la clé d’intégrité en clair.
 *
 * Le manifeste 3 couvre l’identité publique complète des contacts d’urgence ;
 * les manifestes 2 et 1 restent lisibles et sont réécrits en manifeste 3 à la
 * première mutation.
 */
export async function verifyFileMac(
  file: VaultFile,
  integrityKey: Uint8Array,
): Promise<boolean> {
  if (file.version !== VAULT_FILE_VERSION || !file.integrity) return false
  try {
    const expected = fromBase64(file.integrity.mac)
    for (const manifestVersion of VAULT_MANIFEST_VERSIONS) {
      const actual = await computeMac(file, integrityKey, manifestVersion)
      if (equalBytes(expected, actual)) return true
    }
    return false
  } catch {
    return false
  }
}

function mergeTombstones(
  previous: VaultFile | undefined,
  next: VaultFile,
  now: string,
): VaultTombstone[] {
  const merged = new Map<string, VaultTombstone>()
  const add = (tombstone: VaultTombstone) => {
    const key = `${tombstone.kind}:${tombstone.id}`
    const existing = merged.get(key)
    if (!existing || existing.deletedAt < tombstone.deletedAt) {
      merged.set(key, tombstone)
    }
  }

  for (const tombstone of previous?.tombstones ?? []) add(tombstone)
  for (const tombstone of next.tombstones ?? []) add(tombstone)

  if (previous) {
    const nextItemIds = new Set(next.items.map((item) => item.id))
    const nextVaultIds = new Set(next.vaults.map((vault) => vault.id))
    const nextTemplateIds = new Set((next.templates ?? []).map((template) => template.id))
    for (const template of previous.templates ?? []) {
      if (!nextTemplateIds.has(template.id)) {
        add({ kind: 'template', id: template.id, deletedAt: now })
      }
    }
    for (const item of previous.items) {
      if (!nextItemIds.has(item.id)) {
        add({ kind: 'item', id: item.id, deletedAt: now })
      }
    }
    for (const vault of previous.vaults) {
      if (!nextVaultIds.has(vault.id)) {
        add({ kind: 'vault', id: vault.id, deletedAt: now })
      }
    }
  }

  // Les pierres tombales sont conservées même si un enregistrement plus récent
  // a ressuscité le même identifiant : elles servent à écarter l’historique et
  // les pièces jointes antérieurs lors des fusions suivantes.

  const cutoff = Date.parse(now) - TOMBSTONE_RETENTION_MS
  return [...merged.values()]
    .filter((tombstone) => {
      const deletedAt = Date.parse(tombstone.deletedAt)
      return Number.isNaN(deletedAt) || deletedAt >= cutoff
    })
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
    .slice(0, MAX_TOMBSTONES)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}

function changedRecord(
  previous:
    | {
        key?: { n: string; c: string }
        name?: { n: string; c: string }
        content?: { n: string; c: string }
        data?: { n: string; c: string }
      }
    | undefined,
  next: {
    key?: { n: string; c: string }
    name?: { n: string; c: string }
    content?: { n: string; c: string }
    data?: { n: string; c: string }
  },
): boolean {
  if (!previous) return true
  if (
    previous.key &&
    next.key &&
    (previous.key.n !== next.key.n || previous.key.c !== next.key.c)
  ) {
    return true
  }
  if (previous.data && next.data) {
    return previous.data.n !== next.data.n || previous.data.c !== next.data.c
  }
  if (previous.name && next.name) {
    return previous.name.n !== next.name.n || previous.name.c !== next.name.c
  }
  if (previous.content && next.content) {
    return (
      previous.content.n !== next.content.n ||
      previous.content.c !== next.content.c
    )
  }
  return false
}

/**
 * Prépare la prochaine écriture v4 : révision du fichier, horloges par
 * enregistrement, pierres tombales, rotation du sel de clé d’intégrité et MAC
 * global. À appeler **avant** chaque `saveVaultFile`, jamais après.
 */
export async function signVaultFile(
  file: VaultFile,
  session: VaultSession,
  previous?: VaultFile,
  options: { minimumRevision?: number; createTombstones?: boolean } = {},
): Promise<VaultFile> {
  assertUnlocked(session)

  const previousItems = new Map(
    (previous?.items ?? []).map((item) => [item.id, item]),
  )
  const previousVaults = new Map(
    (previous?.vaults ?? []).map((vault) => [vault.id, vault]),
  )
  const previousTemplates = new Map(
    (previous?.templates ?? []).map((template) => [template.id, template]),
  )
  const previousActivity = new Map(
    (previous?.activity ?? []).map((event) => [event.id, event]),
  )
  const previousAliasKeys = new Map(
    (previous?.aliasKeys ?? []).map((entry) => [entry.service, entry]),
  )
  const previousGeneratorHistory = new Map(
    (previous?.generatorHistory ?? []).map((entry) => [entry.id, entry]),
  )

  let highestRev = Math.max(
    file.revision ?? 0,
    previous?.revision ?? 0,
    options.minimumRevision ?? 0,
  )
  for (const record of [...file.items, ...file.vaults]) {
    highestRev = Math.max(highestRev, record.clock?.rev ?? 0)
  }
  const revision = highestRev + 1
  const keyEpoch = Math.max(file.keyEpoch ?? 1, previous?.keyEpoch ?? 1)
  const now = new Date().toISOString()
  const tombstones =
    options.createTombstones === false
      ? (file.tombstones ?? [])
      : mergeTombstones(previous, file, now)

  const clockFor = (
    previousRecord: { clock?: RecordClock } | undefined,
    changed: boolean,
  ): RecordClock => {
    if (!changed && previousRecord?.clock) {
      return { ...previousRecord.clock }
    }
    return { rev: revision, writer: WRITER_ID }
  }

  const vaults: EncryptedVaultRecord[] = file.vaults.map((vault) => ({
    ...vault,
    clock: clockFor(
      previousVaults.get(vault.id),
      changedRecord(previousVaults.get(vault.id), vault),
    ),
  }))

  const items: EncryptedItemRecord[] = file.items.map((item) => ({
    ...item,
    clock: clockFor(
      previousItems.get(item.id),
      changedRecord(previousItems.get(item.id), item),
    ),
  }))

  const templates = (file.templates ?? []).map((template) => ({
    ...template,
    clock: clockFor(
      previousTemplates.get(template.id),
      changedRecord(previousTemplates.get(template.id), template),
    ),
  }))

  const aliasKeys = (file.aliasKeys ?? []).map((entry) => ({
    ...entry,
    clock: clockFor(
      previousAliasKeys.get(entry.service),
      changedRecord(previousAliasKeys.get(entry.service), entry),
    ),
  }))

  const activity = (file.activity ?? []).map((event) => ({
    ...event,
    clock: clockFor(
      previousActivity.get(event.id),
      changedRecord(previousActivity.get(event.id), event),
    ),
  }))

  const generatorHistory = (file.generatorHistory ?? []).map((entry) => ({
    ...entry,
    clock: clockFor(
      previousGeneratorHistory.get(entry.id),
      changedRecord(previousGeneratorHistory.get(entry.id), entry),
    ),
  }))

  if (!session.hasIntegrityKey) {
    session.setIntegrityKey(randomBytes(KDF_DEFAULTS.keyLength))
  }

  const next: VaultFile = {
    ...file,
    version: VAULT_FILE_VERSION,
    writer: WRITER_ID,
    revision,
    keyEpoch,
    tombstones,
    vaults,
    items,
    ...(templates.length > 0 ? { templates } : {}),
    ...(activity.length > 0 ? { activity } : {}),
    ...(generatorHistory.length > 0 ? { generatorHistory } : {}),
    ...(aliasKeys.length > 0 ? { aliasKeys } : {}),
    updatedAt: file.version === 4 ? file.updatedAt : now,
    integrity: {
      mac: '',
      key: await sealBytes(session.integrityKey(), session.masterKey, integrityKeyAad()),
    },
  }

  const mac = await computeMac(next, session.integrityKey())
  return {
    ...next,
    integrity: { ...(next.integrity as VaultIntegrity), mac: toBase64(mac) },
  }
}

/**
 * Compare la révision du fichier à la plus haute révision déjà vue sur cet
 * appareil. Renvoie un avertissement explicite si le fichier a reculé.
 */
export function checkVaultRollback(
  file: VaultFile,
  state: VaultRevisionState | null | undefined,
): string | null {
  if (!state || state.fileId !== file.id) return null
  if (file.version !== 4) {
    if (state.revision > 0) {
      return 'La signature de version 4 de ce fichier a disparu : il peut s’agir d’une substitution par un ancien fichier. Vérifiez son origine avant de le modifier.'
    }
    return null
  }
  if ((file.revision ?? 0) < state.revision) {
    return `Ce fichier est une version antérieure à celle déjà ouverte sur cet appareil (révision ${file.revision ?? 0} au lieu de ${state.revision}). Vérifiez son origine ; une restauration volontaire depuis l’écran des sauvegardes n’affiche pas cet avertissement.`
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Cycle de vie                                                        */
/* ------------------------------------------------------------------ */

function vaultSummary(
  record: EncryptedVaultRecord,
  name: string,
  items: VaultItem[],
  role: ShareRole = 'write',
): VaultSummary {
  return {
    id: record.id,
    name,
    role,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    itemCount: items.filter((item) => item.vaultId === record.id && !item.deletedAt).length,
  }
}

async function createVaultRecord(
  name: string,
  masterKey: Uint8Array,
): Promise<{ record: EncryptedVaultRecord; key: Uint8Array }> {
  const id = randomId('v')
  const key = randomBytes(32)
  const now = new Date().toISOString()

  const record: EncryptedVaultRecord = {
    id,
    key: await sealBytes(key, masterKey, vaultKeyAad(id)),
    name: await sealJson({ name }, key, vaultMetaAad(id)),
    createdAt: now,
    updatedAt: now,
  }

  return { record, key }
}

export async function createVaultFile(
  password: string,
  name = 'Personnel',
  kdfOverrides: Partial<KdfParams> = {},
): Promise<OpenedVault> {
  const now = new Date().toISOString()
  const kdf: KdfParams = { ...newKdfParams(), ...kdfOverrides, algorithm: 'argon2id' }
  const masterKey = await deriveMasterKey(password, kdf)

  try {
    const { record, key } = await createVaultRecord(name, masterKey)
    const session = new VaultSession(masterKey)
    session.setVaultKey(record.id, key)

    const draft: VaultFile = {
      format: 'coffre',
      version: 3,
      id: randomId('vf'),
      createdAt: now,
      updatedAt: now,
      kdf,
      vaults: [record],
      items: [],
      attachments: [],
      versions: [],
    }

    const file = await signVaultFile(draft, session)

    return {
      file,
      session,
      vaults: [vaultSummary(record, name, [])],
      items: [],
      templates: [],
      activity: [],
      generatorHistory: [],
      aliasKeys: {},
      sharing: null,
      warnings: [],
      readOnly: false,
      integrity: 'valid',
    }
  } catch (error) {
    wipe(masterKey)
    throw error
  }
}

/** Une date de corbeille absente ou invalide est traitée comme « actif ». */
function normalizeDeletedAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

export async function unlockVaultFile(
  file: VaultFile,
  password: string,
): Promise<OpenedVault> {
  const masterKey = await deriveMasterKey(password, file.kdf)
  try {
    return await openVaultFileWithMasterKey(file, masterKey)
  } finally {
    // `openVaultFileWithMasterKey` copie la clé dans la session ; l’appelant
    // peut donc effacer son tampon sans casser la session.
    wipe(masterKey)
  }
}

/**
 * Ouvre un fichier avec une clé maîtresse déjà dérivée. Utilisé par le
 * déverrouillage classique et par la récupération par phrase.
 */
export async function openVaultFileWithMasterKey(
  file: VaultFile,
  masterKey: Uint8Array,
): Promise<OpenedVault> {
  // La session reçoit sa propre copie : l’appelant reste propriétaire du
  // tampon `masterKey` et peut l’effacer après l’appel (déverrouillage par
  // trousseau ou biométrie). Sans cette copie, un `wipe` côté appelant
  // effacerait la clé maîtresse de la session.
  const session = new VaultSession(masterKey.slice())
  const warnings: string[] = []
  const vaults: VaultSummary[] = []
  const items: VaultItem[] = []
  const openVaultIds = new Set<string>()

  for (const record of file.vaults) {
    let vaultKey: Uint8Array | null = null
    try {
      vaultKey = await openBytes(record.key, masterKey, vaultKeyAad(record.id))
      if (vaultKey.length !== KDF_DEFAULTS.keyLength) throw new CryptoError('Clé invalide')
    } catch {
      if (vaultKey) wipe(vaultKey)
      warnings.push('Un coffre n’a pas pu être déverrouillé.')
      continue
    }

    if (!vaultKey) continue
    session.setVaultKey(record.id, vaultKey)
    openVaultIds.add(record.id)

    let name = 'Coffre sans nom'
    let role: ShareRole = 'write'
    let adminFingerprint: string | undefined
    try {
      const meta = await openJson<{ name?: unknown; role?: unknown; adminFingerprint?: unknown }>(
        record.name,
        vaultKey,
        vaultMetaAad(record.id),
      )
      if (typeof meta.name === 'string' && meta.name.trim()) name = meta.name
      if (meta.role === 'read') role = 'read'
      if (typeof meta.adminFingerprint === 'string') adminFingerprint = meta.adminFingerprint
    } catch {
      warnings.push('Le nom d’un coffre n’a pas pu être déchiffré.')
    }
    session.setVaultRole(record.id, role)
    vaults.push({
      ...vaultSummary(record, name, [], role),
      ...(adminFingerprint ? { adminFingerprint } : {}),
    })
  }

  if (openVaultIds.size === 0) {
    session.lock()
    throw new WrongPasswordError()
  }

  // La clé de récupération est conservée en mémoire pour pouvoir maintenir
  // l’enveloppe (ajout de coffre, changement de mot de passe). Son absence
  // n’empêche pas d’utiliser le coffre, mais empêche de le faire évoluer sans
  // régénérer la phrase.
  if (file.recovery) {
    try {
      const recoveryKey = await openBytes(file.recovery.guard, masterKey, recoveryGuardAad())
      if (recoveryKey.length !== KDF_DEFAULTS.keyLength) {
        throw new CryptoError('Clé de récupération invalide')
      }
      session.setRecoveryKey(recoveryKey)
    } catch {
      warnings.push(
        'La clé de récupération n’a pas pu être maintenue ; régénérez la phrase depuis les réglages.',
      )
    }
  }

  // Vérification du MAC global. Un fichier v4 sans intégrité, ou dont la clé
  // d’intégrité ne s’ouvre pas, est considéré comme altéré : l’ouverture reste
  // possible en lecture seule pour permettre l’export d’une sauvegarde.
  let integrityState: OpenedVault['integrity'] = 'unsigned'
  if (file.version === 4) {
    integrityState = 'invalid'
    if (!file.integrity) {
      warnings.push(
        'La signature du fichier de version 4 est absente. Le coffre est ouvert en lecture seule ; exportez une sauvegarde et vérifiez son origine.',
      )
    } else {
      let integrityKey: Uint8Array | null = null
      try {
        integrityKey = await openBytes(
          file.integrity.key,
          masterKey,
          integrityKeyAad(),
        )
        if (integrityKey.length !== KDF_DEFAULTS.keyLength) {
          throw new CryptoError('Clé d’intégrité invalide')
        }
        session.setIntegrityKey(integrityKey)
        integrityKey = null
        if (await verifyFileMac(file, session.integrityKey())) {
          integrityState = 'valid'
        } else {
          warnings.push(
            'Le fichier de coffre a été modifié hors de Coffre (MAC global invalide). Il est ouvert en lecture seule ; exportez une sauvegarde et vérifiez son origine.',
          )
        }
      } catch {
        warnings.push(
          'Le fichier de coffre a été modifié hors de Coffre (clé d’intégrité illisible). Il est ouvert en lecture seule ; exportez une sauvegarde et vérifiez son origine.',
        )
      } finally {
        if (integrityKey) wipe(integrityKey)
      }
    }

    // Le manifeste 3 couvre les clés publiques d’urgence. Ce contrôle protège
    // aussi les anciens fichiers signés en manifeste 2 : une clé remplacée avec
    // l’empreinte d’origine est détectée avant tout changement de mot de passe.
    if (file.emergency) {
      try {
        await assertEmergencyRecordContacts(file.emergency)
      } catch {
        warnings.push(
          'L’accès d’urgence est incohérent : l’empreinte ne correspond pas aux clés publiques. Le coffre est ouvert en lecture seule ; reconfigurez l’accès d’urgence avant toute rotation.',
        )
        integrityState = 'invalid'
      }
    }
  }

  const openVaultMap = new Map(vaults.map((vault) => [vault.id, vault]))

  const templates: ItemTemplate[] = []
  for (const record of file.templates ?? []) {
    let templateKey: Uint8Array | null = null
    try {
      templateKey = await openBytes(
        record.key,
        masterKey,
        templateKeyAad(record.id),
      )
      const content = await openJson<unknown>(
        record.content,
        templateKey,
        templateContentAad(record.id),
      )
      const parsed = templateContentSchema.parse(content)
      templates.push({
        id: record.id,
        name: parsed.name,
        icon: parsed.icon,
        type: parsed.type,
        fields: parsed.fields,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      })
    } catch {
      warnings.push('Un modèle d’élément n’a pas pu être déchiffré et a été ignoré.')
    } finally {
      if (templateKey) wipe(templateKey)
    }
  }

  const activity: ActivityEvent[] = []
  for (const record of file.activity ?? []) {
    try {
      const event = await openJson<ActivityEvent>(
        record.data,
        masterKey,
        activityAad(record.id),
      )
      activity.push({
        ...event,
        id: record.id,
        at: event.at || record.createdAt,
        detail: event.detail.slice(0, 500),
        ...(event.host ? { host: event.host.slice(0, 253) } : {}),
      })
    } catch {
      warnings.push('Un événement du journal d’activité n’a pas pu être déchiffré.')
    }
  }
  activity.sort((a, b) => b.at.localeCompare(a.at))

  const generatorHistory: GeneratorHistoryEntry[] = []
  for (const record of file.generatorHistory ?? []) {
    try {
      const payload = generatorPayloadSchema.parse(
        await openJson<unknown>(
          record.data,
          masterKey,
          generatorHistoryAad(record.id),
        ),
      )
      generatorHistory.push({
        id: record.id,
        password: payload.password,
        ...(payload.domain ? { domain: payload.domain } : {}),
        createdAt: payload.createdAt || record.createdAt,
        state: payload.state,
        ...(payload.stateAt ? { stateAt: payload.stateAt } : {}),
        ...(payload.itemId ? { itemId: payload.itemId } : {}),
      })
    } catch {
      warnings.push(
        'Une entrée de l’historique du générateur n’a pas pu être déchiffrée.',
      )
    }
  }
  generatorHistory.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const aliasKeys: Partial<Record<AliasKeyService, string>> = {}
  for (const record of file.aliasKeys ?? []) {
    try {
      const value = await openJson<{ key?: unknown }>(
        record.data,
        masterKey,
        aliasKeyAad(record.service),
      )
      if (typeof value.key === 'string') aliasKeys[record.service] = value.key
    } catch {
      warnings.push('Une clé API d’alias n’a pas pu être déchiffrée.')
    }
  }

  for (const record of file.items) {
    if (!openVaultIds.has(record.vaultId)) {
      warnings.push('Un élément appartient à un coffre inaccessible.')
      continue
    }

    let itemKey: Uint8Array | null = null
    try {
      const vaultKey = session.vaultKey(record.vaultId)
      itemKey = await openBytes(
        record.key,
        vaultKey,
        itemKeyAad(record.vaultId, record.id),
      )
      const content = await openJson<ItemContent>(
        record.content,
        itemKey,
        itemContentAad(record.vaultId, record.id),
      )

      const parsed = itemContentSchema.parse(content) as ItemContent
      if (!isItemType(parsed.type)) throw new Error('Type inconnu')

      const knownAttachmentIds = new Set(
        file.attachments
          .filter((attachment) => attachment.itemId === record.id)
          .map((attachment) => attachment.id),
      )
      const attachments = parsed.attachments.filter((attachment) =>
        knownAttachmentIds.has(attachment.id),
      )
      if (attachments.length !== parsed.attachments.length) {
        warnings.push('Une pièce jointe référencée par un élément est introuvable.')
      }

      const item = {
        ...parsed,
        attachments,
        deletedAt: normalizeDeletedAt(parsed.deletedAt),
        id: record.id,
        vaultId: record.vaultId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      } as VaultItem

      items.push(item)
      const summary = openVaultMap.get(record.vaultId)
      if (summary && !item.deletedAt) summary.itemCount += 1
    } catch {
      warnings.push('Un élément n’a pas pu être déchiffré et a été ignoré.')
    } finally {
      if (itemKey) wipe(itemKey)
    }
  }

  let sharing: SharingIdentity | null = null
  if (file.sharing) {
    try {
      sharing = await openSharingIdentity(file.sharing, session.masterKey, file.id)
    } catch {
      warnings.push('L’identité de partage n’a pas pu être déchiffrée.')
    }
  }

  return {
    file,
    session,
    vaults,
    items,
    templates,
    activity,
    generatorHistory,
    aliasKeys,
    sharing,
    warnings,
    readOnly: integrityState === 'invalid',
    integrity: integrityState,
  }
}

/* ------------------------------------------------------------------ */
/* Récupération optionnelle                                            */
/* ------------------------------------------------------------------ */

/**
 * Construit l’enveloppe de récupération et renvoie aussi la clé de
 * récupération, que l’appelant doit conserver dans la session.
 */
async function buildRecoveryEnvelope(
  file: VaultFile,
  session: VaultSession,
  phrase: string,
  kdfOverrides: Partial<KdfParams>,
): Promise<{ envelope: RecoveryEnvelope; recoveryKey: Uint8Array }> {
  assertUnlocked(session)
  const normalized = normalizeRecoveryPhrase(phrase)
  if (!normalized) {
    throw new VaultValidationError('La phrase de récupération est vide')
  }

  const kdf: KdfParams = { ...newKdfParams(), ...kdfOverrides, algorithm: 'argon2id' }
  const phraseKey = await deriveMasterKey(normalized, kdf)
  const recoveryKey = randomBytes(KDF_DEFAULTS.keyLength)

  try {
    const key = await sealBytes(recoveryKey, phraseKey, recoveryKeyAad())
    const guard = await sealBytes(recoveryKey, session.masterKey, recoveryGuardAad())
    const wraps: RecoveryWrap[] = []
    for (const record of file.vaults) {
      wraps.push({
        vaultId: record.id,
        key: await sealBytes(
          session.vaultKey(record.id),
          recoveryKey,
          recoveryVaultKeyAad(record.id),
        ),
      })
    }
    const templateWraps: Array<{ templateId: string; key: Sealed }> = []
    for (const record of file.templates ?? []) {
      let templateKey: Uint8Array | null = null
      try {
        templateKey = await openBytes(
          record.key,
          session.masterKey,
          templateKeyAad(record.id),
        )
        templateWraps.push({
          templateId: record.id,
          key: await sealBytes(
            templateKey,
            recoveryKey,
            templateRecoveryAad(record.id),
          ),
        })
      } finally {
        if (templateKey) wipe(templateKey)
      }
    }

    return {
      envelope: {
        version: 1,
        kdf,
        createdAt: new Date().toISOString(),
        key,
        guard,
        wraps,
        ...(templateWraps.length > 0 ? { templateWraps } : {}),
      },
      recoveryKey,
    }
  } catch (error) {
    wipe(recoveryKey)
    throw error
  } finally {
    wipe(phraseKey)
  }
}

/** Active ou remplace la phrase de récupération d’un coffre déverrouillé. */
export async function enableRecovery(
  file: VaultFile,
  session: VaultSession,
  phrase: string,
  kdfOverrides: Partial<KdfParams> = {},
): Promise<VaultFile> {
  const { envelope, recoveryKey } = await buildRecoveryEnvelope(
    file,
    session,
    phrase,
    kdfOverrides,
  )
  session.setRecoveryKey(recoveryKey)

  return {
    ...file,
    updatedAt: new Date().toISOString(),
    recovery: envelope,
  }
}

/** Supprime l’enveloppe de récupération ; la phrase devient inutile. */
export function disableRecovery(file: VaultFile, session: VaultSession): VaultFile {
  assertUnlocked(session)
  session.clearRecoveryKey()
  const next: VaultFile = { ...file, updatedAt: new Date().toISOString() }
  delete next.recovery
  return next
}

/**
 * Déverrouille un fichier avec la phrase de récupération et impose un nouveau
 * mot de passe maître. Les clés de coffre sont ré-enveloppées sous la nouvelle
 * clé maîtresse ; l’enveloppe de récupération reste valable.
 */
export async function recoverVaultFile(
  file: VaultFile,
  phrase: string,
  newPassword: string,
  kdfOverrides: Partial<KdfParams> = {},
): Promise<OpenedVault> {
  const recovery = file.recovery
  if (!recovery) {
    throw new VaultValidationError(
      'Aucune phrase de récupération n’est configurée pour ce coffre',
    )
  }

  const normalized = normalizeRecoveryPhrase(phrase)
  const phraseKey = await deriveMasterKey(normalized, recovery.kdf)
  let recoveryKey: Uint8Array
  try {
    recoveryKey = await openBytes(recovery.key, phraseKey, recoveryKeyAad())
    if (recoveryKey.length !== KDF_DEFAULTS.keyLength) {
      throw new CryptoError('Clé de récupération invalide')
    }
  } catch {
    throw new VaultValidationError(
      'Phrase de récupération incorrecte ou enveloppe corrompue',
    )
  } finally {
    wipe(phraseKey)
  }

  try {
    return await recoverVaultFileWithRecoveryKey(
      file,
      recoveryKey,
      newPassword,
      kdfOverrides,
    )
  } finally {
    wipe(recoveryKey)
  }
}

/**
 * Variante utilisée par les parts de secours Shamir : la clé de récupération
 * est déjà reconstituée. L’appelant reste propriétaire de `recoveryKey` et doit
 * l’effacer après l’appel.
 */
export async function recoverVaultFileWithRecoveryKey(
  file: VaultFile,
  recoveryKey: Uint8Array,
  newPassword: string,
  kdfOverrides: Partial<KdfParams> = {},
): Promise<OpenedVault> {
  const recovery = file.recovery
  if (!recovery) {
    throw new VaultValidationError(
      'Aucune phrase de récupération n’est configurée pour ce coffre',
    )
  }
  if (recoveryKey.length !== KDF_DEFAULTS.keyLength) {
    throw new VaultValidationError('Clé de récupération invalide')
  }

  const keys = new Map<string, Uint8Array>()
  try {
    for (const wrap of recovery.wraps) {
      try {
        const vaultKey = await openBytes(
          wrap.key,
          recoveryKey,
          recoveryVaultKeyAad(wrap.vaultId),
        )
        if (vaultKey.length !== KDF_DEFAULTS.keyLength) {
          throw new CryptoError('Clé de coffre invalide')
        }
        keys.set(wrap.vaultId, vaultKey)
      } catch {
        throw new VaultValidationError(
          'Enveloppe de récupération incomplète ou corrompue',
        )
      }
    }
    for (const record of file.vaults) {
      if (!keys.has(record.id)) {
        throw new VaultValidationError(
          'Enveloppe de récupération incomplète ou corrompue',
        )
      }
    }

    const now = new Date().toISOString()
    const kdf: KdfParams = { ...newKdfParams(), ...kdfOverrides, algorithm: 'argon2id' }
    const masterKey = await deriveMasterKey(newPassword, kdf)
    try {
      const vaults: EncryptedVaultRecord[] = []
      for (const record of file.vaults) {
        const vaultKey = keys.get(record.id) as Uint8Array
        vaults.push({
          ...record,
          key: await sealBytes(vaultKey, masterKey, vaultKeyAad(record.id)),
          updatedAt: now,
        })
      }

      const templateWraps = new Map(
        (recovery.templateWraps ?? []).map((wrap) => [wrap.templateId, wrap]),
      )
      const templates: EncryptedTemplateRecord[] = []
      for (const record of file.templates ?? []) {
        const wrap = templateWraps.get(record.id)
        if (!wrap) {
          templates.push(record)
          continue
        }
        let templateKey: Uint8Array | null = null
        try {
          templateKey = await openBytes(
            wrap.key,
            recoveryKey,
            templateRecoveryAad(record.id),
          )
          templates.push({
            ...record,
            key: await sealBytes(
              templateKey,
              masterKey,
              templateKeyAad(record.id),
            ),
            updatedAt: now,
          })
        } finally {
          if (templateKey) wipe(templateKey)
        }
      }

      const guard = await sealBytes(recoveryKey, masterKey, recoveryGuardAad())
      const integrityKey = randomBytes(KDF_DEFAULTS.keyLength)
      let emergency = file.emergency
      let emergencyDropped = false
      if (emergency) {
        try {
          emergency = await resealEmergencyRecord(emergency, masterKey)
        } catch {
          // Une identité d’urgence incohérente ne doit jamais être reseellée
          // avec la nouvelle clé maîtresse : on la retire au lieu de faire
          // confiance à une clé publique non authentifiée.
          emergency = undefined
          emergencyDropped = true
        }
      }
      const next: VaultFile = {
        ...file,
        kdf,
        vaults,
        ...(templates.length > 0 ? { templates } : {}),
        updatedAt: now,
        keyEpoch: (file.keyEpoch ?? 1) + 1,
        recovery: { ...recovery, guard },
      }
      // Les événements du journal sont scellés par l’ancienne clé maîtresse,
      // indisponible après une récupération : le journal repart vide.
      next.activity = []
      next.generatorHistory = []
      next.aliasKeys = []
      // L’identité de partage est scellée par l’ancienne clé maîtresse ;
      // elle est régénérée après une récupération.
      delete next.sharing
      // L’ancien MAC ne couvre plus les clés ré-enveloppées : on le remplace
      // par une signature calculée sous la nouvelle époque.
      delete next.integrity
      if (emergency) next.emergency = emergency
      else delete next.emergency

      try {
        const signingSession = new VaultSession(masterKey.slice())
        signingSession.setIntegrityKey(integrityKey)
        let signed: VaultFile
        try {
          signed = await signVaultFile(next, signingSession, file)
        } finally {
          signingSession.lock()
        }
        const opened = await openVaultFileWithMasterKey(signed, masterKey)
        if (emergencyDropped) {
          opened.warnings.push(
            'L’accès d’urgence a été retiré : son identité ne correspondait pas à son empreinte. Reconfigurez-le après la récupération.',
          )
        }
        return opened
      } finally {
        wipe(masterKey)
      }
    } catch (error) {
      wipe(masterKey)
      throw error
    }
  } finally {
    for (const key of keys.values()) wipe(key)
  }
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

function cleanText(value: string | undefined, max: number): string {
  return (value ?? '').trim().slice(0, max)
}

function cleanAttachmentName(value: string | undefined): string {
  const name = Array.from(value ?? '')
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
    .replace(/[\\/]/g, '-')
    .trim()
  return name.slice(0, 200) || 'piece-jointe'
}

function cleanDraft(draft: ItemDraft): ItemContent {
  const common = {
    title: cleanText(draft.title, 200),
    favorite: Boolean(draft.favorite),
    notes: (draft.notes ?? '').slice(0, 100_000),
    tags: Array.from(
      new Set(
        (draft.tags ?? [])
          .map((tag) => cleanText(tag, 40))
          .filter(Boolean),
      ),
    ).slice(0, 30),
    templateId: cleanText(draft.templateId ?? '', 80) || undefined,
    customFields: (draft.customFields ?? [])
      .map((field) => ({
        id: cleanText(field.id, 80) || randomId('f'),
        label: cleanText(field.label, 80),
        value: normalizeCustomFieldValue(
          isCustomFieldType(field.type) ? field.type : 'text',
          field.value ?? '',
          cleanText(draft.title ?? '', 200),
          cleanText(field.label, 80),
        ),
        type: isCustomFieldType(field.type) ? field.type : 'text',
      }))
      .filter((field) => field.label)
      .slice(0, MAX_CUSTOM_FIELDS),
    attachments: (draft.attachments ?? [])
      .map((attachment) => ({
        id: cleanText(attachment.id, 80),
        name: cleanAttachmentName(attachment.name),
        mime: cleanText(attachment.mime, 100) || 'application/octet-stream',
        size: Math.max(
          0,
          Math.min(MAX_ATTACHMENT_BYTES, Math.floor(attachment.size)),
        ),
        createdAt: cleanText(attachment.createdAt, 40) || new Date().toISOString(),
        ...(attachment.storage === 'blob'
          ? {
              storage: 'blob' as const,
              blobId: cleanText(attachment.blobId ?? '', 80) || undefined,
              blobKey: (attachment.blobKey ?? '').slice(0, 200) || undefined,
              sha256: cleanText(attachment.sha256 ?? '', 128) || undefined,
            }
          : {}),
      }))
      .filter((attachment) => attachment.id)
      .slice(0, MAX_ATTACHMENTS_PER_ITEM),
    deletedAt: normalizeDeletedAt(draft.deletedAt),
    expiresAt: normalizeDateOnly(draft.expiresAt ?? ''),
  }

  switch (draft.type) {
    case 'login':
      return {
        ...common,
        type: 'login',
        username: cleanText(draft.username, 500),
        password: (draft.password ?? '').slice(0, 2_000),
        urls: (draft.urls ?? [])
          .map((url) => cleanText(url, 2_000))
          .filter(Boolean)
          .slice(0, 30),
        totp: cleanText(draft.totp, 4_096),
        autotypeSequence:
          cleanText(draft.autotypeSequence ?? '', 4_000) || undefined,
        emailAlias: cleanText(draft.emailAlias ?? '', 320) || undefined,
      }
    case 'note':
      return { ...common, type: 'note' }
    case 'card':
      return {
        ...common,
        type: 'card',
        cardholder: cleanText(draft.cardholder, 200),
        number: cleanText(draft.number, 40),
        expiry: cleanText(draft.expiry, 10),
        cvc: cleanText(draft.cvc, 8),
        pin: cleanText(draft.pin, 12),
        brand: cleanText(draft.brand, 40),
      }
    case 'identity':
      return {
        ...common,
        type: 'identity',
        firstName: cleanText(draft.firstName, 200),
        lastName: cleanText(draft.lastName, 200),
        email: cleanText(draft.email, 500),
        phone: cleanText(draft.phone, 100),
        address: cleanText(draft.address, 500),
        city: cleanText(draft.city, 200),
        postalCode: cleanText(draft.postalCode, 40),
        country: cleanText(draft.country, 200),
        birthDate: cleanText(draft.birthDate, 40),
        passportExpiry: normalizeDateOnly(draft.passportExpiry ?? ''),
        idCardExpiry: normalizeDateOnly(draft.idCardExpiry ?? ''),
        licenseExpiry: normalizeDateOnly(draft.licenseExpiry ?? ''),
      }
    case 'passkey':
      return {
        ...common,
        type: 'passkey',
        rpId: cleanText(draft.rpId, 255),
        userHandle: cleanText(draft.userHandle, 2_048),
        userName: cleanText(draft.userName, 500),
        credentialId: cleanText(draft.credentialId, 2_048),
        privateKey: (draft.privateKey ?? '').slice(0, 10_000),
        publicKeyCose: (draft.publicKeyCose ?? '').slice(0, 10_000),
        signCount: Math.max(0, Math.floor(draft.signCount || 0)),
      }
    case 'ssh-key':
      return {
        ...common,
        type: 'ssh-key',
        privateKey: (draft.privateKey ?? '').slice(0, 100_000),
        publicKey: cleanText(draft.publicKey, 20_000),
        fingerprint: cleanText(draft.fingerprint, 500),
        comment: cleanText(draft.comment, 500),
      }
    case 'wifi':
      return {
        ...common,
        type: 'wifi',
        ssid: cleanText(draft.ssid, 100),
        password: (draft.password ?? '').slice(0, 500),
        security:
          draft.security === 'WEP' || draft.security === 'nopass'
            ? draft.security
            : 'WPA',
        hidden: Boolean(draft.hidden),
      }
    case 'api-credential':
      return {
        ...common,
        type: 'api-credential',
        keyId: cleanText(draft.keyId, 500),
        secret: (draft.secret ?? '').slice(0, 10_000),
        environment: cleanText(draft.environment, 100),
        endpoint: cleanText(draft.endpoint, 2_000),
      }
    case 'software-license':
      return {
        ...common,
        type: 'software-license',
        licenseKey: (draft.licenseKey ?? '').slice(0, 10_000),
        licensedTo: cleanText(draft.licensedTo, 500),
        version: cleanText(draft.version, 100),
        website: cleanText(draft.website, 2_000),
        purchaseDate: normalizeDateOnly(draft.purchaseDate ?? ''),
      }
    case 'document':
      return {
        ...common,
        type: 'document',
        documentKind:
          draft.documentKind === 'identity' ||
          draft.documentKind === 'contract' ||
          draft.documentKind === 'invoice' ||
          draft.documentKind === 'certificate'
            ? draft.documentKind
            : 'other',
        issuer: cleanText(draft.issuer, 500),
        documentNumber: cleanText(draft.documentNumber, 500),
        issuedAt: normalizeDateOnly(draft.issuedAt ?? ''),
      }
    case 'recovery-codes':
      return {
        ...common,
        type: 'recovery-codes',
        codes: (draft.codes ?? [])
          .map((entry) => ({
            id: cleanText(entry.id, 80) || randomId('rc'),
            code: (entry.code ?? '').trim().slice(0, 200),
            usedAt:
              entry.usedAt && Number.isFinite(Date.parse(entry.usedAt))
                ? entry.usedAt.slice(0, 40)
                : null,
          }))
          .filter((entry) => entry.code)
          .slice(0, 100),
      }
  }
}

function assertUnlocked(session: VaultSession): void {
  if (session.locked) throw new VaultLockedError()
}

function assertVaultWritable(session: VaultSession, vaultId: string): void {
  if (session.vaultRole(vaultId) === 'read') {
    throw new VaultValidationError('Ce coffre partagé est en lecture seule.')
  }
}

function itemContentOfDraft(draft: ItemDraft): ItemContent {
  const cleaned = cleanDraft(draft)
  if (!cleaned.title) throw new VaultValidationError('Le titre est obligatoire')
  return cleaned
}

export async function createItem(
  file: VaultFile,
  session: VaultSession,
  draft: ItemDraft,
): Promise<{ file: VaultFile; item: VaultItem }> {
  assertUnlocked(session)
  if (!session.hasVaultKey(draft.vaultId)) {
    throw new VaultValidationError('Coffre introuvable')
  }
  assertVaultWritable(session, draft.vaultId)

  const content = {
    ...itemContentOfDraft(draft),
    attachments: [],
    deletedAt: null,
  } as ItemContent
  const id = randomId('i')
  const now = new Date().toISOString()
  const itemKey = randomBytes(32)
  const vaultKey = session.vaultKey(draft.vaultId)

  try {
    const record: EncryptedItemRecord = {
      id,
      vaultId: draft.vaultId,
      key: await sealBytes(itemKey, vaultKey, itemKeyAad(draft.vaultId, id)),
      content: await sealJson(content, itemKey, itemContentAad(draft.vaultId, id)),
      createdAt: now,
      updatedAt: now,
    }

    const item = {
      ...content,
      id,
      vaultId: draft.vaultId,
      createdAt: now,
      updatedAt: now,
    } as VaultItem

    return {
      file: {
        ...file,
        updatedAt: now,
        items: [...file.items, record],
      },
      item,
    }
  } finally {
    wipe(itemKey)
  }
}

/**
 * Trie des versions de la plus récente à la plus ancienne. À horodatage égal
 * (deux écritures dans la même milliseconde), l’ordre d’insertion départage :
 * le tableau conserve l’ordre de création.
 */
function sortNewestFirst(versions: EncryptedVersionRecord[]): EncryptedVersionRecord[] {
  return versions
    .map((version, index) => ({ version, index }))
    .sort(
      (a, b) =>
        b.version.createdAt.localeCompare(a.version.createdAt) || b.index - a.index,
    )
    .map((entry) => entry.version)
}

/** Ajoute une version chiffrée et applique les plafonds de rétention. */
async function appendItemVersion(
  versions: EncryptedVersionRecord[],
  record: EncryptedItemRecord,
  itemKey: Uint8Array,
  content: ItemContent,
  now: string,
): Promise<EncryptedVersionRecord[]> {
  const id = randomId('iv')
  const version: EncryptedVersionRecord = {
    id,
    itemId: record.id,
    vaultId: record.vaultId,
    content: await sealJson(
      content,
      itemKey,
      itemVersionAad(record.vaultId, record.id, id),
    ),
    createdAt: now,
  }

  const own = sortNewestFirst(
    versions.filter((candidate) => candidate.itemId === record.id).concat(version),
  )
  const dropped = new Set(own.slice(MAX_ITEM_VERSIONS).map((candidate) => candidate.id))

  let next = versions
    .filter((candidate) => !dropped.has(candidate.id))
    .concat(version)
  if (next.length > MAX_STORED_VERSIONS) {
    next = sortNewestFirst(next).slice(0, MAX_STORED_VERSIONS)
  }
  return next
}

/**
 * Archive dans l’historique le contenu d’un élément perdant une fusion.
 *
 * L’identifiant de version est déterministe (dérivé du ciphertext et de
 * l’horloge perdants) : une nouvelle synchronisation du même conflit ne crée
 * pas de doublon. La clé de l’élément retenu sert à rechiffrer le contenu avec
 * l’AAD de version.
 */
export async function preserveConflictVersion(
  file: VaultFile,
  session: VaultSession,
  losing: EncryptedItemRecord,
): Promise<{ file: VaultFile; archived: boolean; warning?: string }> {
  assertUnlocked(session)
  const selected = file.items.find((record) => record.id === losing.id)
  if (!selected) {
    return { file, archived: false }
  }
  if (
    selected.content.n === losing.content.n &&
    selected.content.c === losing.content.c
  ) {
    return { file, archived: false }
  }
  if (
    !session.hasVaultKey(selected.vaultId) ||
    !session.hasVaultKey(losing.vaultId)
  ) {
    return {
      file,
      archived: false,
      warning:
        'Un conflit n’a pas pu être archivé : la clé de l’un des coffres est indisponible.',
    }
  }

  const versionId = `ivc_${toBase64(
    await sha256(
      utf8(
        [
          losing.id,
          losing.vaultId,
          losing.key.n,
          losing.key.c,
          losing.content.n,
          losing.content.c,
          losing.updatedAt,
          losing.clock?.rev ?? 0,
          losing.clock?.writer ?? '',
        ].join(':'),
      ),
    ),
  )
    .replace(/[+/=]/g, '')
    .slice(0, 32)}`
  if (file.versions.some((version) => version.id === versionId)) {
    return { file, archived: false }
  }

  let losingKey: Uint8Array | null = null
  let selectedKey: Uint8Array | null = null
  try {
    losingKey = await openBytes(
      losing.key,
      session.vaultKey(losing.vaultId),
      itemKeyAad(losing.vaultId, losing.id),
    )
    const content = await openJson<ItemContent>(
      losing.content,
      losingKey,
      itemContentAad(losing.vaultId, losing.id),
    )
    selectedKey = await openBytes(
      selected.key,
      session.vaultKey(selected.vaultId),
      itemKeyAad(selected.vaultId, selected.id),
    )
    const version: EncryptedVersionRecord = {
      id: versionId,
      itemId: selected.id,
      vaultId: selected.vaultId,
      content: await sealJson(
        content,
        selectedKey,
        itemVersionAad(selected.vaultId, selected.id, versionId),
      ),
      createdAt: new Date().toISOString(),
    }

    let versions = [...file.versions, version]
    const own = sortNewestFirst(
      versions.filter((candidate) => candidate.itemId === selected.id),
    )
    const keep = new Set(own.slice(0, MAX_ITEM_VERSIONS).map((candidate) => candidate.id))
    versions = versions.filter(
      (candidate) => candidate.itemId !== selected.id || keep.has(candidate.id),
    )
    if (versions.length > MAX_STORED_VERSIONS) {
      versions = sortNewestFirst(versions).slice(0, MAX_STORED_VERSIONS)
    }
    return { file: { ...file, versions }, archived: true }
  } catch {
    return {
      file,
      archived: false,
      warning:
        'Un conflit n’a pas pu être archivé : son contenu est illisible avec les clés actuelles.',
    }
  } finally {
    if (losingKey) wipe(losingKey)
    if (selectedKey) wipe(selectedKey)
  }
}

/** Empreinte utilisée pour décider si une version doit être créée. */
function versionFingerprint(content: ItemContent): string {
  // Le favori est un indicateur d’affichage : le modifier ne doit pas créer
  // une version dans l’historique.
  return JSON.stringify({ ...content, favorite: false })
}

export async function updateItem(
  file: VaultFile,
  session: VaultSession,
  item: VaultItem,
): Promise<{ file: VaultFile; item: VaultItem }> {
  assertUnlocked(session)
  const existing = file.items.find((record) => record.id === item.id)
  if (!existing) throw new VaultValidationError('Élément introuvable')
  if (existing.vaultId !== item.vaultId) throw new VaultValidationError('Coffre incohérent')
  assertVaultWritable(session, existing.vaultId)

  const knownAttachmentIds = new Set(
    file.attachments
      .filter((attachment) => attachment.itemId === existing.id)
      .map((attachment) => attachment.id),
  )
  const cleaned = itemContentOfDraft(item)
  const itemKey = await openBytes(
    existing.key,
    session.vaultKey(existing.vaultId),
    itemKeyAad(existing.vaultId, existing.id),
  )

  try {
    const now = new Date().toISOString()
    const previousContent = await openJson<ItemContent>(
      existing.content,
      itemKey,
      itemContentAad(existing.vaultId, existing.id),
    )
    const previous = {
      ...previousContent,
      deletedAt: normalizeDeletedAt(previousContent.deletedAt),
      attachments: (previousContent.attachments ?? []).filter((attachment) =>
        knownAttachmentIds.has(attachment.id),
      ),
    } as ItemContent
    const content = {
      ...cleaned,
      deletedAt: normalizeDeletedAt(previous.deletedAt),
      attachments: cleaned.attachments.filter((attachment) =>
        knownAttachmentIds.has(attachment.id),
      ),
    } as ItemContent

    // Une modification réelle crée une version ; un simple enregistrement sans
    // changement ne gonfle pas l’historique.
    const versions =
      versionFingerprint(previous) === versionFingerprint(content)
        ? file.versions
        : await appendItemVersion(file.versions, existing, itemKey, previous, now)

    const updatedItem = {
      ...content,
      id: existing.id,
      vaultId: existing.vaultId,
      createdAt: existing.createdAt,
      updatedAt: now,
    } as VaultItem

    const record: EncryptedItemRecord = {
      ...existing,
      content: await sealJson(
        content,
        itemKey,
        itemContentAad(existing.vaultId, existing.id),
      ),
      updatedAt: now,
    }

    return {
      file: {
        ...file,
        updatedAt: now,
        items: file.items.map((candidate) => (candidate.id === record.id ? record : candidate)),
        versions,
      },
      item: updatedItem,
    }
  } finally {
    wipe(itemKey)
  }
}

/**
 * Déplace un élément vers un autre coffre.
 *
 * La clé d’élément, le contenu, les pièces jointes et les versions sont
 * réchiffrés avec la clé du coffre cible : aucun secret n’est laissé sous
 * l’ancienne clé, et les AAD restent liés au couple (coffre, élément).
 */
export async function moveItem(
  file: VaultFile,
  session: VaultSession,
  itemId: string,
  targetVaultId: string,
): Promise<{ file: VaultFile; item: VaultItem }> {
  assertUnlocked(session)
  if (!session.hasVaultKey(targetVaultId)) {
    throw new VaultValidationError('Coffre de destination introuvable')
  }
  const existing = file.items.find((record) => record.id === itemId)
  if (!existing) throw new VaultValidationError('Élément introuvable')
  assertVaultWritable(session, existing.vaultId)
  assertVaultWritable(session, targetVaultId)

  const oldItemKey = await openBytes(
    existing.key,
    session.vaultKey(existing.vaultId),
    itemKeyAad(existing.vaultId, existing.id),
  )

  try {
    const content = await openJson<ItemContent>(
      existing.content,
      oldItemKey,
      itemContentAad(existing.vaultId, existing.id),
    )
    const newItemKey = randomBytes(32)

    try {
      const now = new Date().toISOString()
      const attachments = await Promise.all(
        file.attachments
          .filter((attachment) => attachment.itemId === existing.id)
          .map(async (attachment) => {
            const bytes = await openBytes(
              attachment.data,
              oldItemKey,
              itemAttachmentAad(existing.vaultId, existing.id, attachment.id),
            )
            try {
              return {
                ...attachment,
                vaultId: targetVaultId,
                data: await sealBytes(
                  bytes,
                  newItemKey,
                  itemAttachmentAad(targetVaultId, existing.id, attachment.id),
                ),
              }
            } finally {
              wipe(bytes)
            }
          }),
      )

      const versions = await Promise.all(
        file.versions
          .filter((version) => version.itemId === existing.id)
          .map(async (version) => {
            const versionContent = await openJson<ItemContent>(
              version.content,
              oldItemKey,
              itemVersionAad(existing.vaultId, existing.id, version.id),
            )
            return {
              ...version,
              vaultId: targetVaultId,
              content: await sealJson(
                versionContent,
                newItemKey,
                itemVersionAad(targetVaultId, existing.id, version.id),
              ),
            }
          }),
      )

      const attachmentMap = new Map(
        attachments.map((attachment) => [attachment.id, attachment]),
      )
      const versionMap = new Map(versions.map((version) => [version.id, version]))

      const record: EncryptedItemRecord = {
        ...existing,
        vaultId: targetVaultId,
        key: await sealBytes(
          newItemKey,
          session.vaultKey(targetVaultId),
          itemKeyAad(targetVaultId, existing.id),
        ),
        content: await sealJson(
          content,
          newItemKey,
          itemContentAad(targetVaultId, existing.id),
        ),
        updatedAt: now,
      }

      const item = {
        ...content,
        id: existing.id,
        vaultId: targetVaultId,
        createdAt: existing.createdAt,
        updatedAt: now,
      } as VaultItem

      return {
        file: {
          ...file,
          updatedAt: now,
          items: file.items.map((candidate) =>
            candidate.id === record.id ? record : candidate,
          ),
          attachments: file.attachments.map(
            (attachment) => attachmentMap.get(attachment.id) ?? attachment,
          ),
          versions: file.versions.map(
            (version) => versionMap.get(version.id) ?? version,
          ),
        },
        item,
      }
    } finally {
      wipe(newItemKey)
    }
  } finally {
    wipe(oldItemKey)
  }
}

/**
 * Déplace un élément dans la corbeille. Le contenu reste chiffré ; seule sa
 * date de suppression est mise à jour.
 */
export async function trashItem(
  file: VaultFile,
  session: VaultSession,
  itemId: string,
): Promise<{ file: VaultFile; item: VaultItem }> {
  assertUnlocked(session)
  const existing = file.items.find((record) => record.id === itemId)
  if (!existing) throw new VaultValidationError('Élément introuvable')

  const itemKey = await openBytes(
    existing.key,
    session.vaultKey(existing.vaultId),
    itemKeyAad(existing.vaultId, existing.id),
  )

  try {
    const now = new Date().toISOString()
    const previous = await openJson<ItemContent>(
      existing.content,
      itemKey,
      itemContentAad(existing.vaultId, existing.id),
    )
    const content = {
      ...previous,
      deletedAt: normalizeDeletedAt(previous.deletedAt) ?? now,
    } as ItemContent
    const record: EncryptedItemRecord = {
      ...existing,
      content: await sealJson(
        content,
        itemKey,
        itemContentAad(existing.vaultId, existing.id),
      ),
      updatedAt: now,
    }
    const item = {
      ...content,
      id: existing.id,
      vaultId: existing.vaultId,
      createdAt: existing.createdAt,
      updatedAt: now,
    } as VaultItem

    return {
      item,
      file: {
        ...file,
        updatedAt: now,
        items: file.items.map((candidate) =>
          candidate.id === record.id ? record : candidate,
        ),
      },
    }
  } finally {
    wipe(itemKey)
  }
}

/** Retire un élément de la corbeille sans toucher à son contenu. */
export async function restoreItem(
  file: VaultFile,
  session: VaultSession,
  itemId: string,
): Promise<{ file: VaultFile; item: VaultItem }> {
  assertUnlocked(session)
  const existing = file.items.find((record) => record.id === itemId)
  if (!existing) throw new VaultValidationError('Élément introuvable')

  const itemKey = await openBytes(
    existing.key,
    session.vaultKey(existing.vaultId),
    itemKeyAad(existing.vaultId, existing.id),
  )

  try {
    const now = new Date().toISOString()
    const previous = await openJson<ItemContent>(
      existing.content,
      itemKey,
      itemContentAad(existing.vaultId, existing.id),
    )
    const content = { ...previous, deletedAt: null } as ItemContent
    const record: EncryptedItemRecord = {
      ...existing,
      content: await sealJson(
        content,
        itemKey,
        itemContentAad(existing.vaultId, existing.id),
      ),
      updatedAt: now,
    }
    const item = {
      ...content,
      id: existing.id,
      vaultId: existing.vaultId,
      createdAt: existing.createdAt,
      updatedAt: now,
    } as VaultItem

    return {
      item,
      file: {
        ...file,
        updatedAt: now,
        items: file.items.map((candidate) =>
          candidate.id === record.id ? record : candidate,
        ),
      },
    }
  } finally {
    wipe(itemKey)
  }
}

/** Liste les versions précédentes d’un élément, de la plus récente à la plus ancienne. */
export async function listItemVersions(
  file: VaultFile,
  session: VaultSession,
  itemId: string,
): Promise<ItemVersion[]> {
  assertUnlocked(session)
  const record = file.items.find((candidate) => candidate.id === itemId)
  if (!record) throw new VaultValidationError('Élément introuvable')

  const itemKey = await openBytes(
    record.key,
    session.vaultKey(record.vaultId),
    itemKeyAad(record.vaultId, record.id),
  )

  try {
    const versions: ItemVersion[] = []
    for (const entry of sortNewestFirst(
      file.versions.filter((candidate) => candidate.itemId === record.id),
    )) {
      const raw = await openJson<ItemContent>(
        entry.content,
        itemKey,
        itemVersionAad(record.vaultId, record.id, entry.id),
      )
      const parsed = itemContentSchema.parse(raw) as ItemContent
      versions.push({
        id: entry.id,
        itemId: record.id,
        createdAt: entry.createdAt,
        content: {
          ...parsed,
          deletedAt: normalizeDeletedAt(parsed.deletedAt),
        } as ItemContent,
      })
    }
    return versions
  } finally {
    wipe(itemKey)
  }
}

/**
 * Restaure une version précédente. Le contenu courant est d’abord archivé pour
 * que la restauration reste réversible.
 */
export async function restoreItemVersion(
  file: VaultFile,
  session: VaultSession,
  itemId: string,
  versionId: string,
): Promise<{ file: VaultFile; item: VaultItem }> {
  assertUnlocked(session)
  const existing = file.items.find((record) => record.id === itemId)
  if (!existing) throw new VaultValidationError('Élément introuvable')
  const version = file.versions.find(
    (candidate) =>
      candidate.id === versionId &&
      candidate.itemId === existing.id &&
      candidate.vaultId === existing.vaultId,
  )
  if (!version) throw new VaultValidationError('Version introuvable')

  const itemKey = await openBytes(
    existing.key,
    session.vaultKey(existing.vaultId),
    itemKeyAad(existing.vaultId, existing.id),
  )

  try {
    const now = new Date().toISOString()
    const knownAttachmentIds = new Set(
      file.attachments
        .filter((attachment) => attachment.itemId === existing.id)
        .map((attachment) => attachment.id),
    )
    const rawVersion = await openJson<ItemContent>(
      version.content,
      itemKey,
      itemVersionAad(existing.vaultId, existing.id, version.id),
    )
    const parsed = itemContentSchema.parse(rawVersion) as ItemContent
    const cleaned = cleanDraft({
      ...parsed,
      vaultId: existing.vaultId,
      deletedAt: null,
    } as ItemDraft)
    if (!cleaned.title) throw new VaultValidationError('La version restaurée est invalide')
    const content = {
      ...cleaned,
      deletedAt: null,
      attachments: cleaned.attachments.filter((attachment) =>
        knownAttachmentIds.has(attachment.id),
      ),
    } as ItemContent

    const currentRaw = await openJson<ItemContent>(
      existing.content,
      itemKey,
      itemContentAad(existing.vaultId, existing.id),
    )
    const current = {
      ...currentRaw,
      deletedAt: normalizeDeletedAt(currentRaw.deletedAt),
      attachments: (currentRaw.attachments ?? []).filter((attachment) =>
        knownAttachmentIds.has(attachment.id),
      ),
    } as ItemContent

    const versions =
      versionFingerprint(current) === versionFingerprint(content)
        ? file.versions
        : await appendItemVersion(file.versions, existing, itemKey, current, now)

    const record: EncryptedItemRecord = {
      ...existing,
      content: await sealJson(
        content,
        itemKey,
        itemContentAad(existing.vaultId, existing.id),
      ),
      updatedAt: now,
    }
    const item = {
      ...content,
      id: existing.id,
      vaultId: existing.vaultId,
      createdAt: existing.createdAt,
      updatedAt: now,
    } as VaultItem

    return {
      item,
      file: {
        ...file,
        updatedAt: now,
        items: file.items.map((candidate) =>
          candidate.id === record.id ? record : candidate,
        ),
        versions,
      },
    }
  } finally {
    wipe(itemKey)
  }
}

/** Supprime définitivement plusieurs éléments et leurs dépendances. */
export function deleteItems(file: VaultFile, itemIds: Iterable<string>): VaultFile {
  const ids = new Set(itemIds)
  if (ids.size === 0) return file

  return {
    ...file,
    updatedAt: new Date().toISOString(),
    items: file.items.filter((item) => !ids.has(item.id)),
    attachments: file.attachments.filter((attachment) => !ids.has(attachment.itemId)),
    versions: file.versions.filter((version) => !ids.has(version.itemId)),
  }
}

function attachmentBytesUsed(attachments: AttachmentMeta[]): number {
  return attachments.reduce((total, attachment) => total + attachment.size, 0)
}

export async function addAttachment(
  file: VaultFile,
  session: VaultSession,
  item: VaultItem,
  input: AttachmentInput,
): Promise<{ file: VaultFile; item: VaultItem }> {
  assertUnlocked(session)
  const existing = file.items.find((record) => record.id === item.id)
  if (!existing) throw new VaultValidationError('Élément introuvable')
  if (existing.vaultId !== item.vaultId) throw new VaultValidationError('Coffre incohérent')
  assertVaultWritable(session, existing.vaultId)
  if (input.bytes.length === 0) {
    throw new VaultValidationError('La pièce jointe est vide')
  }
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new VaultValidationError('La pièce jointe dépasse la limite de 5 Mo')
  }

  const currentAttachments = item.attachments ?? []
  if (currentAttachments.length >= MAX_ATTACHMENTS_PER_ITEM) {
    throw new VaultValidationError(
      `Un élément ne peut pas contenir plus de ${MAX_ATTACHMENTS_PER_ITEM} pièces jointes`,
    )
  }
  if (
    attachmentBytesUsed(currentAttachments) + input.bytes.length >
    MAX_ATTACHMENTS_TOTAL_BYTES
  ) {
    throw new VaultValidationError('Les pièces jointes de cet élément dépassent 25 Mo')
  }

  const storedAttachmentBytes = file.attachments.reduce(
    (total, attachment) => total + Math.floor((attachment.data.c.length * 3) / 4),
    0,
  )
  if (storedAttachmentBytes + input.bytes.length + 16 > MAX_VAULT_ATTACHMENT_BYTES) {
    throw new VaultValidationError(
      'Le coffre ne peut pas contenir plus de 50 Mo de pièces jointes',
    )
  }

  const itemKey = await openBytes(
    existing.key,
    session.vaultKey(existing.vaultId),
    itemKeyAad(existing.vaultId, existing.id),
  )

  try {
    const now = new Date().toISOString()
    const attachmentId = randomId('a')
    const meta: AttachmentMeta = {
      id: attachmentId,
      name: cleanAttachmentName(input.name),
      mime: cleanText(input.mime, 100) || 'application/octet-stream',
      size: input.bytes.length,
      createdAt: now,
    }
    const cleaned = itemContentOfDraft(item)
    const content = {
      ...cleaned,
      attachments: [...currentAttachments, meta],
    } as ItemContent

    const attachmentRecord: EncryptedAttachmentRecord = {
      id: attachmentId,
      itemId: existing.id,
      vaultId: existing.vaultId,
      data: await sealBytes(
        input.bytes,
        itemKey,
        itemAttachmentAad(existing.vaultId, existing.id, attachmentId),
      ),
      createdAt: now,
    }

    const itemRecord: EncryptedItemRecord = {
      ...existing,
      content: await sealJson(
        content,
        itemKey,
        itemContentAad(existing.vaultId, existing.id),
      ),
      updatedAt: now,
    }

    const updatedItem = {
      ...content,
      id: existing.id,
      vaultId: existing.vaultId,
      createdAt: existing.createdAt,
      updatedAt: now,
    } as VaultItem

    return {
      item: updatedItem,
      file: {
        ...file,
        updatedAt: now,
        items: file.items.map((candidate) =>
          candidate.id === itemRecord.id ? itemRecord : candidate,
        ),
        attachments: [...file.attachments, attachmentRecord],
      },
    }
  } finally {
    wipe(itemKey)
  }
}

export async function removeAttachment(
  file: VaultFile,
  session: VaultSession,
  item: VaultItem,
  attachmentId: string,
): Promise<{ file: VaultFile; item: VaultItem }> {
  assertUnlocked(session)
  const existing = file.items.find((record) => record.id === item.id)
  if (!existing) throw new VaultValidationError('Élément introuvable')
  const attachment = file.attachments.find(
    (candidate) =>
      candidate.id === attachmentId &&
      candidate.itemId === existing.id &&
      candidate.vaultId === existing.vaultId,
  )
  if (!attachment) throw new VaultValidationError('Pièce jointe introuvable')

  const itemKey = await openBytes(
    existing.key,
    session.vaultKey(existing.vaultId),
    itemKeyAad(existing.vaultId, existing.id),
  )

  try {
    if (!item.attachments.some((candidate) => candidate.id === attachmentId)) {
      throw new VaultValidationError('Pièce jointe introuvable dans l’élément')
    }

    const now = new Date().toISOString()
    const cleaned = itemContentOfDraft(item)
    const content = {
      ...cleaned,
      attachments: cleaned.attachments.filter(
        (candidate) => candidate.id !== attachmentId,
      ),
    } as ItemContent
    const itemRecord: EncryptedItemRecord = {
      ...existing,
      content: await sealJson(
        content,
        itemKey,
        itemContentAad(existing.vaultId, existing.id),
      ),
      updatedAt: now,
    }
    const updatedItem = {
      ...content,
      id: existing.id,
      vaultId: existing.vaultId,
      createdAt: existing.createdAt,
      updatedAt: now,
    } as VaultItem

    return {
      item: updatedItem,
      file: {
        ...file,
        updatedAt: now,
        items: file.items.map((candidate) =>
          candidate.id === itemRecord.id ? itemRecord : candidate,
        ),
        attachments: file.attachments.filter(
          (candidate) => candidate.id !== attachmentId,
        ),
      },
    }
  } finally {
    wipe(itemKey)
  }
}

export async function openAttachment(
  file: VaultFile,
  session: VaultSession,
  item: VaultItem,
  attachmentId: string,
): Promise<{ meta: AttachmentMeta; bytes: Uint8Array }> {
  assertUnlocked(session)
  const meta = item.attachments.find((candidate) => candidate.id === attachmentId)
  if (!meta) throw new VaultValidationError('Pièce jointe introuvable')

  const itemRecord = file.items.find((record) => record.id === item.id)
  if (!itemRecord) throw new VaultValidationError('Élément introuvable')
  const attachment = file.attachments.find(
    (candidate) =>
      candidate.id === attachmentId &&
      candidate.itemId === item.id &&
      candidate.vaultId === item.vaultId,
  )
  if (!attachment) throw new VaultValidationError('Pièce jointe introuvable')

  const itemKey = await openBytes(
    itemRecord.key,
    session.vaultKey(itemRecord.vaultId),
    itemKeyAad(itemRecord.vaultId, itemRecord.id),
  )

  try {
    const bytes = await openBytes(
      attachment.data,
      itemKey,
      itemAttachmentAad(itemRecord.vaultId, itemRecord.id, attachmentId),
    )
    if (bytes.length !== meta.size) {
      wipe(bytes)
      throw new VaultValidationError('La pièce jointe déchiffrée est incohérente')
    }
    return { meta, bytes }
  } finally {
    wipe(itemKey)
  }
}

/**
 * Vérifie l’intégrité complète du coffre : noms de coffres, contenus
 * d’éléments et pièces jointes. Chaque ciphertext est déchiffré puis
 * authentifié par AES-GCM ; la taille des pièces jointes est comparée aux
 * métadonnées. Lève une `VaultIntegrityError` au premier ensemble de
 * problèmes rencontrés, sans interrompre la vérification des autres entrées.
 */
export async function verifyVaultFile(
  file: VaultFile,
  session: VaultSession,
): Promise<VaultIntegrityReport> {
  assertUnlocked(session)

  const issues: string[] = []
  let verifiedItems = 0
  let verifiedAttachments = 0
  let verifiedVersions = 0
  let attachmentBytes = 0
  let signedRecords = 0

  if (file.version === 4) {
    if (!file.integrity) {
      issues.push('signature globale absente')
    } else if (!session.hasIntegrityKey) {
      issues.push('clé d’intégrité absente de la session')
    } else {
      const valid = await verifyFileMac(file, session.integrityKey())
      if (!valid) {
        issues.push('MAC global invalide : un enregistrement a été modifié, supprimé ou rejoué')
      } else {
        signedRecords =
          file.vaults.length * 2 +
          file.items.length * 2 +
          file.attachments.length +
          file.versions.length
      }
    }

    if (file.emergency) {
      try {
        await assertEmergencyRecordContacts(file.emergency)
      } catch {
        issues.push(
          'accès d’urgence incohérent : l’empreinte ne correspond pas aux clés publiques',
        )
      }
    }

    const itemRecords = new Map(file.items.map((item) => [item.id, item]))
    const vaultRecords = new Map(file.vaults.map((vault) => [vault.id, vault]))
    const seenTombstones = new Set<string>()
    for (const tombstone of file.tombstones ?? []) {
      const key = `${tombstone.kind}:${tombstone.id}`
      if (seenTombstones.has(key)) {
        issues.push(`pierre tombale en double « ${tombstone.id.slice(0, 8)}… »`)
      }
      seenTombstones.add(key)
      if (Number.isNaN(Date.parse(tombstone.deletedAt))) {
        issues.push(`pierre tombale « ${tombstone.id.slice(0, 8)}… » : date invalide`)
      }
      if (tombstone.kind === 'item') {
        const item = itemRecords.get(tombstone.id)
        if (
          item &&
          Date.parse(tombstone.deletedAt) >= Date.parse(item.updatedAt)
        ) {
          issues.push(
            `pierre tombale « ${tombstone.id.slice(0, 8)}… » : élément encore présent`,
          )
        }
      }
      if (tombstone.kind === 'vault') {
        const vault = vaultRecords.get(tombstone.id)
        if (
          vault &&
          Date.parse(tombstone.deletedAt) >= Date.parse(vault.updatedAt)
        ) {
          issues.push(
            `pierre tombale « ${tombstone.id.slice(0, 8)}… » : coffre encore présent`,
          )
        }
      }
    }
  }

  for (const record of file.vaults) {
    if (!session.hasVaultKey(record.id)) {
      issues.push(`clé du coffre « ${record.id.slice(0, 8)}… » absente`)
      continue
    }
    try {
      await openJson(record.name, session.vaultKey(record.id), vaultMetaAad(record.id))
    } catch {
      issues.push(`nom du coffre « ${record.id.slice(0, 8)}… » illisible`)
    }
  }

  if (file.recovery) {
    try {
      const guard = await openBytes(
        file.recovery.guard,
        session.masterKey,
        recoveryGuardAad(),
      )
      if (guard.length !== KDF_DEFAULTS.keyLength) {
        issues.push('enveloppe de récupération : guard de longueur invalide')
      }
      wipe(guard)
    } catch {
      issues.push('enveloppe de récupération : guard illisible ou altéré')
    }

    if (!session.hasRecoveryKey) {
      issues.push('enveloppe de récupération : clé de récupération indisponible')
    } else {
      for (const wrap of file.recovery.wraps) {
        try {
          const key = await openBytes(
            wrap.key,
            session.recoveryKey(),
            recoveryVaultKeyAad(wrap.vaultId),
          )
          if (key.length !== KDF_DEFAULTS.keyLength) {
            issues.push(
              `enveloppe de récupération : clé de coffre « ${wrap.vaultId.slice(0, 8)}… » invalide`,
            )
          }
          wipe(key)
        } catch {
          issues.push(
            `enveloppe de récupération : clé de coffre « ${wrap.vaultId.slice(0, 8)}… » illisible`,
          )
        }
      }
    }
  }

  const attachmentRecords = new Map(
    file.attachments.map((attachment) => [attachment.id, attachment]),
  )
  const referencedAttachments = new Set<string>()
  const versionRecords = new Map<string, EncryptedVersionRecord[]>()
  for (const version of file.versions) {
    const list = versionRecords.get(version.itemId) ?? []
    list.push(version)
    versionRecords.set(version.itemId, list)
  }
  const referencedVersions = new Set<string>()

  for (const record of file.items) {
    if (!session.hasVaultKey(record.vaultId)) {
      issues.push(`élément « ${record.id.slice(0, 8)}… » rattaché à un coffre inaccessible`)
      continue
    }

    let itemKey: Uint8Array | null = null
    try {
      itemKey = await openBytes(
        record.key,
        session.vaultKey(record.vaultId),
        itemKeyAad(record.vaultId, record.id),
      )
      const content = await openJson<ItemContent>(
        record.content,
        itemKey,
        itemContentAad(record.vaultId, record.id),
      )
      const parsed = itemContentSchema.parse(content) as ItemContent
      verifiedItems += 1

      for (const version of versionRecords.get(record.id) ?? []) {
        referencedVersions.add(version.id)
        if (version.vaultId !== record.vaultId) {
          issues.push(`version « ${version.id.slice(0, 8)}… » rattachée à un autre coffre`)
          continue
        }
        try {
          const raw = await openJson<ItemContent>(
            version.content,
            itemKey,
            itemVersionAad(record.vaultId, record.id, version.id),
          )
          itemContentSchema.parse(raw)
          verifiedVersions += 1
        } catch {
          issues.push(`version « ${version.id.slice(0, 8)}… » illisible ou altérée`)
        }
      }

      for (const meta of parsed.attachments) {
        referencedAttachments.add(meta.id)
        const attachment = attachmentRecords.get(meta.id)
        if (
          !attachment ||
          attachment.itemId !== record.id ||
          attachment.vaultId !== record.vaultId
        ) {
          issues.push(`pièce jointe « ${meta.name} » introuvable`)
          continue
        }

        try {
          const bytes = await openBytes(
            attachment.data,
            itemKey,
            itemAttachmentAad(record.vaultId, record.id, meta.id),
          )
          try {
            if (bytes.length !== meta.size) {
              issues.push(
                `taille incohérente pour la pièce jointe « ${meta.name} » (${bytes.length} au lieu de ${meta.size})`,
              )
            } else {
              verifiedAttachments += 1
              attachmentBytes += bytes.length
            }
          } finally {
            wipe(bytes)
          }
        } catch {
          issues.push(`pièce jointe « ${meta.name} » illisible ou altérée`)
        }
      }
    } catch {
      issues.push(`élément « ${record.id.slice(0, 8)}… » illisible ou altéré`)
    } finally {
      if (itemKey) wipe(itemKey)
    }
  }

  for (const attachment of file.attachments) {
    if (!referencedAttachments.has(attachment.id)) {
      issues.push(`pièce jointe orpheline « ${attachment.id.slice(0, 8)}… »`)
    }
  }

  for (const version of file.versions) {
    if (!referencedVersions.has(version.id)) {
      issues.push(`version orpheline « ${version.id.slice(0, 8)}… »`)
    }
  }

  if (issues.length > 0) {
    const preview = issues.slice(0, 3).join(' · ')
    const suffix = issues.length > 3 ? ` (+${issues.length - 3})` : ''
    throw new VaultIntegrityError(
      `La vérification a échoué : ${preview}${suffix}. Exportez une sauvegarde avant toute autre modification.`,
    )
  }

  return {
    vaults: file.vaults.length,
    items: verifiedItems,
    attachments: verifiedAttachments,
    attachmentBytes,
    versions: verifiedVersions,
    signedRecords,
  }
}

export async function deleteItem(
  file: VaultFile,
  itemId: string,
): Promise<VaultFile> {
  return deleteItems(file, [itemId])
}

export async function addVault(
  file: VaultFile,
  session: VaultSession,
  name: string,
): Promise<{ file: VaultFile; vault: VaultSummary }> {
  assertUnlocked(session)
  const cleanName = cleanText(name, 80)
  if (!cleanName) throw new VaultValidationError('Le nom du coffre est obligatoire')

  const { record, key } = await createVaultRecord(cleanName, session.masterKey)
  session.setVaultKey(record.id, key)

  let recovery = file.recovery
  if (recovery) {
    if (!session.hasRecoveryKey) {
      throw new VaultValidationError(
        'La clé de récupération n’est pas disponible ; régénérez la phrase avant d’ajouter un coffre',
      )
    }
    recovery = {
      ...recovery,
      wraps: [
        ...recovery.wraps,
        {
          vaultId: record.id,
          key: await sealBytes(
            key,
            session.recoveryKey(),
            recoveryVaultKeyAad(record.id),
          ),
        },
      ],
    }
  }

  return {
    file: {
      ...file,
      updatedAt: new Date().toISOString(),
      vaults: [...file.vaults, record],
      recovery,
    },
    vault: vaultSummary(record, cleanName, []),
  }
}

export async function renameVault(
  file: VaultFile,
  session: VaultSession,
  vaultId: string,
  name: string,
): Promise<VaultFile> {
  assertUnlocked(session)
  const cleanName = cleanText(name, 80)
  if (!cleanName) throw new VaultValidationError('Le nom du coffre est obligatoire')

  const record = file.vaults.find((candidate) => candidate.id === vaultId)
  if (!record) throw new VaultValidationError('Coffre introuvable')

  const sealedName = await sealJson(
    { name: cleanName },
    session.vaultKey(vaultId),
    vaultMetaAad(vaultId),
  )

  const now = new Date().toISOString()
  return {
    ...file,
    updatedAt: now,
    vaults: file.vaults.map((candidate) =>
      candidate.id === vaultId
        ? { ...candidate, name: sealedName, updatedAt: now }
        : candidate,
    ),
  }
}

/** Ajoute un coffre partagé dont la clé a été reçue par paquet. */
export async function addSharedVault(
  file: VaultFile,
  session: VaultSession,
  input: {
    vaultId: string
    name: string
    key: Uint8Array
    role: ShareRole
    adminFingerprint?: string
  },
): Promise<{ file: VaultFile; vault: VaultSummary }> {
  assertUnlocked(session)
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.vaultId)) {
    throw new VaultValidationError('Identifiant de coffre partagé invalide')
  }
  if (file.vaults.some((vault) => vault.id === input.vaultId)) {
    throw new VaultValidationError('Ce coffre partagé est déjà présent')
  }
  if (input.key.length !== 32) {
    throw new VaultValidationError('Clé de coffre partagé invalide')
  }
  const name = cleanText(input.name, 80)
  if (!name) throw new VaultValidationError('Le nom du coffre est obligatoire')

  let recovery = file.recovery
  if (recovery) {
    if (!session.hasRecoveryKey) {
      throw new VaultValidationError(
        'La clé de récupération n’est pas disponible ; régénérez la phrase avant d’importer un coffre partagé',
      )
    }
    recovery = {
      ...recovery,
      wraps: [
        ...recovery.wraps,
        {
          vaultId: input.vaultId,
          key: await sealBytes(
            input.key,
            session.recoveryKey(),
            recoveryVaultKeyAad(input.vaultId),
          ),
        },
      ],
    }
  }

  const now = new Date().toISOString()
  const record: EncryptedVaultRecord = {
    id: input.vaultId,
    key: await sealBytes(input.key, session.masterKey, vaultKeyAad(input.vaultId)),
    name: await sealJson(
      {
        name,
        role: input.role,
        ...(input.adminFingerprint ? { adminFingerprint: input.adminFingerprint } : {}),
      },
      input.key,
      vaultMetaAad(input.vaultId),
    ),
    createdAt: now,
    updatedAt: now,
  }
  session.setVaultKey(input.vaultId, input.key)
  session.setVaultRole(input.vaultId, input.role)
  return {
    file: {
      ...file,
      updatedAt: now,
      vaults: [...file.vaults, record],
      recovery,
    },
    vault: vaultSummary(record, name, [], input.role),
  }
}

/** Lit les membres et l’administrateur d’un coffre partagé. */
export async function readVaultSharing(
  file: VaultFile,
  session: VaultSession,
  vaultId: string,
): Promise<{
  members: VaultSharingMember[]
  adminFingerprint?: string
  package?: SharedVaultPackage
}> {
  assertUnlocked(session)
  const record = file.vaults.find((vault) => vault.id === vaultId)
  if (!record) throw new VaultValidationError('Coffre introuvable')
  const meta = await openJson<{
    members?: unknown
    adminFingerprint?: unknown
    package?: unknown
  }>(record.name, session.vaultKey(vaultId), vaultMetaAad(vaultId))
  const members: VaultSharingMember[] = []
  if (Array.isArray(meta.members)) {
    for (const entry of meta.members) {
      if (!entry || typeof entry !== 'object') continue
      const member = entry as Record<string, unknown>
      if (
        typeof member.encryptionPublicKey === 'string' &&
        typeof member.signingPublicKey === 'string' &&
        typeof member.fingerprint === 'string' &&
        (member.role === 'read' || member.role === 'write')
      ) {
        members.push({
          encryptionPublicKey: member.encryptionPublicKey,
          signingPublicKey: member.signingPublicKey,
          fingerprint: member.fingerprint,
          role: member.role,
        })
      }
    }
  }
  let pkg: SharedVaultPackage | undefined
  if (meta.package !== undefined) {
    try {
      pkg = await parseSharedVaultPackage(meta.package)
    } catch {
      // Un paquet local illisible ne doit pas casser la liste des membres ;
      // la synchronisation signalera qu’il faut un nouveau paquet.
      pkg = undefined
    }
  }
  return {
    members,
    ...(typeof meta.adminFingerprint === 'string'
      ? { adminFingerprint: meta.adminFingerprint }
      : {}),
    ...(pkg ? { package: pkg } : {}),
  }
}

async function sealVaultSharing(
  file: VaultFile,
  session: VaultSession,
  vaultId: string,
  members: VaultSharingMember[],
  adminFingerprint: string,
  pkg?: SharedVaultPackage,
  role?: ShareRole,
): Promise<VaultFile> {
  assertUnlocked(session)
  const record = file.vaults.find((vault) => vault.id === vaultId)
  if (!record) throw new VaultValidationError('Coffre introuvable')
  const key = session.vaultKey(vaultId)
  const meta = await openJson<{ name?: unknown; role?: unknown; package?: unknown }>(
    record.name,
    key,
    vaultMetaAad(vaultId),
  )
  const name = typeof meta.name === 'string' ? meta.name : 'Coffre partagé'
  const packageValue = pkg ?? meta.package
  const roleValue =
    role ?? (meta.role === 'read' ? 'read' : 'write')
  const nameSealed = await sealJson(
    {
      name,
      role: roleValue,
      members,
      adminFingerprint,
      ...(packageValue !== undefined ? { package: packageValue } : {}),
    },
    key,
    vaultMetaAad(vaultId),
  )
  const now = new Date().toISOString()
  return {
    ...file,
    updatedAt: now,
    vaults: file.vaults.map((vault) =>
      vault.id === vaultId ? { ...vault, name: nameSealed, updatedAt: now } : vault,
    ),
  }
}

/** Met à jour la liste des membres dans les métadonnées chiffrées du coffre. */
export async function setVaultSharingMembers(
  file: VaultFile,
  session: VaultSession,
  vaultId: string,
  members: VaultSharingMember[],
  adminFingerprint: string,
  pkg?: SharedVaultPackage,
): Promise<VaultFile> {
  assertVaultWritable(session, vaultId)
  return sealVaultSharing(file, session, vaultId, members, adminFingerprint, pkg)
}

/**
 * Adopte les métadonnées d’un paquet importé, y compris pour un membre en
 * lecture. Le paquet et les rôles ont déjà été vérifiés par l’appelant.
 */
export async function adoptVaultSharingMembers(
  file: VaultFile,
  session: VaultSession,
  vaultId: string,
  members: VaultSharingMember[],
  adminFingerprint: string,
  pkg?: SharedVaultPackage,
  role?: ShareRole,
): Promise<VaultFile> {
  return sealVaultSharing(
    file,
    session,
    vaultId,
    members,
    adminFingerprint,
    pkg,
    role,
  )
}

/**
 * Tourne la clé d’un coffre partagé et re-enveloppe les clés d’éléments.
 * Les contenus et pièces jointes restent chiffrés par leur clé d’élément.
 */
export async function rotateVaultKey(
  file: VaultFile,
  session: VaultSession,
  vaultId: string,
  nextVaultKey: Uint8Array,
  options: { allowReadOnly?: boolean; preserveUpdatedAt?: boolean } = {},
): Promise<VaultFile> {
  assertUnlocked(session)
  if (!options.allowReadOnly) assertVaultWritable(session, vaultId)
  if (nextVaultKey.length !== KDF_DEFAULTS.keyLength) {
    throw new VaultValidationError('Clé de coffre partagé invalide')
  }
  const record = file.vaults.find((vault) => vault.id === vaultId)
  if (!record) throw new VaultValidationError('Coffre introuvable')
  const oldKey = session.vaultKey(vaultId)
  if (oldKey === nextVaultKey) {
    throw new VaultValidationError('La nouvelle clé doit être différente')
  }
  const items: EncryptedItemRecord[] = []
  for (const item of file.items) {
    if (item.vaultId !== vaultId) {
      items.push(item)
      continue
    }
    let itemKey: Uint8Array | null = null
    try {
      itemKey = await openBytes(item.key, oldKey, itemKeyAad(vaultId, item.id))
      items.push({
        ...item,
        key: await sealBytes(itemKey, nextVaultKey, itemKeyAad(vaultId, item.id)),
        ...(options.preserveUpdatedAt
          ? {}
          : { updatedAt: new Date().toISOString() }),
      })
    } finally {
      if (itemKey) wipe(itemKey)
    }
  }

  const meta = await openJson<{ name?: unknown; role?: unknown }>(
    record.name,
    oldKey,
    vaultMetaAad(vaultId),
  )
  const name = typeof meta.name === 'string' ? meta.name : 'Coffre partagé'
  const nameSealed = await sealJson(
    { ...meta, name, role: meta.role === 'read' ? 'read' : 'write' },
    nextVaultKey,
    vaultMetaAad(vaultId),
  )

  let recovery = file.recovery
  if (recovery) {
    if (!session.hasRecoveryKey) {
      throw new VaultValidationError(
        'La clé de récupération n’est pas disponible ; régénérez la phrase avant de révoquer un membre',
      )
    }
    recovery = {
      ...recovery,
      wraps: await Promise.all(
        recovery.wraps.map(async (wrap) =>
          wrap.vaultId === vaultId
            ? {
                ...wrap,
                key: await sealBytes(
                  nextVaultKey,
                  session.recoveryKey(),
                  recoveryVaultKeyAad(vaultId),
                ),
              }
            : wrap,
        ),
      ),
    }
  }

  const now = new Date().toISOString()
  const sealedVaultKey = await sealBytes(
    nextVaultKey,
    session.masterKey,
    vaultKeyAad(vaultId),
  )
  session.setVaultKey(vaultId, nextVaultKey)
  wipe(oldKey)
  return {
    ...file,
    updatedAt: now,
    items,
    vaults: file.vaults.map((vault) =>
      vault.id === vaultId
        ? { ...vault, key: sealedVaultKey, name: nameSealed, updatedAt: now }
        : vault,
    ),
    recovery,
  }
}


/**
 * Adopte une rotation de clé décidée par l’administrateur.
 * Ré-enveloppe les éléments locaux avec la nouvelle clé, puis remplace les
 * métadonnées de partage. La signature et l’identité de l’administrateur sont
 * vérifiées par l’appelant.
 */
export async function adoptVaultKey(
  file: VaultFile,
  session: VaultSession,
  vaultId: string,
  nextVaultKey: Uint8Array,
  pkg: SharedVaultPackage,
  members: VaultSharingMember[],
  adminFingerprint: string,
  role: ShareRole,
): Promise<VaultFile> {
  const rotated = await rotateVaultKey(file, session, vaultId, nextVaultKey, {
    allowReadOnly: true,
    preserveUpdatedAt: true,
  })
  return adoptVaultSharingMembers(
    rotated,
    session,
    vaultId,
    members,
    adminFingerprint,
    pkg,
    role,
  )
}

export async function deleteVault(
  file: VaultFile,
  session: VaultSession,
  vaultId: string,
): Promise<VaultFile> {
  assertUnlocked(session)
  if (file.vaults.length <= 1) {
    throw new VaultValidationError('Impossible de supprimer le dernier coffre')
  }

  // La clé reste dans la session : l’appelant la retire après une écriture
  // réussie, sinon un échec laisserait un coffre visible mais illisible.
  const recovery = file.recovery
    ? {
        ...file.recovery,
        wraps: file.recovery.wraps.filter((wrap) => wrap.vaultId !== vaultId),
      }
    : undefined
  return {
    ...file,
    updatedAt: new Date().toISOString(),
    vaults: file.vaults.filter((vault) => vault.id !== vaultId),
    items: file.items.filter((item) => item.vaultId !== vaultId),
    attachments: file.attachments.filter((attachment) => attachment.vaultId !== vaultId),
    versions: file.versions.filter((version) => version.vaultId !== vaultId),
    recovery,
  }
}

export async function changeMasterPassword(
  file: VaultFile,
  session: VaultSession,
  newPassword: string,
  kdfOverrides: Partial<KdfParams> = {},
): Promise<VaultFile> {
  assertUnlocked(session)
  const kdf: KdfParams = { ...newKdfParams(), ...kdfOverrides, algorithm: 'argon2id' }
  const nextMasterKey = await deriveMasterKey(newPassword, kdf)

  try {
    const vaults: EncryptedVaultRecord[] = []
    for (const record of file.vaults) {
      const key = session.vaultKey(record.id)
      vaults.push({
        ...record,
        key: await sealBytes(key, nextMasterKey, vaultKeyAad(record.id)),
        updatedAt: new Date().toISOString(),
      })
    }

    let recovery = file.recovery
    if (recovery) {
      if (!session.hasRecoveryKey) {
        throw new VaultValidationError(
          'La clé de récupération n’est pas disponible ; régénérez la phrase avant de changer le mot de passe',
        )
      }
      recovery = {
        ...recovery,
        guard: await sealBytes(
          session.recoveryKey(),
          nextMasterKey,
          recoveryGuardAad(),
        ),
      }
    }

    const templates: EncryptedTemplateRecord[] = []
    for (const record of file.templates ?? []) {
      let templateKey: Uint8Array | null = null
      try {
        templateKey = await openBytes(
          record.key,
          session.masterKey,
          templateKeyAad(record.id),
        )
        templates.push({
          ...record,
          key: await sealBytes(
            templateKey,
            nextMasterKey,
            templateKeyAad(record.id),
          ),
          updatedAt: new Date().toISOString(),
        })
      } finally {
        if (templateKey) wipe(templateKey)
      }
    }

    const activity: EncryptedActivityRecord[] = []
    for (const record of file.activity ?? []) {
      try {
        const event = await openJson<ActivityEvent>(
          record.data,
          session.masterKey,
          activityAad(record.id),
        )
        activity.push({
          ...record,
          data: await sealJson(event, nextMasterKey, activityAad(record.id)),
        })
      } catch {
        // Un événement illisible ne doit pas empêcher le changement de mot de passe.
      }
    }

    const generatorHistory: EncryptedGeneratorRecord[] = []
    for (const record of file.generatorHistory ?? []) {
      try {
        const payload = await openJson<unknown>(
          record.data,
          session.masterKey,
          generatorHistoryAad(record.id),
        )
        generatorHistory.push({
          ...record,
          data: await sealJson(
            payload,
            nextMasterKey,
            generatorHistoryAad(record.id),
          ),
        })
      } catch {
        // Une entrée illisible ne doit pas empêcher la rotation.
      }
    }

    const aliasKeys: EncryptedAliasKeyRecord[] = []
    for (const record of file.aliasKeys ?? []) {
      try {
        const value = await openJson<{ key?: unknown }>(
          record.data,
          session.masterKey,
          aliasKeyAad(record.service),
        )
        aliasKeys.push({
          ...record,
          data: await sealJson(value, nextMasterKey, aliasKeyAad(record.service)),
        })
      } catch {
        // Une clé illisible ne bloque pas la rotation.
      }
    }

    let sharing = file.sharing
    if (sharing) {
      sharing = await resealSharingIdentity(
        sharing,
        session.masterKey,
        nextMasterKey,
        file.id,
      )
    }
    let emergency = file.emergency
    if (emergency) {
      emergency = await resealEmergencyRecord(emergency, nextMasterKey)
    }

    session.replaceMasterKey(nextMasterKey)
    // Rotation de l’époque : nouvelle clé HMAC, scellée sous la nouvelle clé
    // maîtresse. Le MAC est recalculé par `signVaultFile` avant l’écriture.
    session.setIntegrityKey(randomBytes(KDF_DEFAULTS.keyLength))

    const next: VaultFile = {
      ...file,
      kdf,
      vaults,
      ...(templates.length > 0 ? { templates } : {}),
      ...(activity.length > 0 ? { activity } : {}),
      ...(generatorHistory.length > 0 ? { generatorHistory } : {}),
      ...(aliasKeys.length > 0 ? { aliasKeys } : {}),
      ...(sharing ? { sharing } : {}),
      ...(emergency ? { emergency } : {}),
      updatedAt: new Date().toISOString(),
      keyEpoch: (file.keyEpoch ?? 1) + 1,
      recovery,
    }
    delete next.integrity
    return next
  } catch (error) {
    wipe(nextMasterKey)
    throw error
  }
}

function cleanTemplateFields(fields: TemplateField[]): TemplateField[] {
  const cleaned: TemplateField[] = []
  for (const field of fields.slice(0, 30)) {
    const label = cleanText(field.label, 80)
    if (!label) continue
    const type: TemplateField['type'] = [
      'text',
      'secret',
      'url',
      'date',
      'multiline',
    ].includes(field.type)
      ? field.type
      : 'text'
    cleaned.push({
      id: cleanText(field.id, 80) || randomId('tf'),
      label,
      type,
      ...(field.required ? { required: true } : {}),
      ...(field.fillable ? { fillable: true } : {}),
    })
  }
  return cleaned
}

export interface TemplateInput {
  name: string
  icon?: string
  type?: ItemType
  fields: TemplateField[]
}

/** Crée un modèle d’élément chiffré avec une clé dédiée. */
export async function createTemplate(
  file: VaultFile,
  session: VaultSession,
  input: TemplateInput,
): Promise<{ file: VaultFile; template: ItemTemplate }> {
  assertUnlocked(session)
  const name = cleanText(input.name, 80)
  if (!name) throw new VaultValidationError('Le nom du modèle est obligatoire')
  const fields = cleanTemplateFields(input.fields)
  if (fields.length === 0) {
    throw new VaultValidationError('Ajoutez au moins un champ au modèle')
  }
  if (file.recovery && !session.hasRecoveryKey) {
    throw new VaultValidationError(
      'La clé de récupération n’est pas disponible ; régénérez la phrase avant de créer un modèle',
    )
  }
  const id = randomId('tpl')
  const key = randomBytes(KDF_DEFAULTS.keyLength)
  const now = new Date().toISOString()
  try {
    const content = {
      name,
      icon: cleanText(input.icon ?? '📦', 16) || '📦',
      type: isItemType(input.type) ? input.type : 'note',
      fields,
    }
    const record: EncryptedTemplateRecord = {
      id,
      key: await sealBytes(key, session.masterKey, templateKeyAad(id)),
      content: await sealJson(content, key, templateContentAad(id)),
      createdAt: now,
      updatedAt: now,
    }
    let recovery = file.recovery
    if (recovery && session.hasRecoveryKey) {
      recovery = {
        ...recovery,
        templateWraps: [
          ...(recovery.templateWraps ?? []).filter(
            (wrap) => wrap.templateId !== id,
          ),
          {
            templateId: id,
            key: await sealBytes(
              key,
              session.recoveryKey(),
              templateRecoveryAad(id),
            ),
          },
        ],
      }
    }
    return {
      file: {
        ...file,
        updatedAt: now,
        templates: [...(file.templates ?? []), record],
        recovery,
      },
      template: { id, ...content, createdAt: now, updatedAt: now },
    }
  } finally {
    wipe(key)
  }
}

/** Remplace le contenu d’un modèle existant. */
export async function updateTemplate(
  file: VaultFile,
  session: VaultSession,
  templateId: string,
  input: TemplateInput,
): Promise<{ file: VaultFile; template: ItemTemplate }> {
  assertUnlocked(session)
  const existing = (file.templates ?? []).find((record) => record.id === templateId)
  if (!existing) throw new VaultValidationError('Modèle introuvable')
  const name = cleanText(input.name, 80)
  if (!name) throw new VaultValidationError('Le nom du modèle est obligatoire')
  const fields = cleanTemplateFields(input.fields)
  if (fields.length === 0) {
    throw new VaultValidationError('Ajoutez au moins un champ au modèle')
  }
  if (file.recovery && !session.hasRecoveryKey) {
    throw new VaultValidationError(
      'La clé de récupération n’est pas disponible ; régénérez la phrase avant de modifier un modèle',
    )
  }
  const key = randomBytes(KDF_DEFAULTS.keyLength)
  const now = new Date().toISOString()
  try {
    const content = {
      name,
      icon: cleanText(input.icon ?? '📦', 16) || '📦',
      type: isItemType(input.type) ? input.type : 'note',
      fields,
    }
    const record: EncryptedTemplateRecord = {
      ...existing,
      key: await sealBytes(key, session.masterKey, templateKeyAad(templateId)),
      content: await sealJson(content, key, templateContentAad(templateId)),
      updatedAt: now,
    }
    let recovery = file.recovery
    if (recovery && session.hasRecoveryKey) {
      recovery = {
        ...recovery,
        templateWraps: [
          ...(recovery.templateWraps ?? []).filter(
            (wrap) => wrap.templateId !== templateId,
          ),
          {
            templateId,
            key: await sealBytes(
              key,
              session.recoveryKey(),
              templateRecoveryAad(templateId),
            ),
          },
        ],
      }
    }
    return {
      file: {
        ...file,
        updatedAt: now,
        templates: (file.templates ?? []).map((entry) =>
          entry.id === templateId ? record : entry,
        ),
        recovery,
      },
      template: {
        id: templateId,
        ...content,
        createdAt: existing.createdAt,
        updatedAt: now,
      },
    }
  } finally {
    wipe(key)
  }
}

/** Supprime un modèle ; une pierre tombale empêche sa résurrection en fusion. */
export function deleteTemplate(file: VaultFile, templateId: string): VaultFile {
  const now = new Date().toISOString()
  const recovery = file.recovery
    ? {
        ...file.recovery,
        templateWraps: (file.recovery.templateWraps ?? []).filter(
          (wrap) => wrap.templateId !== templateId,
        ),
      }
    : undefined
  return {
    ...file,
    updatedAt: now,
    templates: (file.templates ?? []).filter((record) => record.id !== templateId),
    ...(recovery ? { recovery } : {}),
    tombstones: [
      ...(file.tombstones ?? []),
      { kind: 'template', id: templateId, deletedAt: now },
    ],
  }
}

/**
 * Ajoute un événement au journal d’activité. Le contenu est chiffré avec la clé
 * maîtresse et une AAD propre à l’événement. L’appelant signe et persiste le
 * fichier retourné.
 */
export async function appendActivity(
  file: VaultFile,
  session: VaultSession,
  event: Omit<ActivityEvent, 'id' | 'at'> & { at?: string },
): Promise<{ file: VaultFile; event: ActivityEvent }> {
  assertUnlocked(session)
  const id = randomId('act')
  const at = event.at ?? new Date().toISOString()
  const payload: ActivityEvent = {
    id,
    kind: event.kind,
    at,
    detail: cleanText(event.detail, 500),
    ...(event.host ? { host: cleanText(event.host, 253) } : {}),
  }
  const record: EncryptedActivityRecord = {
    id,
    data: await sealJson(payload, session.masterKey, activityAad(id)),
    createdAt: at,
  }
  const activity = [record, ...(file.activity ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5_000)
  return { file: { ...file, activity }, event: payload }
}

function cleanGeneratorDomain(value: string | undefined): string | undefined {
  if (!value) return undefined
  const raw = value.trim().toLowerCase()
  if (!raw) return undefined
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    const host = url.hostname.replace(/^www\./, '')
    return /^[a-z0-9.-]+$/.test(host) && host.includes('.')
      ? host.slice(0, 253)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Ajoute un mot de passe généré à l’historique chiffré. Le password n’est
 * jamais journalisé ni écrit en clair : il est scellé avec la clé maîtresse et
 * une AAD propre à l’entrée.
 */
export async function appendGeneratorHistory(
  file: VaultFile,
  session: VaultSession,
  input: { password: string; domain?: string; createdAt?: string },
): Promise<{ file: VaultFile; entry: GeneratorHistoryEntry }> {
  assertUnlocked(session)
  if (!input.password || input.password.length > 1024) {
    throw new VaultValidationError('Mot de passe généré invalide')
  }
  const id = randomId('gen')
  const createdAt = input.createdAt ?? new Date().toISOString()
  const domain = cleanGeneratorDomain(input.domain)
  const payload: Omit<GeneratorHistoryEntry, 'id'> = {
    password: input.password,
    ...(domain ? { domain } : {}),
    createdAt,
    state: 'available',
  }
  const record: EncryptedGeneratorRecord = {
    id,
    data: await sealJson(payload, session.masterKey, generatorHistoryAad(id)),
    createdAt,
  }
  const generatorHistory = [record, ...(file.generatorHistory ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
  return {
    file: { ...file, generatorHistory },
    entry: { id, ...payload },
  }
}

async function setGeneratorHistoryState(
  file: VaultFile,
  session: VaultSession,
  id: string,
  state: GeneratorHistoryState,
  itemId?: string,
): Promise<{ file: VaultFile; entry: GeneratorHistoryEntry | null }> {
  assertUnlocked(session)
  const record = (file.generatorHistory ?? []).find((entry) => entry.id === id)
  if (!record) return { file, entry: null }
  const payload = generatorPayloadSchema.parse(
    await openJson<unknown>(record.data, session.masterKey, generatorHistoryAad(id)),
  )
  const stateAt = new Date().toISOString()
  const nextPayload = {
    ...payload,
    state,
    stateAt,
    ...(itemId ? { itemId } : {}),
  }
  const nextRecord: EncryptedGeneratorRecord = {
    ...record,
    data: await sealJson(
      nextPayload,
      session.masterKey,
      generatorHistoryAad(id),
    ),
  }
  return {
    file: {
      ...file,
      generatorHistory: (file.generatorHistory ?? []).map((entry) =>
        entry.id === id ? nextRecord : entry,
      ),
    },
    entry: {
      id,
      password: payload.password,
      ...(payload.domain ? { domain: payload.domain } : {}),
      createdAt: payload.createdAt || record.createdAt,
      state,
      stateAt,
      ...(itemId ? { itemId } : {}),
    },
  }
}

/** Marque une entrée comme utilisée par un élément, sans la supprimer. */
export async function markGeneratorHistoryUsed(
  file: VaultFile,
  session: VaultSession,
  id: string,
  itemId: string,
): Promise<{ file: VaultFile; entry: GeneratorHistoryEntry | null }> {
  return setGeneratorHistoryState(file, session, id, 'used', itemId)
}

/** Supprime réellement une entrée de l’historique. */
export function deleteGeneratorHistoryEntry(
  file: VaultFile,
  id: string,
): VaultFile {
  return {
    ...file,
    generatorHistory: (file.generatorHistory ?? []).filter(
      (entry) => entry.id !== id,
    ),
  }
}

/** Efface tout l’historique du générateur. */
export function clearGeneratorHistory(file: VaultFile): VaultFile {
  return { ...file, generatorHistory: [] }
}

/**
 * Purge les entrées plus anciennes que la rétention. `0` désactive
 * l’historique et efface tout. Ne nécessite pas la session : aucune donnée
 * n’est déchiffrée.
 */
export function purgeGeneratorHistory(
  file: VaultFile,
  retentionDays: number,
  now = Date.now(),
): { file: VaultFile; removedIds: string[] } {
  const records = file.generatorHistory ?? []
  if (retentionDays <= 0) {
    return { file: { ...file, generatorHistory: [] }, removedIds: records.map((entry) => entry.id) }
  }
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
  const removed = records.filter((entry) => {
    const timestamp = Date.parse(entry.createdAt)
    return Number.isFinite(timestamp) && timestamp < cutoff
  })
  if (removed.length === 0) return { file, removedIds: [] }
  const removedIds = new Set(removed.map((entry) => entry.id))
  return {
    file: {
      ...file,
      generatorHistory: records.filter((entry) => !removedIds.has(entry.id)),
    },
    removedIds: removed.map((entry) => entry.id),
  }
}

export async function setAliasKey(
  file: VaultFile,
  session: VaultSession,
  service: AliasKeyService,
  key: string,
): Promise<VaultFile> {
  assertUnlocked(session)
  const record: EncryptedAliasKeyRecord = {
    service,
    data: await sealJson({ key: key.trim() }, session.masterKey, aliasKeyAad(service)),
    createdAt: new Date().toISOString(),
  }
  return {
    ...file,
    updatedAt: new Date().toISOString(),
    aliasKeys: [
      ...(file.aliasKeys ?? []).filter((entry) => entry.service !== service),
      record,
    ],
  }
}

export function deleteAliasKey(file: VaultFile, service: AliasKeyService): VaultFile {
  return {
    ...file,
    updatedAt: new Date().toISOString(),
    aliasKeys: (file.aliasKeys ?? []).filter((entry) => entry.service !== service),
  }
}

export function serializeVault(file: VaultFile, pretty = true): string {
  return JSON.stringify(file, null, pretty ? 2 : 0)
}

export function vaultFileName(): string {
  const date = new Date().toISOString().slice(0, 10)
  return `coffre-${date}.coffre`
}

/** Décode une clé base64 pour les tests / outils. */
export function decodeKey(value: string): Uint8Array {
  return fromBase64(value)
}

export function encodeKey(value: Uint8Array): string {
  return toBase64(value)
}
