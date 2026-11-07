/**
 * TOTP (RFC 6238) compatible avec les URI `otpauth://`.
 * Utilise WebCrypto HMAC ; aucun secret ne quitte l’appareil.
 */

export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512'

export interface TotpConfig {
  secret: Uint8Array
  digits: number
  period: number
  algorithm: TotpAlgorithm
  issuer: string
  account: string
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(input: string): Uint8Array {
  const normalized = input.replace(/[\s-]/g, '').replace(/=+$/g, '').toUpperCase()
  if (!normalized) throw new Error('Secret TOTP vide')

  let bits = 0
  let value = 0
  const output: number[] = []

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Secret TOTP invalide (base32 attendu)')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  if (output.length === 0) throw new Error('Secret TOTP invalide')
  return new Uint8Array(output)
}

export function parseTotpUri(uri: string): TotpConfig {
  const trimmed = uri.trim()
  if (!trimmed) throw new Error('URI TOTP vide')

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('URI TOTP invalide')
  }

  if (parsed.protocol !== 'otpauth:') throw new Error('Le lien doit commencer par otpauth://')
  if (parsed.hostname.toLowerCase() !== 'totp') {
    throw new Error('Seuls les codes TOTP sont pris en charge (pas HOTP)')
  }

  const secret = parsed.searchParams.get('secret')
  if (!secret) throw new Error('Secret TOTP manquant')

  const algorithmParam = (parsed.searchParams.get('algorithm') || 'SHA1').toUpperCase()
  const algorithm: TotpAlgorithm =
    algorithmParam === 'SHA256'
      ? 'SHA-256'
      : algorithmParam === 'SHA512'
        ? 'SHA-512'
        : 'SHA-1'

  const digitsRaw = Number.parseInt(parsed.searchParams.get('digits') || '6', 10)
  const digits = Number.isFinite(digitsRaw) && digitsRaw >= 6 && digitsRaw <= 8 ? digitsRaw : 6

  const periodRaw = Number.parseInt(parsed.searchParams.get('period') || '30', 10)
  const period = Number.isFinite(periodRaw) && periodRaw >= 10 && periodRaw <= 120 ? periodRaw : 30

  const label = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  const [labelIssuer, ...labelAccount] = label.split(':')
  const account = (labelAccount.join(':') || labelIssuer || '').trim()
  const issuer = (parsed.searchParams.get('issuer') || (labelAccount.length ? labelIssuer : '')).trim()

  return {
    secret: base32Decode(secret),
    digits,
    period,
    algorithm,
    issuer,
    account,
  }
}

export function isTotpUri(value: string): boolean {
  if (!value.trim()) return false
  try {
    parseTotpUri(value)
    return true
  } catch {
    return false
  }
}

export async function generateTotp(
  config: TotpConfig,
  timestamp = Date.now(),
): Promise<string> {
  const counter = BigInt(Math.floor(timestamp / 1000 / config.period))
  const message = new ArrayBuffer(8)
  new DataView(message).setBigUint64(0, counter, false)

  const key = await crypto.subtle.importKey(
    'raw',
    config.secret as BufferSource,
    { name: 'HMAC', hash: config.algorithm },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
  const offset = signature[signature.length - 1] & 0x0f
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff)

  return String(binary % 10 ** config.digits).padStart(config.digits, '0')
}

export function totpRemaining(period: number, timestamp = Date.now()): number {
  const elapsed = Math.floor(timestamp / 1000) % period
  return period - elapsed
}

export function formatTotp(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`
  return code
}

export function totpAccountLabel(config: TotpConfig): string {
  if (config.issuer && config.account) return `${config.issuer} · ${config.account}`
  return config.issuer || config.account || 'TOTP'
}
