import { describe, expect, it } from 'vitest'
import { CborError, decodeCbor, encodeCbor, type CborValue } from './cbor'

describe('CBOR minimal', () => {
  it('encode et décode les types WebAuthn', () => {
    const value = new Map<CborValue, CborValue>([
      [1, 2],
      [3, -7],
      ['fmt', 'none'],
      ['bytes', Uint8Array.of(1, 2, 3)],
      ['list', [true, false, null]],
      [-1, 'negative'],
    ])
    const decoded = decodeCbor(encodeCbor(value)) as Map<CborValue, CborValue>
    expect(decoded.get(1)).toBe(2)
    expect(decoded.get(3)).toBe(-7)
    expect(decoded.get('fmt')).toBe('none')
    expect(decoded.get('bytes')).toEqual(Uint8Array.of(1, 2, 3))
    expect(decoded.get('list')).toEqual([true, false, null])
    expect(decoded.get(-1)).toBe('negative')
  })

  it('encode les entiers sur plusieurs octets', () => {
    for (const value of [0, 23, 24, 255, 256, 65_535, 65_536, 1_000_000]) {
      expect(decodeCbor(encodeCbor(value))).toBe(value)
    }
  })

  it('refuse un tampon tronqué', () => {
    expect(() => decodeCbor(Uint8Array.of(0x1a, 0x00))).toThrow(CborError)
  })
})
