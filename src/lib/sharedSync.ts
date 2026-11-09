/**
 * Synchronisation des coffres partagés par dossier.
 *
 * Chaque membre écrit un bundle signé qui contient les enregistrements déjà
 * chiffrés du coffre. Le bundle est signé par l’identité Ed25519 du membre :
 * un dossier partagé avec un non-membre ne permet donc pas d’injecter des
 * suppressions ou des métadonnées forgées. La clé du coffre reste nécessaire
 * pour ouvrir les éléments et les pièces jointes.
 *
 * Le module ne persiste rien : l’appelant valide le fichier fusionné via
 * `persist` après réception du résultat.
 */

import { sha256, toBase64, utf8 } from './crypto'
import {
  createSharedVaultBundle,
  importSharedVaultBundle,
  parseSharedVaultBundle,
  signSharedVaultBundle,
} from './sharedVaultBundle'
import type { SharedVaultPackage } from './sharingPackage'
import type { SharingIdentity } from './sharing'
import type { VaultFile } from './types'
import type { VaultSession } from './vault'

export const SHARED_BUNDLE_PREFIX = 'shared-'
export const SHARED_BUNDLE_SUFFIX = '.coffre-shared.json'

export interface SharedSyncEntry {
  name: string
  size?: number
  modifiedAt?: number | null
}

export interface SharedSyncIO {
  list: () => Promise<SharedSyncEntry[]>
  read: (name: string) => Promise<string | null>
  write: (name: string, contents: string) => Promise<void>
}

export interface SharedSyncInput {
  file: VaultFile
  session: VaultSession
  identity: SharingIdentity
  vaultId: string
  package: SharedVaultPackage
  io: SharedSyncIO
  lastImports: Record<string, string>
}

export type SharedSyncReport = Pick<
  SharedSyncResult,
  'imported' | 'updated' | 'deleted' | 'conflicts' | 'warnings' | 'written' | 'changed'
>

export interface SharedSyncResult {
  file: VaultFile
  lastImports: Record<string, string>
  ownFile: string
  written: boolean
  imported: number
  updated: number
  deleted: number
  conflicts: number
  warnings: string[]
  changed: boolean
}

function senderTag(fingerprint: string): string {
  return fingerprint
    .replace(/^SHA256:/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .replace(/[^A-Za-z0-9_-]/g, '')
}

/** Nom de fichier stable pour un membre et un coffre. */
export function sharedBundleFileName(
  vaultId: string,
  fingerprint: string,
): string {
  return `${SHARED_BUNDLE_PREFIX}${vaultId}-${senderTag(fingerprint)}${SHARED_BUNDLE_SUFFIX}`
}

export function isSharedBundleName(name: string): boolean {
  return (
    name.startsWith(SHARED_BUNDLE_PREFIX) &&
    name.endsWith(SHARED_BUNDLE_SUFFIX) &&
    /^[A-Za-z0-9_-]+\.coffre-shared\.json$/.test(name)
  )
}

async function contentHash(text: string): Promise<string> {
  return toBase64(await sha256(utf8(text)))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'bundle illisible'
}

/**
 * Écrit le bundle local, puis importe les bundles des autres membres.
 *
 * Un bundle plus récent peut contenir une nouvelle clé de coffre après
 * révocation : l’import est refusé et signalé, car les éléments locaux
 * devraient d’abord être ré-enveloppés.
 */
export async function syncSharedVault(
  input: SharedSyncInput,
): Promise<SharedSyncResult> {
  const { file, session, identity, vaultId, package: pkg, io } = input
  const vaultKey = session.vaultKey(vaultId)
  if (!vaultKey) throw new Error('Coffre partagé verrouillé')
  if (pkg.vaultId !== vaultId) {
    throw new Error('Paquet de partage incohérent')
  }
  const member = pkg.members.find(
    (entry) => entry.identity.fingerprint === identity.fingerprint,
  )
  const isAdmin = pkg.admin.fingerprint === identity.fingerprint
  if (!member && !isAdmin) {
    throw new Error('Cette identité n’est pas membre du coffre partagé')
  }
  const canWrite = isAdmin || member?.role.role === 'write'
  const ownFile = sharedBundleFileName(vaultId, identity.fingerprint)
  const lastImports = { ...input.lastImports }
  const warnings: string[] = []
  let working = file
  let written = false
  let imported = 0
  let updated = 0
  let deleted = 0
  let conflicts = 0
  let changed = false

  const prefix = `${SHARED_BUNDLE_PREFIX}${vaultId}-`
  const entries = (await io.list()).filter(
    (entry) => isSharedBundleName(entry.name) && entry.name.startsWith(prefix),
  )
  const entryNames = new Set(entries.map((entry) => entry.name))

  if (canWrite) {
    const bundle = await signSharedVaultBundle(
      createSharedVaultBundle(working, vaultId, pkg, working.updatedAt),
      identity,
    )
    const text = JSON.stringify(bundle)
    const hash = await contentHash(text)
    if (!entryNames.has(ownFile) || lastImports[ownFile] !== hash) {
      await io.write(ownFile, text)
      lastImports[ownFile] = hash
      written = true
    }
  }

  for (const entry of entries) {
    if (entry.name === ownFile) continue
    let text: string | null
    try {
      text = await io.read(entry.name)
    } catch (error) {
      warnings.push(`« ${entry.name} » : ${errorMessage(error)}`)
      continue
    }
    if (!text) continue
    const hash = await contentHash(text)
    if (lastImports[entry.name] === hash) continue
    try {
      const bundle = await parseSharedVaultBundle(text, {
        requireSignature: true,
      })
      if (bundle.vault.id !== vaultId) {
        warnings.push(`« ${entry.name} » : coffre différent, ignoré`)
        lastImports[entry.name] = hash
        continue
      }
      if (!bundle.sender) throw new Error('bundle sans signature')
      const sender = bundle.sender.fingerprint
      const senderMember = pkg.members.find(
        (entry) => entry.identity.fingerprint === sender,
      )
      const senderIsAdmin = pkg.admin.fingerprint === sender
      if (!senderMember && !senderIsAdmin) {
        warnings.push(`« ${entry.name} » : expéditeur inconnu, ignoré`)
        lastImports[entry.name] = hash
        continue
      }
      if (!senderIsAdmin && senderMember?.role.role !== 'write') {
        warnings.push(`« ${entry.name} » : membre en lecture, ignoré`)
        lastImports[entry.name] = hash
        continue
      }

      const result = await importSharedVaultBundle(
        bundle,
        identity,
        working,
        session,
      )
      imported += result.imported
      updated += result.updated
      deleted += result.deleted
      conflicts += result.conflicts
      if (result.changed) {
        working = result.file
        changed = true
      }
      lastImports[entry.name] = hash
    } catch (error) {
      warnings.push(`« ${entry.name} » : ${errorMessage(error)}`)
    }
  }

  const nextImports: Record<string, string> = {}
  for (const name of entryNames) {
    const hash = lastImports[name]
    if (hash) nextImports[name] = hash
  }
  if (lastImports[ownFile]) nextImports[ownFile] = lastImports[ownFile]
  return {
    file: working,
    lastImports: nextImports,
    ownFile,
    written,
    imported,
    updated,
    deleted,
    conflicts,
    warnings,
    changed,
  }
}

