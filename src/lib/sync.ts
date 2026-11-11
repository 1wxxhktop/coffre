/**
 * Fusion de fichiers `.coffre` entre appareils.
 *
 * Cette couche est **pure** : elle ne lit ni n’écrit aucun fichier, ne déchiffre
 * rien et ne calcule pas de MAC. Elle suppose que chaque fichier distant a déjà
 * été authentifié (MAC global valide) et que les fichiers partagent la même
 * époque de clés. L’intégration (L3c) se charge de vérifier les MAC, de gérer
 * les changements d’époque et de persister le résultat via `signVaultFile`.
 *
 * La fusion est conçue pour être commutative et idempotente :
 *  - un enregistrement est choisi par son horloge `{ rev, writer }` ;
 *  - à `rev` égal, le `writer` le plus grand départage ;
 *  - si des contenus diffèrent à `rev` égal, un conflit est signalé et
 *    l’enregistrement perdant est renvoyé pour être archivé dans l’historique
 *    par l’appelant (qui seul possède la clé de l’élément) ;
 *  - une pierre tombale plus récente que l’enregistrement le supprime ;
 *  - versions et pièces jointes sont unies, puis plafonnées.
 */

import type {
  EncryptedActivityRecord,
  EncryptedGeneratorRecord,
  EncryptedAttachmentRecord,
  EncryptedItemRecord,
  EncryptedTemplateRecord,
  EncryptedVaultRecord,
  EncryptedVersionRecord,
  RecoveryEnvelope,
  VaultFile,
  VaultTombstone,
} from './types'
import { MAX_ITEM_VERSIONS, MAX_STORED_VERSIONS } from './types'

export type VaultSyncErrorCode =
  | 'format'
  | 'version'
  | 'file-id'
  | 'epoch-mismatch'
  | 'kdf-mismatch'
  | 'key-rotation'
  | 'limits'
  | 'no-vault'

export class VaultSyncError extends Error {
  readonly code: VaultSyncErrorCode
  readonly epochs?: number[]

  constructor(code: VaultSyncErrorCode, message: string, epochs?: number[]) {
    super(message)
    this.name = 'VaultSyncError'
    this.code = code
    this.epochs = epochs
  }
}

export type SyncConflict =
  | {
      kind: 'item'
      id: string
      reason: 'concurrent-edit'
      losing: EncryptedItemRecord
    }
  | {
      kind: 'vault'
      id: string
      reason: 'concurrent-edit'
      losing: EncryptedVaultRecord
    }
  | {
      kind: 'attachment'
      id: string
      reason: 'duplicate-id'
      losing: EncryptedAttachmentRecord
    }
  | {
      kind: 'version'
      id: string
      reason: 'duplicate-id'
      losing: EncryptedVersionRecord
    }
  | {
      kind: 'template'
      id: string
      reason: 'concurrent-edit'
      losing: EncryptedTemplateRecord
    }

export interface MergeResult {
  file: VaultFile
  conflicts: SyncConflict[]
  warnings: string[]
}

interface ClockedRecord {
  id: string
  updatedAt?: string
  createdAt?: string
  clock?: { rev: number; writer: string }
}

function clockOf(record: ClockedRecord): { rev: number; writer: string } {
  if (!record.clock) {
    throw new VaultSyncError(
      'format',
      'La synchronisation exige des horloges de version 4 sur chaque enregistrement.',
    )
  }
  return record.clock
}

/** Compare deux horloges : négatif si `a` précède `b`. */
export function compareRecordClock(
  a: ClockedRecord,
  b: ClockedRecord,
): number {
  const left = clockOf(a)
  const right = clockOf(b)
  if (left.rev !== right.rev) return left.rev - right.rev
  return left.writer.localeCompare(right.writer)
}

function itemFingerprint(record: EncryptedItemRecord): string {
  return [
    record.vaultId,
    record.key.n,
    record.key.c,
    record.content.n,
    record.content.c,
    record.updatedAt,
  ].join(':')
}

function vaultFingerprint(record: EncryptedVaultRecord): string {
  return [
    record.key.n,
    record.key.c,
    record.name.n,
    record.name.c,
    record.updatedAt,
  ].join(':')
}

function generatorFingerprint(record: EncryptedGeneratorRecord): string {
  return `${record.data.n}:${record.data.c}`
}

function activityFingerprint(record: EncryptedActivityRecord): string {
  return [record.data.n, record.data.c, record.createdAt].join(':')
}

