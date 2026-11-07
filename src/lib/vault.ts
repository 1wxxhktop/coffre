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

import {
  CryptoError,
  deriveMasterKey,
  fromBase64,
  itemAttachmentAad,
  itemContentAad,
  itemKeyAad,
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
  toBase64,
  vaultKeyAad,
  vaultMetaAad,
  wipe,
} from './crypto'
import { normalizeRecoveryPhrase } from './recovery'
import type {
  AttachmentMeta,
  EncryptedAttachmentRecord,
  EncryptedItemRecord,
  EncryptedVaultRecord,
  EncryptedVersionRecord,
  ItemContent,
  ItemDraft,
  KdfParams,
  RecoveryEnvelope,
  RecoveryWrap,
  VaultFile,
  VaultItem,
  VaultSummary,
} from './types'
import {
  isCustomFieldType,
  isItemType,
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

export interface VaultIntegrityReport {
  vaults: number
  items: number
  attachments: number
  attachmentBytes: number
  versions: number
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
  warnings: string[]
}

export interface AttachmentInput {
  name: string
  mime: string
  bytes: Uint8Array
}

export class VaultSession {
  #masterKey: Uint8Array
  #vaultKeys = new Map<string, Uint8Array>()
  #recoveryKey: Uint8Array | null = null
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

  removeVaultKey(vaultId: string): void {
    const key = this.#vaultKeys.get(vaultId)
    if (key) wipe(key)
    this.#vaultKeys.delete(vaultId)
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
    for (const key of this.#vaultKeys.values()) wipe(key)
    this.#vaultKeys.clear()
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

const vaultRecordSchema = z.object({
  id: idSchema,
  key: sealedSchema,
  name: sealedSchema,
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
})

const itemRecordSchema = z.object({
  id: idSchema,
  vaultId: idSchema,
  key: sealedSchema,
  content: sealedSchema,
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
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

const recoveryEnvelopeSchema = z.object({
  version: z.literal(1),
  kdf: kdfSchema,
  createdAt: z.string().min(1).max(40),
  key: sealedSchema,
  guard: sealedSchema,
  wraps: z.array(recoveryWrapSchema).min(1).max(50),
})

const vaultFileSchema = z.object({
  format: z.literal('coffre'),
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  id: idSchema,
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
  kdf: kdfSchema,
  vaults: z.array(vaultRecordSchema).min(1).max(50),
  items: z.array(itemRecordSchema).max(20_000),
  attachments: z.array(attachmentRecordSchema).max(20_000).default([]),
  versions: z.array(versionRecordSchema).max(20_000).default([]),
  recovery: recoveryEnvelopeSchema.optional(),
})

const customFieldSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  value: z.string().max(10_000),
  type: z.enum(['text', 'hidden', 'url', 'multiline']),
})

const attachmentMetaSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  mime: z.string().max(100),
  size: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
  createdAt: z.string().min(1).max(40),
})

const itemBaseSchema = {
  title: z.string().max(200),
  favorite: z.boolean(),
  notes: z.string().max(100_000),
  tags: z.array(z.string().max(40)).max(30),
  customFields: z.array(customFieldSchema).max(MAX_CUSTOM_FIELDS).default([]),
  attachments: z.array(attachmentMetaSchema).max(MAX_ATTACHMENTS_PER_ITEM).default([]),
  deletedAt: z.string().max(40).nullable().optional(),
}

const loginContentSchema = z.object({
  ...itemBaseSchema,
  type: z.literal('login'),
  username: z.string().max(500),
  password: z.string().max(2_000),
  urls: z.array(z.string().max(2_000)).max(30),
  totp: z.string().max(4_096),
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
})

const itemContentSchema = z.discriminatedUnion('type', [
  loginContentSchema,
  noteContentSchema,
  cardContentSchema,
  identityContentSchema,
])

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
  for (const vault of file.vaults) {
    if (vaultIds.has(vault.id)) {
      throw new VaultValidationError('Fichier invalide : identifiant de coffre en double')
    }
    vaultIds.add(vault.id)
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

  // Les fichiers versions 1 et 2 n’ont ni historique ni enveloppe de
  // récupération : ils sont lus puis migrés en version 3 à l’enregistrement.
  return { ...file, version: 3 }
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
/* Cycle de vie                                                        */
/* ------------------------------------------------------------------ */

function vaultSummary(
  record: EncryptedVaultRecord,
  name: string,
  items: VaultItem[],
): VaultSummary {
  return {
    id: record.id,
    name,
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

    const file: VaultFile = {
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

    return {
      file,
      session,
      vaults: [vaultSummary(record, name, [])],
      items: [],
      warnings: [],
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
    try {
      const meta = await openJson<{ name?: unknown }>(record.name, vaultKey, vaultMetaAad(record.id))
      if (typeof meta.name === 'string' && meta.name.trim()) name = meta.name
    } catch {
      warnings.push('Le nom d’un coffre n’a pas pu être déchiffré.')
    }

    vaults.push(vaultSummary(record, name, []))
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

  const openVaultMap = new Map(vaults.map((vault) => [vault.id, vault]))

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

  return { file, session, vaults, items, warnings }
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

    return {
      envelope: {
        version: 1,
        kdf,
        createdAt: new Date().toISOString(),
        key,
        guard,
        wraps,
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
    version: 3,
    updatedAt: new Date().toISOString(),
    recovery: envelope,
  }
}

/** Supprime l’enveloppe de récupération ; la phrase devient inutile. */
export function disableRecovery(file: VaultFile, session: VaultSession): VaultFile {
  assertUnlocked(session)
  session.clearRecoveryKey()
  const next: VaultFile = { ...file, version: 3, updatedAt: new Date().toISOString() }
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

      const guard = await sealBytes(recoveryKey, masterKey, recoveryGuardAad())
      const next: VaultFile = {
        ...file,
        version: 3,
        kdf,
        vaults,
        updatedAt: now,
        recovery: { ...recovery, guard },
      }

      try {
        return await openVaultFileWithMasterKey(next, masterKey)
      } finally {
        wipe(masterKey)
      }
    } catch (error) {
      wipe(masterKey)
      throw error
    }
  } finally {
    wipe(recoveryKey)
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
    customFields: (draft.customFields ?? [])
      .map((field) => ({
        id: cleanText(field.id, 80) || randomId('f'),
        label: cleanText(field.label, 80),
        value: (field.value ?? '').slice(0, 10_000),
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
      }))
      .filter((attachment) => attachment.id)
      .slice(0, MAX_ATTACHMENTS_PER_ITEM),
    deletedAt: normalizeDeletedAt(draft.deletedAt),
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
      }
  }
}

function assertUnlocked(session: VaultSession): void {
  if (session.locked) throw new VaultLockedError()
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
        version: 3,
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
    version: 3,
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
      version: 3,
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

export async function deleteVault(
  file: VaultFile,
  session: VaultSession,
  vaultId: string,
): Promise<VaultFile> {
  assertUnlocked(session)
  if (file.vaults.length <= 1) {
    throw new VaultValidationError('Impossible de supprimer le dernier coffre')
  }

  session.removeVaultKey(vaultId)
  const recovery = file.recovery
    ? {
        ...file.recovery,
        wraps: file.recovery.wraps.filter((wrap) => wrap.vaultId !== vaultId),
      }
    : undefined
  return {
    ...file,
    version: 3,
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

    session.replaceMasterKey(nextMasterKey)

    return {
      ...file,
      version: 3,
      kdf,
      vaults,
      updatedAt: new Date().toISOString(),
      recovery,
    }
  } catch (error) {
    wipe(nextMasterKey)
    throw error
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
