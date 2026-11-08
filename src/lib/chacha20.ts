/**
 * ChaCha20 et Salsa20 (flux XOR), pour KDBX 4 et son flux protégé interne.
 * Implémentations autonomes, sans dépendance, conformes aux variantes 20 tours.
 */

function rotl(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0
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

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function quarterRound(
  state: Uint32Array,
  a: number,
  b: number,
  c: number,
  d: number,
): void {
  state[a] = (state[a] + state[b]) >>> 0
  state[d] = rotl(state[d] ^ state[a], 16)
  state[c] = (state[c] + state[d]) >>> 0
  state[b] = rotl(state[b] ^ state[c], 12)
  state[a] = (state[a] + state[b]) >>> 0
  state[d] = rotl(state[d] ^ state[a], 8)
  state[c] = (state[c] + state[d]) >>> 0
  state[b] = rotl(state[b] ^ state[c], 7)
}

function chachaBlock(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array {
  const constants = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574])
  const state = new Uint32Array(16)
  state.set(constants, 0)
  for (let index = 0; index < 8; index += 1) state[4 + index] = readU32(key, index * 4)
  state[12] = counter >>> 0
  for (let index = 0; index < 3; index += 1) state[13 + index] = readU32(nonce, index * 4)

  const working = state.slice()
  for (let round = 0; round < 10; round += 1) {
    quarterRound(working, 0, 4, 8, 12)
    quarterRound(working, 1, 5, 9, 13)
    quarterRound(working, 2, 6, 10, 14)
    quarterRound(working, 3, 7, 11, 15)
    quarterRound(working, 0, 5, 10, 15)
    quarterRound(working, 1, 6, 11, 12)
    quarterRound(working, 2, 7, 8, 13)
    quarterRound(working, 3, 4, 9, 14)
  }

  const output = new Uint8Array(64)
  for (let index = 0; index < 16; index += 1) {
    writeU32(output, index * 4, (working[index] + state[index]) >>> 0)
  }
  return output
}

/** Chiffre/déchiffre un flux avec ChaCha20 (nonce de 12 octets). */
export function chacha20Xor(
  key: Uint8Array,
  nonce: Uint8Array,
  data: Uint8Array,
  initialCounter = 0,
): Uint8Array {
  if (key.length !== 32) throw new Error('Clé ChaCha20 invalide')
  if (nonce.length !== 12) throw new Error('Nonce ChaCha20 invalide')
  const output = new Uint8Array(data.length)
  let counter = initialCounter
  for (let offset = 0; offset < data.length; offset += 64) {
    const block = chachaBlock(key, counter, nonce)
    const length = Math.min(64, data.length - offset)
    for (let index = 0; index < length; index += 1) {
      output[offset + index] = data[offset + index] ^ block[index]
    }
    counter = (counter + 1) >>> 0
  }
  return output
}

function salsaQuarterRound(
  state: Uint32Array,
  a: number,
  b: number,
  c: number,
  d: number,
): void {
  state[b] ^= rotl((state[a] + state[d]) >>> 0, 7)
  state[c] ^= rotl((state[b] + state[a]) >>> 0, 9)
  state[d] ^= rotl((state[c] + state[b]) >>> 0, 13)
  state[a] ^= rotl((state[d] + state[c]) >>> 0, 18)
}

function salsaBlock(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array {
  const constants = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574])
  const state = new Uint32Array(16)
  state[0] = constants[0]
  state[5] = constants[1]
  state[10] = constants[2]
  state[15] = constants[3]
  for (let index = 0; index < 4; index += 1) {
    state[1 + index] = readU32(key, index * 4)
    state[11 + index] = readU32(key, 16 + index * 4)
  }
  state[6] = counter >>> 0
  state[7] = (counter / 0x1_0000_0000) >>> 0
  state[8] = readU32(nonce, 0)
  state[9] = readU32(nonce, 4)

  const working = state.slice()
  for (let round = 0; round < 10; round += 1) {
    salsaQuarterRound(working, 0, 4, 8, 12)
    salsaQuarterRound(working, 5, 9, 13, 1)
    salsaQuarterRound(working, 10, 14, 2, 6)
    salsaQuarterRound(working, 15, 3, 7, 11)
    salsaQuarterRound(working, 0, 1, 2, 3)
    salsaQuarterRound(working, 5, 6, 7, 4)
    salsaQuarterRound(working, 10, 11, 8, 9)
    salsaQuarterRound(working, 15, 12, 13, 14)
  }

  const output = new Uint8Array(64)
  for (let index = 0; index < 16; index += 1) {
    writeU32(output, index * 4, (working[index] + state[index]) >>> 0)
  }
  return output
}

/** Chiffre/déchiffre un flux avec Salsa20 (nonce de 8 octets). */
export function salsa20Xor(
  key: Uint8Array,
  nonce: Uint8Array,
  data: Uint8Array,
  initialCounter = 0,
): Uint8Array {
  if (key.length !== 32) throw new Error('Clé Salsa20 invalide')
  if (nonce.length !== 8) throw new Error('Nonce Salsa20 invalide')
  const output = new Uint8Array(data.length)
  let counter = initialCounter
  for (let offset = 0; offset < data.length; offset += 64) {
    const block = salsaBlock(key, counter, nonce)
    const length = Math.min(64, data.length - offset)
    for (let index = 0; index < length; index += 1) {
      output[offset + index] = data[offset + index] ^ block[index]
    }
    counter += 1
  }
  return output
}