function templateFingerprint(record: EncryptedTemplateRecord): string {
  return [
    record.key.n,
    record.key.c,
    record.content.n,
    record.content.c,
    record.updatedAt,
  ].join(':')
}

function chooseRecord<T extends ClockedRecord>(
  records: T[],
  fingerprint: (record: T) => string,
): { selected: T; conflict: T | null } {
  let selected = records[0]
  for (const candidate of records.slice(1)) {
    const order = compareRecordClock(candidate, selected)
    if (order > 0 || (order === 0 && fingerprint(candidate) > fingerprint(selected))) {
      selected = candidate
    }
  }

  const topRev = clockOf(selected).rev
  const contenders = records.filter(
    (record) => clockOf(record).rev === topRev,
  )
  let losing: T | null = null
  for (const candidate of contenders) {
    if (candidate === selected) continue
    if (fingerprint(candidate) === fingerprint(selected)) continue
    if (
      !losing ||
      compareRecordClock(candidate, losing) > 0 ||
      (compareRecordClock(candidate, losing) === 0 &&
        fingerprint(candidate) > fingerprint(losing))
    ) {
      losing = candidate
    }
  }

  return { selected, conflict: losing }
}

function tombstoneKey(kind: VaultTombstone['kind'], id: string): string {
  return `${kind}:${id}`
}

function mergeTombstones(files: VaultFile[]): Map<string, VaultTombstone> {
  const merged = new Map<string, VaultTombstone>()
  for (const file of files) {
    for (const tombstone of file.tombstones ?? []) {
      const key = tombstoneKey(tombstone.kind, tombstone.id)
      const existing = merged.get(key)
      if (!existing || tombstone.deletedAt > existing.deletedAt) {
        merged.set(key, tombstone)
      }
    }
  }
  return merged
}

/** Une pierre tombale supprime l’enregistrement si elle n’est pas plus ancienne. */
function tombstoneWins(tombstone: VaultTombstone, updatedAt: string): boolean {
  const deleted = Date.parse(tombstone.deletedAt)
  const updated = Date.parse(updatedAt)
  if (Number.isNaN(deleted) || Number.isNaN(updated)) return false
  return deleted >= updated
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b)
}

function latestFirst<T extends { createdAt: string; id: string }>(
  left: T,
  right: T,
): number {
  return (
    compareText(right.createdAt, left.createdAt) || compareText(left.id, right.id)
  )
}

function uniqueById<T extends { id: string }>(
  records: T[],
  fingerprint: (record: T) => string,
): { selected: T[]; conflicts: Array<{ id: string; losing: T }> } {
  const byId = new Map<string, T>()
  const conflicts: Array<{ id: string; losing: T }> = []
  for (const record of records) {
    const existing = byId.get(record.id)
    if (!existing) {
      byId.set(record.id, record)
      continue
    }
    if (fingerprint(existing) === fingerprint(record)) continue
    // Identifiants aléatoires : une collision avec des contenus différents est
    // anormale. On garde le plus grand empreinte pour rester déterministe.
    if (fingerprint(record) > fingerprint(existing)) {
      conflicts.push({ id: record.id, losing: existing })
      byId.set(record.id, record)
    } else {
      conflicts.push({ id: record.id, losing: record })
    }
  }
  return {
    selected: [...byId.values()],
    conflicts,
  }
}

function selectRecovery(
  files: VaultFile[],
  vaultIds: Set<string>,
): { recovery?: RecoveryEnvelope; warning?: string } {
  const candidates = files
    .filter((file) => file.recovery)
    .map((file) => ({
      recovery: file.recovery as RecoveryEnvelope,
      revision: file.revision ?? 0,
    }))
    .filter(({ recovery }) => {
      const wrapped = new Set(recovery.wraps.map((wrap) => wrap.vaultId))
      if (wrapped.size !== vaultIds.size) return false
      for (const id of vaultIds) {
        if (!wrapped.has(id)) return false
      }
      for (const id of wrapped) {
        if (!vaultIds.has(id)) return false
      }
      return true
    })
    .sort(
      (a, b) =>
        b.revision - a.revision ||
        compareText(b.recovery.createdAt, a.recovery.createdAt) ||
        compareText(
          JSON.stringify(b.recovery),
          JSON.stringify(a.recovery),
        ),
    )

  if (candidates.length > 0) {
    return { recovery: candidates[0].recovery }
  }
  if (files.some((file) => file.recovery)) {
    return {
      warning:
        'L’enveloppe de récupération n’a pas pu être fusionnée : elle ne couvre pas tous les coffres. Régénérez la phrase depuis les réglages.',
    }
  }
  return {}
}

