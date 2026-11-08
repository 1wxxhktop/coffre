/**
 * Compatibilité KeePass KDBX 4.
 *
 * Lecture et écriture d’un sous-ensemble solide du format :
 *  - en-tête KDBX 4, blocs HMAC-SHA-256 et vérification d’intégrité ;
 *  - Argon2d / Argon2id, AES-256-CBC et ChaCha20 ;
 *  - compression gzip, flux protégé interne ChaCha20 / Salsa20 ;
 *  - groupes, champs standard et personnalisés, TOTP, pièces jointes (lecture) ;
 *  - fichiers de clé XML v1/v2, binaires et hexadécimaux.
 *
 * AES-KDF (KDBX 3 / KeePass 2.x ancien) est refusé avec un message explicite :
 * convertir la base en Argon2 dans KeePassXC avant l’import.
 */

import { ModeOfOperation } from 'aes-js'
import { argon2d, argon2id } from 'hash-wasm'
import { gzipSync, gunzipSync } from 'fflate'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import { chacha20Xor, salsa20Xor } from './chacha20'
import {
  fromBase64,
  randomBytes,
  randomId,
  sha256,
  toBase64,
  utf8,
  wipe,
} from './crypto'
import { emptyDraft, type ItemDraft, type VaultItem } from './types'

export class KdbxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KdbxError'
  }
}

const SIG1 = 0x9aa2d903
const SIG2 = 0xb54bfb67
const HEADER_END = 0
const FIELD_CIPHER = 2
const FIELD_COMPRESSION = 3
const FIELD_MASTER_SEED = 4
const FIELD_ENCRYPTION_IV = 7
const FIELD_KDF = 11
const FIELD_PUBLIC_CUSTOM_DATA = 12

const INNER_STREAM_ID = 1
const INNER_STREAM_KEY = 2
const INNER_BINARY = 3

const CIPHER_AES = '31c1f2e6bf714350be5805216afc5aff'
const CIPHER_CHACHA20 = 'd6038a2b8b6f4cb5a524339a31dbb59a'
const KDF_AES = 'c9d9f39a628a4460bf740d08c18a4fea'
const KDF_ARGON2D = 'ef636ddf8c29444b91f7a9a403e30a0c'
const KDF_ARGON2ID = '9e298b1956db4773b23dfc3ec6f0a1e6'

const MAX_KDBX_BYTES = 100 * 1024 * 1024
const MAX_BLOCK_BYTES = 64 * 1024 * 1024
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_ITEMS = 20_000

const XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: false,
  isArray: (name: string) =>
    name === 'Group' || name === 'Entry' || name === 'String' || name === 'Binary',
}

export interface KdbxReadResult {
  items: ItemDraft[]
  warnings: string[]
  databaseName: string
}

export interface KdbxWriteOptions {
  password: string
  keyFile?: Uint8Array
  items: VaultItem[]
  vaultNames?: Map<string, string>
  databaseName?: string
  /** Paramètres Argon2id réduits pour les tests. */
  kdf?: { memoryKiB: number; iterations: number; parallelism: number }
}

interface KdbxHeader {
  version: number
  cipher: string
  compression: number
  masterSeed: Uint8Array
  encryptionIV: Uint8Array
  kdf: VariantDictionary
  headerBytes: Uint8Array
  dataOffset: number
}

type VariantValue = Uint8Array | number | string | boolean

interface VariantDictionary {
  version: number
  values: Map<string, VariantValue>
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function readU64(bytes: Uint8Array, offset: number): number {
  const low = readU32(bytes, offset)
  const high = readU32(bytes, offset + 4)
  return high * 0x1_0000_0000 + low
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  writeU32(bytes, 0, value)
  return bytes
}

function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  writeU32(bytes, 0, value % 0x1_0000_0000)
  writeU32(bytes, 4, Math.floor(value / 0x1_0000_0000))
  return bytes
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function uuidFromHex(value: string): Uint8Array {
  const clean = value.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function uuidBase64(): string {
  return toBase64(randomBytes(16))
}

function decodeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

async function sha512(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-512', bytes as BufferSource))
}

async function hmac(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, message as BufferSource))
}

/* ------------------------------------------------------------------ */
/* VariantDictionary                                                   */
/* ------------------------------------------------------------------ */

