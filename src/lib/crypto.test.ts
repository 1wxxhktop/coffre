import { describe, expect, it } from 'vitest'
import {
  deriveMasterKey,
  estimateEntropy,
  fromBase64,
  newKdfParams,
  openBytes,
  passwordStrength,
  randomBytes,
  sealBytes,
  toBase64,
  utf8,
  wipe,
} from './crypto'

const FAST_KDF = {
  memoryKiB: 8_192,
  iterations: 1,
  parallelism: 1,
}

describe('base64', () => {
  it('fait un aller-retour sur des octets arbitraires', () => {
    for (const length of [0, 1, 12, 31, 32, 255, 1024]) {
      const bytes = randomBytes(length)
      expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes))
    }
  })
})

describe('AES-256-GCM', () => {
  it('chiffre et déchiffre avec une AAD', async () => {
    const key = randomBytes(32)
    const plaintext = utf8('secret très sensible')
    const sealed = await sealBytes(plaintext, key, 'coffre:test')
    expect(sealed.n).not.toBe('')
    expect(sealed.c).not.toBe('')
    const opened = await openBytes(sealed, key, 'coffre:test')
    expect(new TextDecoder().decode(opened)).toBe('secret très sensible')
  })

  it('refuse une AAD différente', async () => {
    const key = randomBytes(32)
    const sealed = await sealBytes(utf8('secret'), key, 'coffre:test')
    await expect(openBytes(sealed, key, 'coffre:autre')).rejects.toThrow()
  })

  it('refuse une clé différente', async () => {
    const key = randomBytes(32)
    const sealed = await sealBytes(utf8('secret'), key, 'coffre:test')
    await expect(openBytes(sealed, randomBytes(32), 'coffre:test')).rejects.toThrow()
  })

  it('refuse un ciphertext modifié', async () => {
    const key = randomBytes(32)
    const sealed = await sealBytes(utf8('secret'), key, 'coffre:test')
    const raw = fromBase64(sealed.c)
    raw[0] ^= 0xff
    await expect(
      openBytes({ ...sealed, c: toBase64(raw) }, key, 'coffre:test'),
    ).rejects.toThrow()
  })

  it('utilise un nonce différent à chaque chiffrement', async () => {
    const key = randomBytes(32)
    const first = await sealBytes(utf8('même texte'), key, 'coffre:test')
    const second = await sealBytes(utf8('même texte'), key, 'coffre:test')
    expect(first.n).not.toBe(second.n)
    expect(first.c).not.toBe(second.c)
  })
})

describe('Argon2id', () => {
  it('dérive la même clé pour le même sel et mot de passe', async () => {
    const params = { ...newKdfParams(), ...FAST_KDF }
    const a = await deriveMasterKey('mot de passe de test', params)
    const b = await deriveMasterKey('mot de passe de test', params)
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(a).toHaveLength(32)
  })

  it('dérive une clé différente avec un autre sel', async () => {
    const params = { ...newKdfParams(), ...FAST_KDF }
    const a = await deriveMasterKey('mot de passe de test', params)
    const b = await deriveMasterKey('mot de passe de test', {
      ...params,
      salt: toBase64(randomBytes(16)),
    })
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })
})

describe('entropie', () => {
  it('classe les mots de passe faibles et forts', () => {
    expect(passwordStrength(estimateEntropy('123456'))).toMatchObject({ score: 0 })
    expect(
      passwordStrength(estimateEntropy('J’aime les croissants du dimanche matin')),
    ).toMatchObject({ score: 4 })
    expect(estimateEntropy('Xk9#mP2$vL7q')).toBeGreaterThanOrEqual(50)
    expect(estimateEntropy('passwordpassword')).toBeLessThanOrEqual(30)
    expect(estimateEntropy('abcabcabcabc')).toBeLessThanOrEqual(30)
  })

  it('reconnaît les mots de passe humains malgré leur longueur', () => {
    // Mots du dictionnaire, rangées de clavier, suites, années et leetspeak :
    // tous ces exemples dépassaient 50 bits avec l’ancienne estimation.
    for (const password of [
      'Azertyuiop123',
      'P@ssw0rd2024!',
      'Motdepasse2024!',
      'Jetaime123456',
      'Soleil2024!!',
      'Qwertyuiop12',
      'Bonjour123456',
      'Marseille2024',
      'Coffre2026!!!',
    ]) {
      expect(estimateEntropy(password), password).toBeLessThan(50)
    }
  })

  it('accepte les phrases de passe et les mots de passe aléatoires', () => {
    for (const password of [
      'phrase de passe de test solide',
      'correct horse battery staple',
      'tR8!wZq4@nB1',
      'kV3-pL9-xQ2-mN7',
    ]) {
      expect(estimateEntropy(password), password).toBeGreaterThanOrEqual(50)
    }
  })

  it('efface un buffer', () => {
    const key = new Uint8Array([1, 2, 3])
    wipe(key)
    expect(Array.from(key)).toEqual([0, 0, 0])
  })
})
