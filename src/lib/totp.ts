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
  let algorithm: TotpAlgorithm
  if (algorithmParam === 'SHA1') algorithm = 'SHA-1'
  else if (algorithmParam === 'SHA256') algorithm = 'SHA-256'
  else if (algorithmParam === 'SHA512') algorithm = 'SHA-512'
  else throw new Error('Algorithme TOTP non pris en charge')

  const digitsRaw = Number.parseInt(parsed.searchParams.get('digits') || '6', 10)
  if (!Number.isInteger(digitsRaw) || digitsRaw < 6 || digitsRaw > 8) {
    throw new Error('Nombre de chiffres TOTP hors limites')
  }
  const digits = digitsRaw

  const periodRaw = Number.parseInt(parsed.searchParams.get('period') || '30', 10)
  if (!Number.isInteger(periodRaw) || periodRaw < 1 || periodRaw > 300) {
    throw new Error('Période TOTP hors limites')
  }
  const period = periodRaw

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

/**
 * Normalise un secret TOTP base32 en URI `otpauth://` quand c’est possible.
 * Les valeurs déjà au format URI sont renvoyées telles quelles.
 */
export function normalizeTotpUri(raw: string, title: string, account = ''): string {
  const value = raw.trim()
  if (!value) return ''
  if (/^otpauth:\/\//i.test(value)) return value

  const secret = value.replace(/[\s-]/g, '').toUpperCase()
  if (secret.length < 8 || !/^[A-Z2-7]+=*$/.test(secret)) return value

  const issuerName = title.trim() || 'Coffre'
  const accountName = account.trim()
  const label = accountName
    ? `${encodeURIComponent(issuerName)}:${encodeURIComponent(accountName)}`
    : encodeURIComponent(title.trim() || 'Compte')
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuerName)}`
}

/**
 * Valeur à afficher dans le champ de saisie : la clé secrète seule, groupée
 * par quatre, quand le lien n’utilise que les réglages par défaut (SHA-1,
 * 6 chiffres, 30 s). Sinon le lien complet, pour ne pas perdre ses réglages.
 */
export function totpInputValue(stored: string): string {
  const value = stored.trim()
  if (!/^otpauth:\/\//i.test(value)) return stored
  try {
    const url = new URL(value)
    const params = url.searchParams
    const secret = params.get('secret')
    const algorithm = (params.get('algorithm') ?? 'SHA1').toUpperCase()
    const digits = params.get('digits') ?? '6'
    const period = params.get('period') ?? '30'
    if (
      !secret ||
      url.hostname.toLowerCase() !== 'totp' ||
      algorithm !== 'SHA1' ||
      digits !== '6' ||
      period !== '30'
    ) {
      return stored
    }
    return secret.replace(/=+$/, '').toUpperCase().match(/.{1,4}/g)?.join(' ') ?? secret
  } catch {
    return stored
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