function parseVariantDictionary(bytes: Uint8Array): VariantDictionary {
  if (bytes.length < 2) throw new KdbxError('Paramètres KDF invalides')
  const version = bytes[0] | (bytes[1] << 8)
  const values = new Map<string, VariantValue>()
  let offset = 2
  while (offset < bytes.length) {
    const type = bytes[offset]
    offset += 1
    if (type === 0) break
    if (offset + 4 > bytes.length) throw new KdbxError('Paramètres KDF tronqués')
    const keyLength = readU32(bytes, offset)
    offset += 4
    if (offset + keyLength + 4 > bytes.length) throw new KdbxError('Paramètres KDF tronqués')
    const key = decodeText(new TextDecoder().decode(bytes.subarray(offset, offset + keyLength)))
    offset += keyLength
    const valueLength = readU32(bytes, offset)
    offset += 4
    if (offset + valueLength > bytes.length) throw new KdbxError('Paramètres KDF tronqués')
    const raw = bytes.subarray(offset, offset + valueLength)
    offset += valueLength

    switch (type) {
      case 0x04:
        values.set(key, valueLength === 4 ? readU32(raw, 0) : 0)
        break
      case 0x05:
        values.set(key, valueLength === 8 ? readU64(raw, 0) : 0)
        break
      case 0x08:
        values.set(key, raw[0] !== 0)
        break
      case 0x0c:
        values.set(key, valueLength === 4 ? new Int32Array(raw.buffer, raw.byteOffset, 1)[0] : 0)
        break
      case 0x0d:
        values.set(
          key,
          valueLength === 8
            ? Number(new BigInt64Array(raw.buffer, raw.byteOffset, 1)[0])
            : 0,
        )
        break
      case 0x18:
        values.set(key, new TextDecoder().decode(raw))
        break
      case 0x42:
        values.set(key, raw.slice())
        break
      default:
        throw new KdbxError(`Type de paramètre KDF inconnu : ${type}`)
    }
  }
  return { version, values }
}

function buildVariantDictionary(values: Array<[string, VariantValue]>): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([0x00, 0x01])]
  for (const [key, value] of values) {
    const keyBytes = utf8(key)
    let type: number
    let valueBytes: Uint8Array
    if (value instanceof Uint8Array) {
      type = 0x42
      valueBytes = value
    } else if (typeof value === 'number') {
      type = key === 'V' || key === 'P' ? 0x04 : 0x05
      valueBytes = type === 0x05 ? u64(value) : u32(value)
    } else if (typeof value === 'boolean') {
      type = 0x08
      valueBytes = new Uint8Array([value ? 1 : 0])
    } else {
      type = 0x18
      valueBytes = utf8(value)
    }
    chunks.push(
      new Uint8Array([type]),
      u32(keyBytes.length),
      keyBytes,
      u32(valueBytes.length),
      valueBytes,
    )
  }
  chunks.push(new Uint8Array([0]))
  return concat(...chunks)
}

/* ------------------------------------------------------------------ */
/* En-tête KDBX                                                        */
/* ------------------------------------------------------------------ */

function parseHeader(bytes: Uint8Array): KdbxHeader {
  if (bytes.length < 12) throw new KdbxError('Fichier KDBX trop court')
  if (readU32(bytes, 0) !== SIG1 || readU32(bytes, 4) !== SIG2) {
    throw new KdbxError('Signature KDBX invalide')
  }
  const version = readU32(bytes, 8)
  const major = version >>> 16
  if (major !== 4) {
    throw new KdbxError(
      `Version KDBX ${major} non prise en charge ; exportez en KDBX 4 depuis KeePassXC.`,
    )
  }

  let offset = 12
  let cipher = ''
  let compression = 0
  let masterSeed = new Uint8Array()
  let encryptionIV = new Uint8Array()
  let kdf: VariantDictionary | null = null

  while (offset < bytes.length) {
    const field = bytes[offset]
    offset += 1
    if (offset + 4 > bytes.length) throw new KdbxError('En-tête KDBX tronqué')
    const length = readU32(bytes, offset)
    offset += 4
    if (offset + length > bytes.length) throw new KdbxError('En-tête KDBX tronqué')
    const data = bytes.subarray(offset, offset + length)
    offset += length

    if (field === HEADER_END) break
    switch (field) {
      case FIELD_CIPHER:
        cipher = hex(data)
        break
      case FIELD_COMPRESSION:
        compression = length >= 4 ? readU32(data, 0) : 0
        break
      case FIELD_MASTER_SEED:
        masterSeed = data.slice()
        break
      case FIELD_ENCRYPTION_IV:
        encryptionIV = data.slice()
        break
      case FIELD_KDF:
        kdf = parseVariantDictionary(data)
        break
      case FIELD_PUBLIC_CUSTOM_DATA:
        break
      default:
        break
    }
  }

  if (!cipher || !kdf || masterSeed.length !== 32) {
    throw new KdbxError('En-tête KDBX incomplet')
  }
  if (compression !== 0 && compression !== 1) {
    throw new KdbxError('Compression KDBX inconnue')
  }
  if (cipher !== CIPHER_AES && cipher !== CIPHER_CHACHA20) {
    throw new KdbxError('Chiffrement KDBX non pris en charge')
  }
  if (cipher === CIPHER_AES && encryptionIV.length !== 16) {
    throw new KdbxError('IV AES invalide')
  }
  if (cipher === CIPHER_CHACHA20 && encryptionIV.length !== 12) {
    throw new KdbxError('Nonce ChaCha20 invalide')
  }

  return {
    version,
    cipher,
    compression,
    masterSeed,
    encryptionIV,
    kdf,
    headerBytes: bytes.slice(0, offset),
    dataOffset: offset,
  }
}