function sameKdf(left: VaultFile['kdf'], right: VaultFile['kdf']): boolean {
  return (
    left.algorithm === right.algorithm &&
    left.salt === right.salt &&
    left.memoryKiB === right.memoryKiB &&
    left.iterations === right.iterations &&
    left.parallelism === right.parallelism &&
    left.keyLength === right.keyLength
  )
}

function validateFiles(local: VaultFile, remotes: VaultFile[]): VaultFile[] {
  const files = [local, ...remotes]
  for (const file of files) {
    if (file.format !== 'coffre') {
      throw new VaultSyncError('format', 'Un fichier à fusionner n’est pas un coffre.')
    }
    if (file.version !== 4) {
      throw new VaultSyncError(
        'version',
        'La synchronisation exige des fichiers migrés en version 4.',
      )
    }
    if (file.id !== local.id) {
      throw new VaultSyncError(
        'file-id',
        'Les fichiers à fusionner n’appartiennent pas au même coffre.',
      )
    }
    if (
      file.keyEpoch === undefined ||
      file.revision === undefined ||
      !file.writer
    ) {
      throw new VaultSyncError(
        'format',
        'Un fichier à fusionner n’a pas d’époque, de révision ou d’appareil écrivain.',
      )
    }
    for (const vault of file.vaults) clockOf(vault)
    for (const item of file.items) clockOf(item)
  }

  const epochs = [...new Set(files.map((file) => file.keyEpoch as number))]
  if (epochs.length > 1) {
    throw new VaultSyncError(
      'epoch-mismatch',
      'Les fichiers n’utilisent pas la même époque de clés : saisissez le nouveau mot de passe avant de fusionner.',
      epochs.sort((a, b) => a - b),
    )
  }

  for (const file of files.slice(1)) {
    if (!sameKdf(file.kdf, local.kdf)) {
      throw new VaultSyncError(
        'kdf-mismatch',
        'Les paramètres de dérivation diffèrent entre les fichiers à fusionner.',
      )
    }
  }

  return files
}

/**
 * Fusionne le fichier local et un ou plusieurs fichiers distants déjà
 * authentifiés. Le résultat n’a **pas** d’intégrité : il doit être passé à
 * `signVaultFile` (via `persist`) avant toute écriture.
 */
