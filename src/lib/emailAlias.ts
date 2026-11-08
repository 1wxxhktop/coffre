/**
 * Générateur d’alias e-mail hors ligne (F7).
 *
 * Aucun réseau : les adresses « plus » et catch-all sont construites
 * localement à partir de l’adresse de base de l’utilisateur.
 */

export type EmailAliasMode = 'plus' | 'catch-all'

export interface EmailAliasInput {
  baseEmail: string
  site: string
  mode: EmailAliasMode
  tag?: string
}

export interface EmailAliasResult {
  alias: string
  tag: string
}

const DEFAULTS_KEY = 'coffre.email-alias.defaults.v1'

export interface EmailAliasDefaults {
  baseEmail: string
  mode: EmailAliasMode
}

export function getAliasDefaults(): EmailAliasDefaults {
  if (typeof localStorage === 'undefined') {
    return { baseEmail: '', mode: 'plus' }
  }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DEFAULTS_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') {
      return { baseEmail: '', mode: 'plus' }
    }
    const record = parsed as Record<string, unknown>
    return {
      baseEmail: typeof record.baseEmail === 'string' ? record.baseEmail : '',
      mode: record.mode === 'catch-all' ? 'catch-all' : 'plus',
    }
  } catch {
    return { baseEmail: '', mode: 'plus' }
  }
}

export function setAliasDefaults(defaults: EmailAliasDefaults): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(
    DEFAULTS_KEY,
    JSON.stringify({
      baseEmail: defaults.baseEmail.trim(),
      mode: defaults.mode,
    }),
  )
}

function normalizeLocal(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40)
}

function normalizePart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function aliasTagFromSite(site: string): string {
  const raw = site.trim()
  if (!raw) return 'alias'
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    const label = url.hostname.replace(/^www\./, '').split('.')[0] ?? ''
    return normalizePart(label) || 'alias'
  } catch {
    return normalizePart(raw) || 'alias'
  }
}

function randomSuffix(): string {
  const bytes = new Uint8Array(2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function generateEmailAlias(input: EmailAliasInput): EmailAliasResult {
  const base = input.baseEmail.trim().toLowerCase()
  const at = base.lastIndexOf('@')
  if (at <= 0 || at === base.length - 1) {
    throw new Error('Adresse e-mail de base invalide')
  }
  const local = normalizeLocal(base.slice(0, at))
  const domain = base.slice(at + 1).trim()
  if (!local || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new Error('Adresse e-mail de base invalide')
  }
  const siteTag = aliasTagFromSite(input.site)
  const requested = normalizePart(input.tag ?? '')
  const tag = requested || `${siteTag}-${randomSuffix()}`
  const alias =
    input.mode === 'catch-all' ? `${tag}@${domain}` : `${local}+${tag}@${domain}`
  return { alias, tag }
}

export function isValidAlias(value: string): boolean {
  const trimmed = value.trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return false
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  return (
    local.length <= 64 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) &&
    /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)
  )
}