function kdfUuid(kdf: VariantDictionary): string {
  const uuid = kdf.values.get('$UUID')
  return uuid instanceof Uint8Array ? hex(uuid) : ''
}

async function deriveTransformedKey(
  compositeKey: Uint8Array,
  kdf: VariantDictionary,
): Promise<Uint8Array> {
  const uuid = kdfUuid(kdf)
  if (uuid === KDF_AES) {
    const seed = kdf.values.get('S')
    const rounds = Number(kdf.values.get('R') ?? 0)
    if (!(seed instanceof Uint8Array) || seed.length !== 32) {
      throw new KdbxError('Graine AES-KDF invalide')
    }
    if (rounds < 1 || rounds > 10_000_000) {
      throw new KdbxError('Nombre de tours AES-KDF hors limites')
    }
    const aes = new ModeOfOperation.ecb(seed)
    let data: Uint8Array = compositeKey.slice()
    for (let round = 0; round < rounds; round += 1) data = aes.encrypt(data)
    return sha256(data)
  }
  if (uuid !== KDF_ARGON2D && uuid !== KDF_ARGON2ID) {
    throw new KdbxError('Paramètres KDF KDBX inconnus')
  }
  const salt = kdf.values.get('S')
  const parallelism = Number(kdf.values.get('P') ?? 1)
  const memoryKiB = Number(kdf.values.get('M') ?? 0)
  const iterations = Number(kdf.values.get('I') ?? 0)
  if (!(salt instanceof Uint8Array) || salt.length < 8) {
    throw new KdbxError('Sel Argon2 invalide')
  }
  if (
    parallelism < 1 ||
    parallelism > 64 ||
    memoryKiB < 8_192 ||
    memoryKiB > 1_048_576 ||
    iterations < 1 ||
    iterations > 20
  ) {
    throw new KdbxError('Paramètres Argon2 hors limites')
  }

  const options = {
    password: compositeKey,
    salt,
    iterations,
    parallelism,
    memorySize: memoryKiB,
    hashLength: 32,
    outputType: 'binary' as const,
  }
  const result = uuid === KDF_ARGON2D ? await argon2d(options) : await argon2id(options)
  return new Uint8Array(result)
}

async function deriveKeys(
  password: string,
  keyFile: Uint8Array | undefined,
  kdf: VariantDictionary,
): Promise<{ encryptionKey: Uint8Array; hmacKey: Uint8Array; transformedKey: Uint8Array }> {
  const passwordHash = await sha256(utf8(password))
  let composite = passwordHash
  if (keyFile) {
    const keyFileKey = await parseKeyFile(keyFile)
    composite = await sha256(concat(passwordHash, keyFileKey))
  } else {
    composite = await sha256(passwordHash)
  }
  const transformedKey = await deriveTransformedKey(composite, kdf)
  // Le sel de l’en-tête n’est pas encore connu ici ; les clés finales sont
  // dérivées après lecture du master seed par `finalKeys`.
  return { encryptionKey: new Uint8Array(), hmacKey: new Uint8Array(), transformedKey }
}

async function finalKeys(
  masterSeed: Uint8Array,
  transformedKey: Uint8Array,
): Promise<{ encryptionKey: Uint8Array; hmacKey: Uint8Array }> {
  const encryptionKey = await sha256(concat(masterSeed, transformedKey))
  const hmacKey = await sha512(concat(masterSeed, transformedKey, new Uint8Array([1])))
  return { encryptionKey, hmacKey }
}

