import { describe, expect, it } from 'vitest'
import {
  formatTotp,
  generateTotp,
  isTotpUri,
  parseTotpUri,
  totpRemaining,
  type TotpConfig,
} from './totp'
import { utf8 } from './crypto'

/**
 * Secrets ASCII des vecteurs RFC 6238. Chaque algorithme utilise une clé de
 * la taille de son bloc de hachage : 20 octets (SHA-1), 32 (SHA-256), 64 (SHA-512).
 */
const RFC_SECRETS: Record<TotpConfig['algorithm'], Uint8Array> = {
  'SHA-1': utf8('12345678901234567890'),
  'SHA-256': utf8('12345678901234567890123456789012'),
  'SHA-512': utf8('1234567890123456789012345678901234567890123456789012345678901234'),
}

function config(algorithm: TotpConfig['algorithm']): TotpConfig {
  return {
    secret: RFC_SECRETS[algorithm],
    digits: 8,
    period: 30,
    algorithm,
    issuer: 'Test',
    account: 'test@example.com',
  }
}

describe('TOTP RFC 6238', () => {
  it('calcule les vecteurs SHA-1', async () => {
    const totp = config('SHA-1')
    expect(await generateTotp(totp, 59_000)).toBe('94287082')
    expect(await generateTotp(totp, 1_111_111_109_000)).toBe('07081804')
    expect(await generateTotp(totp, 2_000_000_000_000)).toBe('69279037')
  })

  it('calcule les vecteurs SHA-256', async () => {
    const totp = config('SHA-256')
    expect(await generateTotp(totp, 59_000)).toBe('46119246')
    expect(await generateTotp(totp, 1_111_111_109_000)).toBe('68084774')
  })

  it('calcule les vecteurs SHA-512', async () => {
    const totp = config('SHA-512')
    expect(await generateTotp(totp, 59_000)).toBe('90693936')
    expect(await generateTotp(totp, 1_111_111_109_000)).toBe('25091201')
  })

  it('calcule le temps restant dans la fenêtre', () => {
    expect(totpRemaining(30, 59_000)).toBe(1)
    expect(totpRemaining(30, 30_000)).toBe(30)
    expect(totpRemaining(30, 31_000)).toBe(29)
  })
})

describe('URI otpauth', () => {
  it('analyse une URI standard', () => {
    const parsed = parseTotpUri(
      'otpauth://totp/ACME%20Co:john@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA1&digits=6&period=30',
    )
    expect(parsed.issuer).toBe('ACME Co')
    expect(parsed.account).toBe('john@example.com')
    expect(parsed.digits).toBe(6)
    expect(parsed.period).toBe(30)
    expect(parsed.algorithm).toBe('SHA-1')
    expect(parsed.secret.length).toBeGreaterThan(0)
  })

  it('accepte un secret base32 avec espaces et minuscules', () => {
    const parsed = parseTotpUri(
      'otpauth://totp/Test?secret=jbsw y3dp ehpk 3pxp&digits=8&period=60&algorithm=SHA256',
    )
    expect(parsed.digits).toBe(8)
    expect(parsed.period).toBe(60)
    expect(parsed.algorithm).toBe('SHA-256')
  })

  it('refuse une URI HOTP ou un secret invalide', () => {
    expect(isTotpUri('otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&counter=1')).toBe(false)
    expect(isTotpUri('otpauth://totp/Test?secret=!!!')).toBe(false)
    expect(isTotpUri('https://example.com')).toBe(false)
  })

  it('refuse les algorithmes inconnus et les paramètres hors limites', () => {
    const base = 'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP'
    expect(() => parseTotpUri(`${base}&algorithm=MD5`)).toThrow(/algorithme/i)
    expect(() => parseTotpUri(`${base}&digits=10`)).toThrow(/chiffres/i)
    expect(() => parseTotpUri(`${base}&period=0`)).toThrow(/période/i)
    expect(() => parseTotpUri(`${base}&period=301`)).toThrow(/période/i)
  })

  it('formate les codes par groupes', () => {
    expect(formatTotp('123456')).toBe('123 456')
    expect(formatTotp('12345678')).toBe('1234 5678')
  })
})
