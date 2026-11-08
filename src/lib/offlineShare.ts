/**
 * Partage ponctuel hors ligne d’un élément.
 *
 * Le fichier `.coffre-share` contient l’élément chiffré avec une clé aléatoire
 * de 32 octets. La clé est transmise séparément (mots EFF ou second QR code) :
 * le fichier seul ne permet pas de lire l’élément. Aucun serveur n’est
 * contacté ; l’expiration est indiquée dans le fichier et respectée par
 * l’application Coffre qui l’ouvre.
 */

import {
  fromBase64,
  openJson,
  randomBytes,
  randomId,
  sealJson,
  sha256,
  toBase64,
  wipe,
} from './crypto'
import { parseItemContent } from './vault'
import { decodeSecretWords, encodeSecretWords } from './shamir'
import type { ItemContent, Sealed, VaultItem } from './types'

export const OFFLINE_SHARE_FORMAT = 'coffre-share'
export const OFFLINE_SHARE_VERSION = 1
export const OFFLINE_SHARE_KEY_BYTES = 32

export interface OfflineShareFile {
  format: typeof OFFLINE_SHARE_FORMAT
  version: typeof OFFLINE_SHARE_VERSION
  id: string
  createdAt: string
  expiresAt?: string
  cipher: Sealed
}

export interface CreatedOfflineShare {
  file: OfflineShareFile
  /** Contenu JSON à enregistrer sous `filename`. */
  content: string
  filename: string
  /** Clé à dicter ou à imprimer, séparément du fichier. */
  keyWords: string
  /** Payload compact pour un QR code de clé. */
  keyPayload: string
}

export interface OpenedOfflineShare {
  content: ItemContent
  createdAt: string | null
  expiresAt: string | null
}

export class OfflineShareError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OfflineShareError'
  }
}

export class OfflineShareExpiredError extends OfflineShareError {
  constructor(expiresAt: string) {
    super(`Ce partage a expiré le ${new Date(expiresAt).toLocaleString('fr-FR')}.`)
    this.name = 'OfflineShareExpiredError'
  }
}

function shareAad(id: string): string {
  return `coffre-share:v1:${id}`
}

/** Retire les métadonnées de stockage et les pièces jointes binaires. */
function shareableContent(item: VaultItem): ItemContent {
  const {
    id: _id,
    vaultId: _vaultId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...content
  } = item
  return {
    ...content,
    favorite: false,
    attachments: [],
    deletedAt: null,
  }
}

/** Nom générique : le titre de l’élément ne doit pas apparaître en clair. */
function shareFilename(id: string): string {
  return `partage-${id.slice(2, 10)}.coffre-share`
}

function keyToPayload(key: Uint8Array): string {
  const base64 = toBase64(key)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `coffre-key:v1:${base64}`
}

function payloadToKey(payload: string): Uint8Array {
  const match = /^coffre-key:v1:([A-Za-z0-9_-]+)$/i.exec(payload.trim())
  if (!match) throw new OfflineShareError('Clé de partage invalide')
  const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return fromBase64(padded)
}

const KEY_ENVELOPE_BYTES = 1 + OFFLINE_SHARE_KEY_BYTES + 4

async function wrapShareKey(key: Uint8Array): Promise<Uint8Array> {
  const envelope = new Uint8Array(KEY_ENVELOPE_BYTES)
  envelope[0] = 1
  envelope.set(key, 1)
  const digest = await sha256(envelope.slice(0, 1 + OFFLINE_SHARE_KEY_BYTES))
  envelope.set(digest.slice(0, 4), 1 + OFFLINE_SHARE_KEY_BYTES)
  return envelope
}

async function unwrapShareKey(envelope: Uint8Array): Promise<Uint8Array> {
  if (envelope.length !== KEY_ENVELOPE_BYTES) {
    throw new OfflineShareError('La clé de partage est incomplète')
  }
  if (envelope[0] !== 1) throw new OfflineShareError('Version de clé inconnue')
  const digest = await sha256(envelope.slice(0, 1 + OFFLINE_SHARE_KEY_BYTES))
  const expected = digest.slice(0, 4)
  const actual = envelope.slice(1 + OFFLINE_SHARE_KEY_BYTES)
  if (!expected.every((byte, index) => byte === actual[index])) {
    throw new OfflineShareError('Somme de contrôle de la clé invalide')
  }
  return envelope.slice(1, 1 + OFFLINE_SHARE_KEY_BYTES)
}