/* ------------------------------------------------------------------ */
/* Fichiers de clé                                                     */
/* ------------------------------------------------------------------ */

async function parseKeyFile(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length === 32) return bytes.slice()
  const text = new TextDecoder().decode(bytes).trim()
  if (/^[0-9a-fA-F]{64}$/.test(text)) {
    return hexToBytes(text)
  }
  if (text.startsWith('<')) {
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false })
    const parsed = parser.parse(text) as Record<string, unknown>
    const keyFile = parsed.KeyFile as Record<string, unknown> | undefined
    const key = keyFile?.Key as Record<string, unknown> | undefined
    const data = key?.Data as string | { '#text'?: string } | undefined
    const value = typeof data === 'string' ? data : data?.['#text'] ?? ''
    if (!value) throw new KdbxError('Fichier de clé XML invalide')
    const compact = value.replace(/\s+/g, '')
    if (/^[0-9a-fA-F]{64}$/.test(compact)) return hexToBytes(compact)
    const decoded = fromBase64(compact)
    return decoded.length === 32 ? decoded : sha256(decoded)
  }
  return sha256(bytes)
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

/* ------------------------------------------------------------------ */
/* Blocs HMAC                                                          */
/* ------------------------------------------------------------------ */

const UINT64_MAX_BYTES = new Uint8Array(8).fill(0xff)

async function blockHmacKey(index: number | 'max', hmacKey: Uint8Array): Promise<Uint8Array> {
  const indexBytes = index === 'max' ? UINT64_MAX_BYTES : u64(index)
  return sha512(concat(indexBytes, hmacKey))
}

async function readBlocks(
  bytes: Uint8Array,
  offset: number,
  hmacKey: Uint8Array,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let cursor = offset
  let index = 0
  while (cursor + 36 <= bytes.length) {
    const blockHmac = bytes.subarray(cursor, cursor + 32)
    const size = readU32(bytes, cursor + 32)
    if (size > MAX_BLOCK_BYTES) throw new KdbxError('Bloc KDBX trop volumineux')
    const dataStart = cursor + 36
    const dataEnd = dataStart + size
    if (dataEnd > bytes.length) throw new KdbxError('Bloc KDBX tronqué')
    const data = bytes.subarray(dataStart, dataEnd)
    const key = await blockHmacKey(index, hmacKey)
    const expectedHmac = await hmac(key, concat(u64(index), u32(size), data))
    if (hex(expectedHmac) !== hex(blockHmac)) {
      throw new KdbxError('HMAC KDBX invalide : fichier altéré ou mot de passe incorrect')
    }
    if (size === 0) return concat(...chunks)
    chunks.push(data.slice())
    cursor = dataEnd
    index += 1
  }
  throw new KdbxError('Flux de blocs KDBX tronqué')
}

async function writeBlocks(ciphertext: Uint8Array, hmacKey: Uint8Array): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const blockSize = 1024 * 1024
  let index = 0
  for (let offset = 0; offset < ciphertext.length; offset += blockSize) {
    const data = ciphertext.subarray(offset, Math.min(offset + blockSize, ciphertext.length))
    const key = await blockHmacKey(index, hmacKey)
    const blockHmac = await hmac(key, concat(u64(index), u32(data.length), data))
    chunks.push(blockHmac, u32(data.length), data)
    index += 1
  }
  const finalKey = await blockHmacKey(index, hmacKey)
  const finalHmac = await hmac(finalKey, concat(u64(index), u32(0)))
  chunks.push(finalHmac, u32(0))
  return concat(...chunks)
}

/* ------------------------------------------------------------------ */
/* Flux protégé interne                                                */
/* ------------------------------------------------------------------ */

class ProtectedStream {
  #id: number
  #key: Uint8Array
  #counter = 0
  #buffer: Uint8Array = new Uint8Array(0)
  #position = 0

  constructor(id: number, key: Uint8Array) {
    if (id !== 2 && id !== 3) {
      throw new KdbxError('Flux protégé KDBX non pris en charge')
    }
    this.#id = id
    this.#key = key.slice()
  }

