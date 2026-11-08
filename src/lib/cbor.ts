/**
 * Encodeur/décodeur CBOR minimal, limité aux types utilisés par les passkeys
 * WebAuthn : entiers, chaînes, octets, tableaux, maps et booléens.
 */

export class CborError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CborError'
  }
}

export type CborValue =
  | number
  | string
  | Uint8Array
  | boolean
  | null
  | CborValue[]
  | Map<CborValue, CborValue>

function head(major: number, length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new CborError('Longueur CBOR invalide')
  }
  if (length < 24) {
    return Uint8Array.of((major << 5) | length)
  }
  if (length < 0x100) {
    return Uint8Array.of((major << 5) | 24, length)
  }
  if (length < 0x10000) {
    return Uint8Array.of(
      (major << 5) | 25,
      (length >> 8) & 0xff,
      length & 0xff,
    )
  }
  if (length < 0x1_0000_0000) {
    return Uint8Array.of(
      (major << 5) | 26,
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
    )
  }
  throw new CborError('Longueur CBOR trop grande')
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function encodeValue(value: CborValue): Uint8Array {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new CborError('CBOR : nombre non entier')
    if (value >= 0) return head(0, value)
    return head(1, -1 - value)
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value)
    return concat([head(3, bytes.length), bytes])
  }
  if (typeof value === 'boolean') {
    return Uint8Array.of(value ? 0xf5 : 0xf4)
  }
  if (value === null) return Uint8Array.of(0xf6)
  if (value instanceof Uint8Array) {
    return concat([head(2, value.length), value])
  }
  if (Array.isArray(value)) {
    return concat([head(4, value.length), ...value.map(encodeValue)])
  }
  if (value instanceof Map) {
    const entries: Uint8Array[] = [head(5, value.size)]
    for (const [key, entry] of value) {
      entries.push(encodeValue(key), encodeValue(entry))
    }
    return concat(entries)
  }
  throw new CborError('Type CBOR non pris en charge')
}

export function encodeCbor(value: CborValue): Uint8Array {
  return encodeValue(value)
}

class Reader {
  #bytes: Uint8Array
  #offset = 0

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
  }

  get done(): boolean {
    return this.#offset >= this.#bytes.length
  }

  byte(): number {
    if (this.done) throw new CborError('CBOR tronqué')
    return this.#bytes[this.#offset++]
  }

  take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new CborError('Longueur CBOR négative')
    }
    if (this.#offset + length > this.#bytes.length) {
      throw new CborError('CBOR tronqué')
    }
    const result = this.#bytes.subarray(this.#offset, this.#offset + length)
    this.#offset += length
    return result
  }

  length(additional: number): number {
    if (additional < 24) return additional
    if (additional === 24) return this.byte()
    if (additional === 25) {
      return (this.byte() << 8) | this.byte()
    }
    if (additional === 26) {
      return (
        (this.byte() * 0x1_000_000) +
        (this.byte() << 16) +
        (this.byte() << 8) +
        this.byte()
      )
    }
    throw new CborError('Longueur CBOR non prise en charge')
  }

  value(): CborValue {
    const initial = this.byte()
    const major = initial >> 5
    const additional = initial & 0x1f

    switch (major) {
      case 0:
        return this.length(additional)
      case 1:
        return -1 - this.length(additional)
      case 2:
        return this.take(this.length(additional))
      case 3:
        return new TextDecoder().decode(this.take(this.length(additional)))
      case 4: {
        const length = this.length(additional)
        const items: CborValue[] = []
        for (let index = 0; index < length; index++) items.push(this.value())
        return items
      }
      case 5: {
        const length = this.length(additional)
        const map = new Map<CborValue, CborValue>()
        for (let index = 0; index < length; index++) {
          map.set(this.value(), this.value())
        }
        return map
      }
      case 7:
        if (additional === 20) return false
        if (additional === 21) return true
        if (additional === 22) return null
        throw new CborError('Valeur CBOR simple non prise en charge')
      default:
        throw new CborError('Type CBOR non pris en charge')
    }
  }
}

export function decodeCbor(bytes: Uint8Array): CborValue {
  const reader = new Reader(bytes)
  const value = reader.value()
  if (!reader.done) throw new CborError('Octets CBOR en trop')
  return value
}