/** Accepte une clé en mots EFF ou le payload d’un QR code. */
export async function parseShareKey(text: string): Promise<Uint8Array> {
  const trimmed = text.trim()
  const envelope = trimmed.toLowerCase().startsWith('coffre-key:')
    ? payloadToKey(trimmed)
    : decodeSecretWords(trimmed)
  return unwrapShareKey(envelope)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseShareFile(text: string): OfflineShareFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new OfflineShareError('Le fichier de partage n’est pas un JSON valide')
  }
  const object = asRecord(raw)
  if (!object) throw new OfflineShareError('Fichier de partage invalide')
  if (object.format !== OFFLINE_SHARE_FORMAT) {
    throw new OfflineShareError('Ce fichier n’est pas un partage Coffre')
  }
  if (object.version !== OFFLINE_SHARE_VERSION) {
    throw new OfflineShareError('Version de partage inconnue')
  }
  if (typeof object.id !== 'string' || !object.id) {
    throw new OfflineShareError('Identifiant de partage manquant')
  }
  if (typeof object.createdAt !== 'string') {
    throw new OfflineShareError('Date de partage manquante')
  }
  if (object.expiresAt !== undefined && typeof object.expiresAt !== 'string') {
    throw new OfflineShareError('Date d’expiration invalide')
  }
  const cipher = asRecord(object.cipher)
  if (!cipher || typeof cipher.n !== 'string' || typeof cipher.c !== 'string') {
    throw new OfflineShareError('Contenu chiffré manquant')
  }

  return {
    format: OFFLINE_SHARE_FORMAT,
    version: OFFLINE_SHARE_VERSION,
    id: object.id,
    createdAt: object.createdAt,
    ...(typeof object.expiresAt === 'string' ? { expiresAt: object.expiresAt } : {}),
    cipher: { n: cipher.n, c: cipher.c },
  }
}

/** Prépare un partage chiffré ; la clé est retournée séparément. */
export async function createOfflineShare(
  item: VaultItem,
  expiresAt?: string,
): Promise<CreatedOfflineShare> {
  let expiration: string | undefined
  if (expiresAt) {
    const timestamp = Date.parse(expiresAt)
    if (!Number.isFinite(timestamp)) {
      throw new OfflineShareError('Date d’expiration invalide')
    }
    if (timestamp <= Date.now()) {
      throw new OfflineShareError('La date d’expiration doit être dans le futur')
    }
    expiration = new Date(timestamp).toISOString()
  }

  const key = randomBytes(OFFLINE_SHARE_KEY_BYTES)
  const id = randomId('s')
  try {
    const file: OfflineShareFile = {
      format: OFFLINE_SHARE_FORMAT,
      version: OFFLINE_SHARE_VERSION,
      id,
      createdAt: new Date().toISOString(),
      ...(expiration ? { expiresAt: expiration } : {}),
      cipher: await sealJson({ item: shareableContent(item) }, key, shareAad(id)),
    }

    const envelope = await wrapShareKey(key)
    try {
      return {
        file,
        content: JSON.stringify(file, null, 2),
        filename: shareFilename(id),
        keyWords: encodeSecretWords(envelope),
        keyPayload: keyToPayload(envelope),
      }
    } finally {
      wipe(envelope)
    }
  } finally {
    wipe(key)
  }
}

/** Ouvre un partage avec sa clé et vérifie son expiration. */
export async function openOfflineShare(
  text: string,
  keyInput: string,
  now = Date.now(),
): Promise<OpenedOfflineShare> {
  const file = parseShareFile(text)
  if (file.expiresAt) {
    const timestamp = Date.parse(file.expiresAt)
    if (Number.isFinite(timestamp) && timestamp < now) {
      throw new OfflineShareExpiredError(file.expiresAt)
    }
  }

  const key = await parseShareKey(keyInput)
  try {
    let payload: { item?: unknown }
    try {
      payload = await openJson<{ item?: unknown }>(file.cipher, key, shareAad(file.id))
    } catch {
      throw new OfflineShareError('Clé incorrecte ou fichier de partage altéré')
    }

    let content: ItemContent
    try {
      content = parseItemContent(payload.item)
    } catch {
      throw new OfflineShareError('Contenu du partage invalide')
    }

    return {
      content,
      createdAt: file.createdAt ?? null,
      expiresAt: file.expiresAt ?? null,
    }
  } finally {
    wipe(key)
  }
}