  #nextBlock(): Uint8Array {
    const nonce = new Uint8Array(this.#id === 3 ? 12 : 8)
    const block =
      this.#id === 3
        ? chacha20Xor(this.#key, nonce, new Uint8Array(64), this.#counter)
        : salsa20Xor(this.#key, nonce, new Uint8Array(64), this.#counter)
    this.#counter += 1
    return block
  }

  xor(data: Uint8Array): Uint8Array {
    const output = new Uint8Array(data.length)
    for (let index = 0; index < data.length; index += 1) {
      if (this.#position >= this.#buffer.length) {
        this.#buffer = this.#nextBlock()
        this.#position = 0
      }
      output[index] = data[index] ^ this.#buffer[this.#position]
      this.#position += 1
    }
    return output
  }

  decryptBase64(value: string): string {
    return new TextDecoder().decode(this.xor(fromBase64(value)))
  }

  encryptBase64(value: string): string {
    return toBase64(this.xor(utf8(value)))
  }

  wipe(): void {
    wipe(this.#key)
    this.#buffer = new Uint8Array(0)
  }
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

export async function readKdbx(
  bytes: Uint8Array,
  password: string,
  vaultId: string,
  keyFile?: Uint8Array,
): Promise<KdbxReadResult> {
  if (bytes.length === 0 || bytes.length > MAX_KDBX_BYTES) {
    throw new KdbxError('Fichier KDBX vide ou trop volumineux')
  }
  const header = parseHeader(bytes)
  const { transformedKey } = await deriveKeys(password, keyFile, header.kdf)
  const { encryptionKey, hmacKey } = await finalKeys(header.masterSeed, transformedKey)

  try {
    const headerHash = bytes.subarray(header.dataOffset, header.dataOffset + 32)
    const headerHmac = bytes.subarray(header.dataOffset + 32, header.dataOffset + 64)
    if (headerHash.length !== 32 || headerHmac.length !== 32) {
      throw new KdbxError('En-tête KDBX tronqué')
    }
    const expectedHeaderHash = await sha256(header.headerBytes)
    if (hex(expectedHeaderHash) !== hex(headerHash)) {
      throw new KdbxError('Hash d’en-tête KDBX invalide')
    }
    const headerKey = await blockHmacKey('max', hmacKey)
    const expectedHeaderHmac = await hmac(headerKey, header.headerBytes)
    if (hex(expectedHeaderHmac) !== hex(headerHmac)) {
      throw new KdbxError('HMAC d’en-tête KDBX invalide : mot de passe incorrect ou fichier altéré')
    }

    const ciphertext = await readBlocks(bytes, header.dataOffset + 64, hmacKey)
    let plaintext: Uint8Array
    if (header.cipher === CIPHER_CHACHA20) {
      plaintext = chacha20Xor(encryptionKey, header.encryptionIV, ciphertext)
    } else {
      const key = await crypto.subtle.importKey(
        'raw',
        encryptionKey as BufferSource,
        { name: 'AES-CBC' },
        false,
        ['decrypt'],
      )
      plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-CBC', iv: header.encryptionIV as BufferSource },
          key,
          ciphertext as BufferSource,
        ),
      )
    }

    if (header.compression === 1) {
      try {
        plaintext = gunzipSync(plaintext)
      } catch {
        throw new KdbxError('Décompression KDBX impossible')
      }
    }

    const { xml, stream, binaries } = parseInnerHeader(plaintext)
    const parser = new XMLParser(XML_PARSER_OPTIONS)
    const document = parser.parse(new TextDecoder().decode(xml)) as Record<string, unknown>
    try {
      return parseKeePassDocument(document, vaultId, stream, binaries)
    } finally {
      stream.wipe()
    }
  } finally {
    wipe(transformedKey, encryptionKey, hmacKey)
  }
}

function parseInnerHeader(payload: Uint8Array): {
  xml: Uint8Array
  stream: ProtectedStream
  binaries: Uint8Array[]
} {
  let offset = 0
  let streamId = 0
  let streamKey: Uint8Array | null = null
  const binaries: Uint8Array[] = []
  while (offset < payload.length) {
    const field = payload[offset]
    offset += 1
    if (field === 0) break
    if (offset + 4 > payload.length) throw new KdbxError('En-tête interne KDBX tronqué')
    const length = readU32(payload, offset)
    offset += 4
    if (offset + length > payload.length) throw new KdbxError('En-tête interne KDBX tronqué')
    const data = payload.subarray(offset, offset + length)
    offset += length
    if (field === INNER_STREAM_ID) streamId = length >= 4 ? readU32(data, 0) : 0
    else if (field === INNER_STREAM_KEY) streamKey = data.slice()
    else if (field === INNER_BINARY) {
      if (data.length >= 1) binaries.push(data.subarray(1).slice())
    }
  }
  if (!streamKey) throw new KdbxError('Clé de flux protégé KDBX absente')
  return {
    xml: payload.subarray(offset),
    stream: new ProtectedStream(streamId, streamKey),
    binaries,
  }
}

function parseKeePassDocument(
  document: Record<string, unknown>,
  vaultId: string,
  stream: ProtectedStream | null,
  binaries: Uint8Array[],
): KdbxReadResult {
  const root = document.KeePassFile as Record<string, unknown> | undefined
  const meta = root?.Meta as Record<string, unknown> | undefined
  const databaseName = decodeText(meta?.DatabaseName) || 'KeePass'
  const rootGroup = (root?.Root as Record<string, unknown> | undefined)?.Group as
    | Record<string, unknown>
    | Record<string, unknown>[]
    | undefined
  const groups = Array.isArray(rootGroup) ? rootGroup : rootGroup ? [rootGroup] : []
  const warnings: string[] = []
  const items: ItemDraft[] = []

  const walkGroup = (
    group: Record<string, unknown>,
    tags: string[],
    includeName = true,
  ) => {
    const groupName = includeName ? decodeText(group.Name).trim() : ''
    const nextTags = groupName ? [...tags, groupName].slice(0, 30) : tags
    const entries = group.Entry as Record<string, unknown>[] | undefined
    if (entries) {
      for (const entry of entries) {
        if (items.length >= MAX_ITEMS) {
          warnings.push(`Seuls les ${MAX_ITEMS} premiers éléments ont été importés.`)
          return
        }
        const item = entryToDraft(entry, vaultId, nextTags, stream, binaries, warnings)
        if (item) items.push(item)
      }
    }
    const children = group.Group as Record<string, unknown>[] | undefined
    if (children) for (const child of children) walkGroup(child, nextTags)
  }

  for (const group of groups) walkGroup(group, [], false)
  if (items.length === 0) warnings.push('Aucun élément importable trouvé dans le fichier KeePass.')
  return { items, warnings, databaseName }
}

/** Importe un export XML KeePass 2.x non chiffré. */
export function parseKeePassXml(text: string, vaultId: string): KdbxReadResult {
  const parser = new XMLParser(XML_PARSER_OPTIONS)
  let document: Record<string, unknown>
  try {
    document = parser.parse(text) as Record<string, unknown>
  } catch {
    throw new KdbxError('Fichier XML KeePass invalide')
  }
  if (!document.KeePassFile) throw new KdbxError('Ce fichier n’est pas un export XML KeePass')
  return parseKeePassDocument(document, vaultId, null, [])
}

function entryToDraft(
  entry: Record<string, unknown>,
  vaultId: string,
  tags: string[],
  stream: ProtectedStream | null,
  binaries: Uint8Array[],
  warnings: string[],
): ItemDraft | null {
  const strings = (entry.String as Record<string, unknown>[] | undefined) ?? []
  const values = new Map<string, { value: string; protected: boolean }>()
  for (const string of strings) {
    const key = decodeText(string.Key).trim()
    if (!key) continue
    const raw = string.Value as Record<string, unknown> | string | undefined
    const protectedValue =
      Boolean(raw && typeof raw === 'object') &&
      decodeText((raw as Record<string, unknown>)['@_Protected']).toLowerCase() === 'true'
    let value = ''
    if (protectedValue) {
      if (!stream) {
        warnings.push('Un champ protégé de l’export XML n’a pas pu être déchiffré.')
      } else {
        try {
          value = stream.decryptBase64(decodeText((raw as Record<string, unknown>)['#text']))
        } catch {
          warnings.push('Un champ protégé KDBX n’a pas pu être déchiffré.')
        }
      }
    } else {
      value = decodeText(
        raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['#text'] : raw,
      )
    }
    values.set(key, { value, protected: protectedValue })
  }

  const title = values.get('Title')?.value.trim() || 'Sans titre'
  const username = values.get('UserName')?.value ?? ''
  const password = values.get('Password')?.value ?? ''
  const urls = (values.get('URL')?.value ?? '')
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean)
  const notes = values.get('Notes')?.value ?? ''
  const totp = values.get('otp')?.value ?? values.get('TOTP')?.value ?? ''

  const binaryEntries = (entry.Binary as Record<string, unknown>[] | undefined) ?? []
  let attachments = 0
  for (const binary of binaryEntries) {
    const ref = Number(decodeText(binary.Value && typeof binary.Value === 'object' ? (binary.Value as Record<string, unknown>)['@_Ref'] : ''))
    if (Number.isInteger(ref) && binaries[ref] && binaries[ref].length <= MAX_ATTACHMENT_BYTES) {
      attachments += 1
    }
  }
  if (attachments > 0) {
    warnings.push(
      `${attachments} pièce${attachments > 1 ? 's' : ''} jointe${attachments > 1 ? 's' : ''} KDBX non importée${attachments > 1 ? 's' : ''} : importez-les manuellement.`,
    )
  }
  const history = (entry.History as Record<string, unknown> | undefined)?.Entry
  if (history) {
    const count = Array.isArray(history) ? history.length : 1
    warnings.push(
      `${count} version${count > 1 ? 's' : ''} d’historique KDBX ignorée${count > 1 ? 's' : ''}.`,
    )
  }

  const isLogin = Boolean(username || password || urls.length > 0 || totp)
  const rawTags = entry.Tag
  const entryTags = Array.isArray(rawTags)
    ? rawTags.map((tag) => decodeText(tag).trim()).filter(Boolean)
    : rawTags
      ? [decodeText(rawTags).trim()].filter(Boolean)
      : []

  const draft = emptyDraft(isLogin ? 'login' : 'note', vaultId)
  draft.title = title.slice(0, 200)
  draft.notes = notes.slice(0, 100_000)
  draft.tags = Array.from(new Set([...tags, ...entryTags])).slice(0, 30)
  draft.customFields = []
  for (const [key, entryValue] of values) {
    if (['Title', 'UserName', 'Password', 'URL', 'Notes', 'otp', 'TOTP'].includes(key)) continue
    if (!entryValue.value.trim()) continue
    draft.customFields.push({
      id: randomId('f'),
      label: key.slice(0, 80),
      value: entryValue.value.slice(0, 10_000),
      type: entryValue.protected ? 'hidden' : 'text',
    })
    if (draft.customFields.length >= 30) break
  }
  if (draft.type === 'login') {
    draft.username = username.slice(0, 500)
    draft.password = password.slice(0, 2_000)
    draft.urls = urls.length > 0 ? urls.slice(0, 30) : ['']
    draft.totp = totp.slice(0, 4_096)
  }
  return draft
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

function xmlValue(value: string, stream: ProtectedStream, protect = false): unknown {
  if (protect) {
    return { '@_Protected': 'True', '#text': stream.encryptBase64(value) }
  }
  return value
}

function buildEntry(
  item: VaultItem,
  stream: ProtectedStream,
): Record<string, unknown> {
  const strings: Array<Record<string, unknown>> = []
  const add = (key: string, value: string, protect = false) => {
    if (!value && !protect) return
    strings.push({ Key: key, Value: xmlValue(value, stream, protect) })
  }
  add('Title', item.title)
  if (item.type === 'login') {
    add('UserName', item.username)
    add('Password', item.password, true)
    add('URL', item.urls.filter(Boolean).join('\n'))
    add('otp', item.totp, Boolean(item.totp))
  }
  add('Notes', item.notes)
  for (const field of item.customFields) {
    if (!field.label.trim()) continue
    add(field.label, field.value, field.type === 'hidden')
  }

  return {
    UUID: uuidBase64(),
    IconID: 0,
    Times: {
      CreationTime: new Date().toISOString(),
      LastModificationTime: new Date().toISOString(),
      LastAccessTime: new Date().toISOString(),
      ExpiryTime: item.expiresAt ? `${item.expiresAt}T00:00:00Z` : 'Never',
      Expires: Boolean(item.expiresAt),
      UsageCount: 0,
      LocationChanged: new Date().toISOString(),
    },
    String: strings,
    ...(item.tags.length > 0 ? { Tag: item.tags } : {}),
  }
}

function buildGroup(
  name: string,
  items: VaultItem[],
  stream: ProtectedStream,
): Record<string, unknown> {
  return {
    UUID: uuidBase64(),
    Name: name,
    Notes: '',
    IconID: 48,
    Times: {
      CreationTime: new Date().toISOString(),
      LastModificationTime: new Date().toISOString(),
      LastAccessTime: new Date().toISOString(),
      ExpiryTime: 'Never',
      Expires: false,
      UsageCount: 0,
      LocationChanged: new Date().toISOString(),
    },
    Entry: items.map((item) => buildEntry(item, stream)),
  }
}

export async function writeKdbx(options: KdbxWriteOptions): Promise<Uint8Array> {
  const active = options.items.filter((item) => !item.deletedAt)
  if (active.length === 0) throw new KdbxError('Aucun élément à exporter')
  if (active.length > MAX_ITEMS) throw new KdbxError('Trop d’éléments pour un export KDBX')

  const masterSeed = randomBytes(32)
  const encryptionIV = randomBytes(12)
  const streamKey = randomBytes(32)
  const salt = randomBytes(32)
  const kdf = options.kdf ?? { memoryKiB: 65_536, iterations: 3, parallelism: 4 }
  const stream = new ProtectedStream(3, streamKey)

  try {
    const vaultNames = options.vaultNames ?? new Map<string, string>()
    const groups = new Map<string, VaultItem[]>()
    for (const item of active) {
      const name = vaultNames.get(item.vaultId) || 'Coffre'
      const group = groups.get(name) ?? []
      group.push(item)
      groups.set(name, group)
    }

    const rootGroup = {
      UUID: uuidBase64(),
      Name: options.databaseName || 'Coffre',
      Notes: 'Export Coffre',
      IconID: 48,
      Times: {
        CreationTime: new Date().toISOString(),
        LastModificationTime: new Date().toISOString(),
        LastAccessTime: new Date().toISOString(),
        ExpiryTime: 'Never',
        Expires: false,
        UsageCount: 0,
        LocationChanged: new Date().toISOString(),
      },
      Group: Array.from(groups.entries()).map(([name, items]) =>
        buildGroup(name, items, stream),
      ),
    }

    const xmlObject = {
      KeePassFile: {
        Meta: {
          Generator: 'Coffre',
          DatabaseName: options.databaseName || 'Coffre',
          DatabaseDescription: 'Export Coffre',
          MaintenanceHistoryDays: 365,
          Color: '',
          MasterKeyChanged: new Date().toISOString(),
          RecycleBinEnabled: 'False',
          HistoryMaxItems: 0,
          HistoryMaxSize: 0,
        },
        Root: { Group: rootGroup },
      },
    }
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      format: true,
      suppressEmptyNode: true,
    })
    const xml = utf8(builder.build(xmlObject) as string)

    const innerHeader: Uint8Array[] = [
      new Uint8Array([INNER_STREAM_ID]),
      u32(4),
      u32(3),
      new Uint8Array([INNER_STREAM_KEY]),
      u32(32),
      streamKey,
      new Uint8Array([0]),
    ]
    const payload = concat(...innerHeader, xml)
    const compressed = gzipSync(payload)

    const passwordHash = await sha256(utf8(options.password))
    const keyFileKey = options.keyFile ? await parseKeyFile(options.keyFile) : null
    const composite = keyFileKey
      ? await sha256(concat(passwordHash, keyFileKey))
      : await sha256(passwordHash)
    const kdfValues: Array<[string, VariantValue]> = [
      ['$UUID', uuidFromHex(KDF_ARGON2ID)],
      ['V', 0x13],
      ['I', kdf.iterations],
      ['M', kdf.memoryKiB],
      ['P', kdf.parallelism],
      ['S', salt],
    ]
    const kdfDictionary = buildVariantDictionary(kdfValues)
    const transformedKey = await argon2id({
      password: composite,
      salt,
      iterations: kdf.iterations,
      parallelism: kdf.parallelism,
      memorySize: kdf.memoryKiB,
      hashLength: 32,
      outputType: 'binary',
    })
    const transformed = new Uint8Array(transformedKey)
    const { encryptionKey, hmacKey } = await finalKeys(masterSeed, transformed)
    const ciphertext = chacha20Xor(encryptionKey, encryptionIV, compressed)
    const blocks = await writeBlocks(ciphertext, hmacKey)

    const headerChunks: Uint8Array[] = [
      u32(SIG1),
      u32(SIG2),
      u32(0x0004_0000),
      new Uint8Array([FIELD_CIPHER]),
      u32(16),
      uuidFromHex(CIPHER_CHACHA20),
      new Uint8Array([FIELD_COMPRESSION]),
      u32(4),
      u32(1),
      new Uint8Array([FIELD_MASTER_SEED]),
      u32(32),
      masterSeed,
      new Uint8Array([FIELD_ENCRYPTION_IV]),
      u32(12),
      encryptionIV,
      new Uint8Array([FIELD_KDF]),
      u32(kdfDictionary.length),
      kdfDictionary,
      new Uint8Array([HEADER_END]),
      u32(0),
    ]
    const header = concat(...headerChunks)
    const headerHash = await sha256(header)
    const headerKey = await blockHmacKey('max', hmacKey)
    const headerHmac = await hmac(headerKey, header)
    return concat(header, headerHash, headerHmac, blocks)
  } finally {
    stream.wipe()
    wipe(masterSeed, encryptionIV, streamKey, salt)
  }
}
