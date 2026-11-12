import { describe, expect, it } from 'vitest'
import {
  ShamirError,
  combineShares,
  decodeSecretWords,
  decodeShareWords,
  encodeSecretWords,
  encodeShareWords,
  groupShareWords,
  parseShareInput,
  payloadToShare,
  shareToPayload,
  splitSecret,
} from './shamir'

function secret(length = 32): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) bytes[index] = (index * 37 + 11) & 0xff
  return bytes
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

describe('partage de Shamir', () => {
  it('reconstitue le secret avec exactement k parts, quel que soit le sous-ensemble', async () => {
    const value = secret()
    const shares = await splitSecret(value, 3, 5)
    expect(shares).toHaveLength(5)

    for (const subset of [
      [0, 1, 2],
      [0, 2, 4],
      [1, 3, 4],
      [0, 1, 2, 3, 4],
    ]) {
      const combined = await combineShares(subset.map((index) => shares[index]))
      expect(equal(combined, value)).toBe(true)
    }
  })

  it('échoue avec k - 1 parts', async () => {
    const shares = await splitSecret(secret(), 3, 5)
    await expect(combineShares(shares.slice(0, 2))).rejects.toThrow(ShamirError)
  })

  it('refuse une part altérée grâce à la somme de contrôle', async () => {
    const shares = await splitSecret(secret(), 2, 3)
    const tampered = shares[0].slice()
    tampered[5] ^= 0x01
    await expect(combineShares([tampered, shares[1]])).rejects.toThrow(/somme de contrôle/i)
  })

  it('refuse deux parts portant le même numéro', async () => {
    const shares = await splitSecret(secret(), 2, 3)
    await expect(combineShares([shares[0], shares[0]])).rejects.toThrow(/même numéro/i)
  })

  it('refuse des paramètres invalides', async () => {
    await expect(splitSecret(secret(), 1, 3)).rejects.toThrow(ShamirError)
    await expect(splitSecret(secret(), 4, 3)).rejects.toThrow(ShamirError)
    await expect(splitSecret(new Uint8Array(0), 2, 3)).rejects.toThrow(ShamirError)
  })

  it('ne révèle pas le secret dans une part isolée', async () => {
    const value = new Uint8Array(32).fill(0x42)
    let total = 0
    const samples = 300
    for (let index = 0; index < samples; index += 1) {
      const shares = await splitSecret(value, 3, 5)
      // L’octet de valeur de la première part doit être distribué uniformément.
      total += shares[0][4]
    }
    const average = total / samples
    expect(average).toBeGreaterThan(100)
    expect(average).toBeLessThan(155)
  })
})

describe('encodage des parts', () => {
  it('fait un aller-retour en mots EFF', async () => {
    const shares = await splitSecret(secret(), 3, 5)
    for (const share of shares) {
      const words = encodeShareWords(share)
      expect(words.split(' ').length).toBeGreaterThan(20)
      expect(equal(decodeShareWords(words), share)).toBe(true)
      expect(equal(parseShareInput(words), share)).toBe(true)
    }
  })

  it('fait un aller-retour par payload de QR code', async () => {
    const shares = await splitSecret(secret(), 2, 3)
    for (const share of shares) {
      const payload = shareToPayload(share)
      expect(payload.startsWith('coffre-share:v1:')).toBe(true)
      expect(equal(payloadToShare(payload), share)).toBe(true)
      expect(equal(parseShareInput(payload), share)).toBe(true)
    }
  })

  it('rejette un mot inconnu et un payload invalide', () => {
    expect(() => decodeShareWords('ceci nest pas une part')).toThrow(/Mot inconnu/i)
    expect(() => payloadToShare('coffre-share:v1:@@@')).toThrow(ShamirError)
  })

  it('accepte les mots EFF contenant un tiret et les mots séparés par des tirets', async () => {
    const hyphenated = decodeSecretWords('drop-down')
    expect(encodeSecretWords(hyphenated)).toBe('drop-down')

    const separated = decodeSecretWords('abdomen-abdominal')
    expect(encodeSecretWords(separated)).toBe('abdomen abdominal')

    // Certains mots EFF contiennent un tiret (« t-shirt ») : on choisit une
    // part dont aucun mot n’en contient avant de remplacer les séparateurs,
    // sinon le découpage serait ambigu.
    let selected: Uint8Array | null = null
    let words = ''
    for (let attempt = 0; attempt < 20 && !selected; attempt += 1) {
      const shares = await splitSecret(secret(), 2, 3)
      for (const share of shares) {
        const candidate = encodeShareWords(share)
        if (!candidate.split(' ').some((word) => word.includes('-'))) {
          selected = share
          words = candidate
          break
        }
      }
    }
    expect(selected).not.toBeNull()
    const dashed = words.replaceAll(' ', '-')
    expect(equal(decodeShareWords(dashed), selected!)).toBe(true)
  })

  it('groupe les mots par blocs de cinq', async () => {
    const shares = await splitSecret(secret(), 2, 3)
    const groups = groupShareWords(encodeShareWords(shares[0]))
    expect(groups.length).toBeGreaterThan(1)
    expect(groups[0].split(' ')).toHaveLength(5)
    expect(groups.slice(0, -1).every((group) => group.split(' ').length === 5)).toBe(true)
  })
})