export function mergeVaultFiles(
  local: VaultFile,
  remotes: VaultFile[],
): MergeResult {
  const files = validateFiles(local, remotes)
  const conflicts: SyncConflict[] = []

  // Une rotation de clé de coffre partagé change le ciphertext de `vault.key`.
  // La fusion ne peut pas savoir quelles clés d’éléments correspondent à
  // l’ancienne ou à la nouvelle clé : elle refuse plutôt que de produire un
  // fichier dont certains éléments deviendraient illisibles.
  // Coffres : sélection par horloge, puis suppression par pierre tombale.
  const vaultRecords = new Map<string, EncryptedVaultRecord[]>()
  for (const file of files) {
    for (const vault of file.vaults) {
      const list = vaultRecords.get(vault.id) ?? []
      list.push(vault)
      vaultRecords.set(vault.id, list)
    }
  }

  const tombstoneMap = mergeTombstones(files)

  const templateRecords = new Map<string, EncryptedTemplateRecord[]>()
  for (const file of files) {
    for (const template of file.templates ?? []) {
      const list = templateRecords.get(template.id) ?? []
      list.push(template)
      templateRecords.set(template.id, list)
    }
  }
  const templates: EncryptedTemplateRecord[] = []
  for (const records of templateRecords.values()) {
    const { selected, conflict } = chooseRecord(records, templateFingerprint)
    const tombstone = tombstoneMap.get(tombstoneKey('template', selected.id))
    if (tombstone && tombstoneWins(tombstone, selected.updatedAt)) continue
    templates.push(selected)
    if (conflict) {
      conflicts.push({
        kind: 'template',
        id: selected.id,
        reason: 'concurrent-edit',
        losing: conflict,
      })
    }
  }

  const activityRecords = new Map<string, EncryptedActivityRecord[]>()
  for (const file of files) {
    for (const event of file.activity ?? []) {
      const list = activityRecords.get(event.id) ?? []
      list.push(event)
      activityRecords.set(event.id, list)
    }
  }
  const aliasKeysById = new Map<string, NonNullable<VaultFile['aliasKeys']>[number]>()
  for (const file of files) {
    for (const entry of file.aliasKeys ?? []) {
      const previous = aliasKeysById.get(entry.service)
      if (!previous || entry.createdAt > previous.createdAt) {
        aliasKeysById.set(entry.service, entry)
      }
    }
  }
  const aliasKeys = [...aliasKeysById.values()]

  const activity: EncryptedActivityRecord[] = []
  for (const records of activityRecords.values()) {
    activity.push(chooseRecord(records, activityFingerprint).selected)
  }
  activity.sort(
    (a, b) =>
      compareText(b.createdAt, a.createdAt) || compareText(a.id, b.id),
  )
  activity.splice(5_000)

  const generatorRecords = new Map<string, EncryptedGeneratorRecord[]>()
  for (const file of files) {
    for (const entry of file.generatorHistory ?? []) {
      const list = generatorRecords.get(entry.id) ?? []
      list.push(entry)
      generatorRecords.set(entry.id, list)
    }
  }
  const generatorHistory: EncryptedGeneratorRecord[] = []
  for (const records of generatorRecords.values()) {
    generatorHistory.push(chooseRecord(records, generatorFingerprint).selected)
  }
  generatorHistory.sort(
    (a, b) => compareText(b.createdAt, a.createdAt) || compareText(a.id, b.id),
  )
  generatorHistory.splice(50)

  const vaults: EncryptedVaultRecord[] = []
  for (const records of vaultRecords.values()) {
    const { selected, conflict } = chooseRecord(records, vaultFingerprint)
    const tombstone = tombstoneMap.get(tombstoneKey('vault', selected.id))
    // Une suppression de coffre est définitive : les identifiants ne sont pas
    // réutilisés et aucune interface ne restaure un coffre supprimé.
    if (tombstone) continue
    vaults.push(selected)
    if (conflict) {
      conflicts.push({
        kind: 'vault',
        id: selected.id,
        reason: 'concurrent-edit',
        losing: conflict,
      })
    }
  }

  if (vaults.length === 0) {
    throw new VaultSyncError('no-vault', 'La fusion supprimerait tous les coffres.')
  }
  const liveVaultIds = new Set(vaults.map((vault) => vault.id))

  // Éléments : sélection globale par identifiant, puis filtre coffre/tombstone.
  const itemRecords = new Map<string, EncryptedItemRecord[]>()
  for (const file of files) {
    for (const item of file.items) {
      const list = itemRecords.get(item.id) ?? []
      list.push(item)
      itemRecords.set(item.id, list)
    }
  }

  const items: EncryptedItemRecord[] = []
  for (const records of itemRecords.values()) {
    const { selected, conflict } = chooseRecord(records, itemFingerprint)
    if (!liveVaultIds.has(selected.vaultId)) continue
    const tombstone = tombstoneMap.get(tombstoneKey('item', selected.id))
    if (tombstone && tombstoneWins(tombstone, selected.updatedAt)) continue
    items.push(selected)
    if (conflict) {
      conflicts.push({
        kind: 'item',
        id: selected.id,
        reason: 'concurrent-edit',
        losing: conflict,
      })
    }
  }

  // Versions : union pour les éléments survivants, plafonds appliqués après.
  const versionUnion = uniqueById(
    files.flatMap((file) => file.versions),
    (version) =>
      [
        version.itemId,
        version.vaultId,
        version.content.n,
        version.content.c,
        version.createdAt,
      ].join(':'),
  )
  for (const { id, losing } of versionUnion.conflicts) {
    conflicts.push({ kind: 'version', id, reason: 'duplicate-id', losing })
  }
  const versionsByItem = new Map<string, EncryptedVersionRecord[]>()
  const itemDeletions = new Map<string, string>()
  for (const tombstone of tombstoneMap.values()) {
    if (tombstone.kind === 'item') {
      itemDeletions.set(tombstone.id, tombstone.deletedAt)
    }
  }
  const childSurvivesDeletion = (itemId: string, createdAt: string): boolean => {
    const deletedAt = itemDeletions.get(itemId)
    if (!deletedAt) return true
    // Une suppression définitive efface l’historique et les pièces jointes
    // antérieurs ; seuls les enregistrements créés après la suppression
    // peuvent accompagner une résurrection.
    return Date.parse(createdAt) > Date.parse(deletedAt)
  }

  for (const version of versionUnion.selected) {
    const item = items.find((candidate) => candidate.id === version.itemId)
    if (!item || item.vaultId !== version.vaultId) continue
    if (!childSurvivesDeletion(version.itemId, version.createdAt)) continue
    const list = versionsByItem.get(version.itemId) ?? []
    list.push(version)
    versionsByItem.set(version.itemId, list)
  }
  let versions: EncryptedVersionRecord[] = []
  for (const list of versionsByItem.values()) {
    versions.push(...list.sort(latestFirst).slice(0, MAX_ITEM_VERSIONS))
  }
  if (versions.length > MAX_STORED_VERSIONS) {
    versions = versions.sort(latestFirst).slice(0, MAX_STORED_VERSIONS)
  }
  versions.sort(
    (a, b) =>
      compareText(a.itemId, b.itemId) ||
      compareText(b.createdAt, a.createdAt) ||
      compareText(a.id, b.id),
  )

  // Pièces jointes : union pour les éléments survivants. Le contenu chiffré de
  // l’élémentRetenu décidera ensuite lesquelles restent réellement référencées ;
  // l’intégration purge les orphelines après déchiffrement.
  const attachmentUnion = uniqueById(
    files.flatMap((file) => file.attachments),
    (attachment) =>
      [
        attachment.itemId,
        attachment.vaultId,
        attachment.data.n,
        attachment.data.c,
        attachment.createdAt,
      ].join(':'),
  )
  for (const { id, losing } of attachmentUnion.conflicts) {
    conflicts.push({ kind: 'attachment', id, reason: 'duplicate-id', losing })
  }
  const attachments = attachmentUnion.selected
    .filter((attachment) => {
      const item = items.find((candidate) => candidate.id === attachment.itemId)
      return (
        item !== undefined &&
        item.vaultId === attachment.vaultId &&
        childSurvivesDeletion(attachment.itemId, attachment.createdAt)
      )
    })
    .sort((a, b) => compareText(a.id, b.id))

  // Une pierre tombale qui perd face à un enregistrement ressuscité est retirée
  // pour que le fichier reste cohérent (pas de tombstone + enregistrement).
  const tombstones = [...tombstoneMap.values()]
    .sort(
      (a, b) =>
        compareText(b.deletedAt, a.deletedAt) ||
        compareText(a.kind, b.kind) ||
        compareText(a.id, b.id),
    )
    .slice(0, 50_000)
    .sort(
      (a, b) => compareText(a.kind, b.kind) || compareText(a.id, b.id),
    )

  const warnings: string[] = []
  const recovery = selectRecovery(files, liveVaultIds)
  if (recovery.warning) warnings.push(recovery.warning)
  const sharing = local.sharing ?? files.find((file) => file.sharing)?.sharing
  // Ces enveloppes sont locales au fichier : on conserve la copie locale si
  // elle existe, sinon la première copie distante. Les fusionner n’aurait pas
  // de sens cryptographique, mais les supprimer ferait perdre la configuration.
  const emergency =
    local.emergency ?? files.find((file) => file.emergency)?.emergency
  const prf = local.prf ?? files.find((file) => file.prf)?.prf

  const revision = Math.max(...files.map((file) => file.revision ?? 0))
  const writer = files
    .map((file) => file.writer ?? '')
    .sort()
    .at(-1) as string
  const createdAt = files
    .map((file) => file.createdAt)
    .sort()[0]
  const updatedAt = files
    .map((file) => file.updatedAt)
    .sort()
    .at(-1) as string

  if (
    vaults.length > 50 ||
    items.length > 20_000 ||
    attachments.length > 20_000 ||
    templates.length > 500 ||
    activity.length > 5_000
  ) {
    throw new VaultSyncError(
      'limits',
      'La fusion dépasse les plafonds du format de coffre.',
    )
  }
  const merged: VaultFile = {
    format: 'coffre',
    version: 4,
    id: local.id,
    createdAt,
    updatedAt,
    kdf: local.kdf,
    vaults: vaults.sort((a, b) => compareText(a.id, b.id)),
    items: items.sort((a, b) => compareText(a.id, b.id)),
    attachments,
    versions,
    templates,
    activity,
    ...(generatorHistory.length > 0 ? { generatorHistory } : {}),
    ...(aliasKeys.length > 0 ? { aliasKeys } : {}),
    tombstones,
    writer,
    revision,
    keyEpoch: local.keyEpoch as number,
    recovery: recovery.recovery,
    ...(sharing ? { sharing } : {}),
    ...(emergency ? { emergency } : {}),
    ...(prf ? { prf } : {}),
  }
  delete merged.integrity

  conflicts.sort(
    (a, b) => compareText(a.kind, b.kind) || compareText(a.id, b.id),
  )

  return { file: merged, conflicts, warnings }
}
