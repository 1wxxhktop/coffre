/**
 * Import et export du Credential Exchange Format (CXF 1.0, FIDO Alliance).
 *
 * Le document est un JSON autonome. Coffre n’embarque ni fichiers joints ni
 * icônes : le transfert CXP et le chiffrement du transport restent hors du
 * périmètre. L’export contient donc des secrets en clair et doit être traité
 * comme une sauvegarde sensible.
 */

import { toBase64 } from './crypto'
import { ImportError, type ParsedImport } from './import'
import { recoveryCodesExportText } from './recoveryCodes'
import {
  base64ToBase64Url,
  fromBase64Url,
  publicKeyCoseFromPrivateKey,
  toBase64Url,
} from './passkeys'
import {
  emptyDraft,
  type CustomField,
  type DocumentKind,
  type ItemDraft,
  type RecoveryCode,
  type VaultItem,
} from './types'

const CXF_MAJOR = 1
const CXF_MINOR = 0

/**
 * Extension propriétaire pour les types sans équivalent CXF natif. Le nom
 * respecte `EXPORTER_RP_ID/EXTENSION_NAME` ; les autres importateurs doivent
 * l’ignorer.
 */
const ITEM_TYPE_EXTENSION = 'coffre.local/item-type'

const WIFI_TO_CXF: Record<string, string> = {
  WPA: 'wpa2-personal',
  WEP: 'wep',
  nopass: 'unsecured',
}

const CXF_TO_WIFI: Record<string, 'WPA' | 'WEP' | 'nopass'> = {
  'wpa-personal': 'WPA',
  'wpa2-personal': 'WPA',
  'wpa3-personal': 'WPA',
  wep: 'WEP',
  unsecured: 'nopass',
}

function itemTypeExtension(itemType: string): CxfExtension {
  return { name: ITEM_TYPE_EXTENSION, itemType }
}

export interface CxfEditableField {
  id?: string
  fieldType: string
  value: string
  label?: string
}

export interface CxfCredential {
  type: string
  [key: string]: unknown
}

export interface CxfExtension {
  name: string
  [key: string]: unknown
}

export interface CxfItem {
  id: string
  creationAt?: number
  modifiedAt?: number
  title: string
  subtitle?: string
  favorite?: boolean
  scope?: { urls: string[]; androidApps: unknown[] }
  credentials: CxfCredential[]
  tags?: string[]
  extensions?: CxfExtension[]
}

export interface CxfCollection {
  id: string
  title: string
  items: Array<{ item: string }>
  subCollections?: CxfCollection[]
}

export interface CxfAccount {
  id: string
  username: string
  email: string
  fullName?: string
  collections: CxfCollection[]
  items: CxfItem[]
}

export interface CxfDocument {
  version: { major: number; minor: number }
  exporterRpId: string
  exporterDisplayName: string
  timestamp: number
  accounts: CxfAccount[]
}

export interface CxfExportResult {
  document: CxfDocument
  json: string
  warnings: string[]
}

function cxfId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

function field(
  value: string,
  fieldType = 'string',
  label?: string,
): CxfEditableField {
  return {
    id: cxfId(),
    fieldType,
    value,
    ...(label ? { label } : {}),
  }
}

function customFieldType(type: CustomField['type']): string {
  switch (type) {
    case 'hidden':
    case 'password':
    case 'pin':
    case 'totp':
      return 'concealed-string'
    case 'email':
      return 'email'
    case 'number':
      return 'number'
    case 'checkbox':
      return 'boolean'
    case 'date':
      return 'date'
    case 'month':
      return 'year-month'
    default:
      return 'string'
  }
}

function customFieldsCredential(fields: CxfEditableField[]): CxfCredential | null {
  if (fields.length === 0) return null
  return { type: 'custom-fields', fields }
}

function cardExpiry(value: string): string {
  const trimmed = value.trim()
  const match = /^(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/.exec(trimmed)
  if (!match) return trimmed
  const month = match[1].padStart(2, '0')
  const year = match[2].length === 2 ? `20${match[2]}` : match[2]
  return `${year}-${month}`
}

function totpCredential(uri: string): CxfCredential | null {
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'otpauth:' || parsed.hostname.toLowerCase() !== 'totp') {
      return null
    }
    const secret = parsed.searchParams.get('secret')
    if (!secret) return null
    const algorithm = (parsed.searchParams.get('algorithm') ?? 'SHA1').toLowerCase()
    const issuer = parsed.searchParams.get('issuer') ?? ''
    const username = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    return {
      type: 'totp',
      secret: secret.replace(/[\s=]+/g, '').toUpperCase(),
      period: Number(parsed.searchParams.get('period')) || 30,
      digits: Number(parsed.searchParams.get('digits')) || 6,
      algorithm:
        algorithm === 'sha256' ? 'sha256' : algorithm === 'sha512' ? 'sha512' : 'sha1',
      ...(issuer ? { issuer } : {}),
      ...(username ? { username } : {}),
    }
  } catch {
    return null
  }
}

function scopeUrls(item: VaultItem): string[] {
  return item.type === 'login'
    ? item.urls.map((url) => url.trim()).filter(Boolean).slice(0, 30)
    : []
}

function scopeFor(item: VaultItem): CxfItem['scope'] | undefined {
  const urls = scopeUrls(item)
  // `androidApps` est un tableau requis par CXF 1.0, même vide.
  return urls.length > 0 ? { urls, androidApps: [] } : undefined
}

/** Convertit une clé PKCS#8 PEM en DER base64url, ou null si le format diffère. */
function pkcs8Base64Url(privateKey: string): string | null {
  const match =
    /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(privateKey)
  if (!match) return null
  const base64 = match[1].replace(/\s+/g, '')
  return base64 ? base64ToBase64Url(base64) : null
}

function sshKeyType(publicKey: string): string {
  return publicKey.trim().split(/\s+/)[0] ?? ''
}

function sshPrivateKeyPem(value: string): string {
  const der = fromBase64Url(value)
  // Une clé PKCS#8 DER commence toujours par un SEQUENCE (0x30).
  if (der.length < 16 || der[0] !== 0x30) {
    throw new Error('clé PKCS#8 invalide')
  }
  const base64 = toBase64(der)
  const lines = base64.match(/.{1,64}/g) ?? [base64]
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`
}

function fieldValue(
  fields: CustomField[],
  labels: string[],
): CustomField | undefined {
  return fields.find(
    (entry) => entry.label && labels.includes(entry.label),
  )
}

function baseCustomFields(item: VaultItem): CxfEditableField[] {
  const fields = item.customFields
    .filter((entry) => entry.label.trim() || entry.value.trim())
    .map((entry) =>
      field(entry.value.slice(0, 10_000), customFieldType(entry.type), entry.label),
    )
  if (item.expiresAt.trim()) {
    fields.push(field(item.expiresAt.trim().slice(0, 40), 'date', 'Échéance'))
  }
  return fields
}

function credentialsFor(item: VaultItem, warnings: string[]): CxfCredential[] {
  const credentials: CxfCredential[] = []

  if (item.type === 'login') {
    credentials.push({
      type: 'basic-auth',
      ...(item.username ? { username: field(item.username, 'string') } : {}),
      ...(item.password ? { password: field(item.password, 'concealed-string') } : {}),
    })
    if (item.totp.trim()) {
      const totp = totpCredential(item.totp)
      if (totp) credentials.push(totp)
      else warnings.push(`« ${item.title} » : TOTP non exporté (URI invalide).`)
    }
  } else if (item.type === 'note') {
    credentials.push({ type: 'note', content: field(item.notes, 'string') })
    const custom = customFieldsCredential(baseCustomFields(item))
    if (custom) credentials.push(custom)
    return credentials
  } else if (item.type === 'recovery-codes') {
    credentials.push({
      type: 'note',
      content: field(recoveryCodesExportText(item), 'string'),
    })
    if (item.notes.trim()) {
      credentials.push({ type: 'note', content: field(item.notes, 'string') })
    }
    const custom = customFieldsCredential(baseCustomFields(item))
    if (custom) credentials.push(custom)
    return credentials
  } else if (item.type === 'card') {
    credentials.push({
      type: 'credit-card',
      ...(item.number ? { number: field(item.number, 'concealed-string') } : {}),
      ...(item.cardholder ? { fullName: field(item.cardholder, 'string') } : {}),
      ...(item.brand ? { cardType: field(item.brand, 'string') } : {}),
      ...(item.cvc ? { verificationNumber: field(item.cvc, 'concealed-string') } : {}),
      ...(item.pin ? { pin: field(item.pin, 'concealed-string') } : {}),
      ...(item.expiry
        ? { expiryDate: field(cardExpiry(item.expiry), 'year-month') }
        : {}),
    })
  } else if (item.type === 'ssh-key') {
    const keyType = sshKeyType(item.publicKey)
    const privateKey = pkcs8Base64Url(item.privateKey)
    if (keyType && privateKey) {
      credentials.push({
        type: 'ssh-key',
        keyType,
        privateKey,
        ...(item.comment ? { keyComment: item.comment.slice(0, 500) } : {}),
      })
    } else {
      warnings.push(
        `« ${item.title} » : clé SSH exportée en champs personnalisés (CXF exige une clé PKCS#8 et un type de clé publique).`,
      )
    }
    const extra = baseCustomFields(item)
    if (!privateKey) {
      extra.push(
        field(item.privateKey.slice(0, 10_000), 'concealed-string', 'Clé privée SSH'),
      )
    }
    if (item.publicKey) {
      extra.push(field(item.publicKey.slice(0, 10_000), 'string', 'Clé publique SSH'))
    }
    if (item.fingerprint) {
      extra.push(field(item.fingerprint.slice(0, 500), 'string', 'Empreinte SSH'))
    }
    if (!privateKey && item.comment) {
      extra.push(field(item.comment.slice(0, 500), 'string', 'Commentaire SSH'))
    }
    if (item.notes.trim()) {
      credentials.push({ type: 'note', content: field(item.notes, 'string') })
    }
    const custom = customFieldsCredential(extra)
    if (custom) credentials.push(custom)
    return credentials
  } else if (item.type === 'wifi') {
    credentials.push({
      type: 'wifi',
      ...(item.ssid ? { ssid: field(item.ssid, 'string') } : {}),
      networkSecurityType: field(
        WIFI_TO_CXF[item.security] ?? 'wpa2-personal',
        'wifi-network-security-type',
      ),
      ...(item.password
        ? { passphrase: field(item.password, 'concealed-string') }
        : {}),
      hidden: field(String(item.hidden), 'boolean'),
    })
  } else if (item.type === 'api-credential') {
    credentials.push({
      type: 'api-key',
      ...(item.secret ? { key: field(item.secret, 'concealed-string') } : {}),
      ...(item.keyId ? { username: field(item.keyId, 'string') } : {}),
      ...(item.endpoint ? { url: field(item.endpoint, 'string') } : {}),
      ...(item.expiresAt ? { expiryDate: field(item.expiresAt, 'date') } : {}),
    })
    const extra = baseCustomFields(item).filter((entry) => entry.label !== 'Échéance')
    if (item.environment) {
      extra.push(field(item.environment, 'string', 'Environnement'))
    }
    if (item.notes.trim()) {
      credentials.push({ type: 'note', content: field(item.notes, 'string') })
    }
    const custom = customFieldsCredential(extra)
    if (custom) credentials.push(custom)
    return credentials
  } else if (item.type === 'software-license') {
    const extra = baseCustomFields(item)
    if (item.licenseKey) {
      extra.unshift(field(item.licenseKey, 'concealed-string', 'Clé de licence'))
    }
    if (item.licensedTo) extra.push(field(item.licensedTo, 'string', 'Titulaire'))
    if (item.version) extra.push(field(item.version, 'string', 'Version'))
    if (item.website) extra.push(field(item.website, 'string', 'Site web'))
    if (item.purchaseDate) {
      extra.push(field(item.purchaseDate, 'date', 'Date d’achat'))
    }
    if (item.notes.trim()) {
      credentials.push({ type: 'note', content: field(item.notes, 'string') })
    }
    const custom = customFieldsCredential(extra)
    if (custom) credentials.push(custom)
    return credentials
  } else if (item.type === 'document') {
    const extra = baseCustomFields(item).filter((entry) => entry.label !== 'Échéance')
    if (item.documentKind === 'identity') {
      credentials.push({
        type: 'identity-document',
        ...(item.documentNumber
          ? { documentNumber: field(item.documentNumber, 'string') }
          : {}),
        ...(item.issuer
          ? { issuingAuthority: field(item.issuer, 'string') }
          : {}),
        ...(item.issuedAt ? { issueDate: field(item.issuedAt, 'date') } : {}),
        ...(item.expiresAt ? { expiryDate: field(item.expiresAt, 'date') } : {}),
      })
    } else {
      extra.push(field(item.documentKind, 'string', 'Type de document'))
      if (item.issuer) extra.push(field(item.issuer, 'string', 'Émetteur'))
      if (item.documentNumber) {
        extra.push(field(item.documentNumber, 'string', 'Numéro du document'))
      }
      if (item.issuedAt) {
        extra.push(field(item.issuedAt, 'date', 'Date d’émission'))
      }
      if (item.expiresAt) extra.push(field(item.expiresAt, 'date', 'Échéance'))
    }
    if (item.notes.trim()) {
      credentials.push({ type: 'note', content: field(item.notes, 'string') })
    }
    const custom = customFieldsCredential(extra)
    if (custom) credentials.push(custom)
    return credentials
  } else if (item.type === 'identity') {
    if (
      item.address ||
      item.city ||
      item.postalCode ||
      item.country ||
      item.phone
    ) {
      credentials.push({
        type: 'address',
        ...(item.address ? { streetAddress: field(item.address, 'string') } : {}),
        ...(item.postalCode ? { postalCode: field(item.postalCode, 'string') } : {}),
        ...(item.city ? { city: field(item.city, 'string') } : {}),
        ...(item.country ? { country: field(item.country, 'country-code') } : {}),
        ...(item.phone ? { tel: field(item.phone, 'string') } : {}),
      })
    }
    if (item.firstName || item.lastName) {
      credentials.push({
        type: 'person-name',
        ...(item.firstName ? { given: field(item.firstName, 'string') } : {}),
        ...(item.lastName ? { surname: field(item.lastName, 'string') } : {}),
      })
    }
    const fullName = [item.firstName, item.lastName].filter(Boolean).join(' ')
    if (item.passportExpiry) {
      credentials.push({
        type: 'passport',
        ...(fullName ? { fullName: field(fullName, 'string') } : {}),
        expiryDate: field(item.passportExpiry, 'date'),
      })
    }
    if (item.licenseExpiry) {
      credentials.push({
        type: 'drivers-license',
        ...(fullName ? { fullName: field(fullName, 'string') } : {}),
        expiryDate: field(item.licenseExpiry, 'date'),
      })
    }
    if (item.idCardExpiry) {
      credentials.push({
        type: 'identity-document',
        ...(fullName ? { fullName: field(fullName, 'string') } : {}),
        ...(item.birthDate ? { birthDate: field(item.birthDate, 'date') } : {}),
        expiryDate: field(item.idCardExpiry, 'date'),
      })
    }
    const extra = baseCustomFields(item)
    if (item.email) extra.push(field(item.email, 'email', 'E-mail'))
    if (item.birthDate && !item.idCardExpiry) {
      extra.push(field(item.birthDate, 'date', 'Naissance'))
    }
    if (item.notes.trim()) {
      credentials.push({ type: 'note', content: field(item.notes, 'string') })
    }
    const custom = customFieldsCredential(extra)
    if (custom) credentials.push(custom)
    return credentials
  } else if (item.type === 'passkey') {
    if (item.signCount !== 0) {
      warnings.push(
        `« ${item.title} » : passkey exclue du CXF (compteur de signature non nul).`,
      )
      return credentials
    }
    credentials.push({
      type: 'passkey',
      credentialId: item.credentialId,
      rpId: item.rpId,
      username: item.userName,
      userDisplayName: item.userName || item.rpId,
      userHandle: item.userHandle,
      key: base64ToBase64Url(item.privateKey),
    })
    if (item.notes.trim()) {
      credentials.push({ type: 'note', content: field(item.notes, 'string') })
    }
    const custom = customFieldsCredential(baseCustomFields(item))
    if (custom) credentials.push(custom)
    return credentials
  }

  if (item.notes.trim()) {
    credentials.push({ type: 'note', content: field(item.notes, 'string') })
  }
  const custom = customFieldsCredential(baseCustomFields(item))
  if (custom) credentials.push(custom)
  return credentials
}

/**
 * Construit un document CXF 1.0 à partir des éléments actifs. Les pièces
 * jointes ne sont pas incluses ; les passkeys à compteur non nul sont exclues.
 */
export function exportCxf(
  items: VaultItem[],
  options: {
    timestamp?: number
    exporterRpId?: string
    exporterDisplayName?: string
    email?: string
  } = {},
): CxfExportResult {
  const warnings: string[] = []
  let attachments = 0
  const active = items.filter((item) => !item.deletedAt)

  const cxfItems: CxfItem[] = []
  for (const item of active) {
    const credentials = credentialsFor(item, warnings)
    if (credentials.length === 0) continue
    attachments += item.attachments.length
    const createdAt = Date.parse(item.createdAt)
    const modifiedAt = Date.parse(item.updatedAt)
    const scope = scopeFor(item)
    cxfItems.push({
      id: cxfId(),
      ...(Number.isFinite(createdAt)
        ? { creationAt: Math.floor(createdAt / 1000) }
        : {}),
      ...(Number.isFinite(modifiedAt)
        ? { modifiedAt: Math.floor(modifiedAt / 1000) }
        : {}),
      title: item.title || 'Sans titre',
      ...(item.favorite ? { favorite: true } : {}),
      ...(scope ? { scope } : {}),
      credentials,
      ...(item.tags.length > 0 ? { tags: item.tags.slice(0, 30) } : {}),
      ...(item.type === 'software-license' ||
      item.type === 'document' ||
      item.type === 'recovery-codes'
        ? { extensions: [itemTypeExtension(item.type)] }
        : {}),
    })
  }

  if (attachments > 0) {
    warnings.push(
      `${attachments} pièce${attachments > 1 ? 's' : ''} jointe${
        attachments > 1 ? 's' : ''
      } non incluse${attachments > 1 ? 's' : ''} dans l’export CXF.`,
    )
  }
  if (cxfItems.length === 0) {
    warnings.push('Aucun élément exportable pour CXF.')
  }

  const document: CxfDocument = {
    version: { major: CXF_MAJOR, minor: CXF_MINOR },
    exporterRpId: options.exporterRpId ?? 'coffre.local',
    exporterDisplayName: options.exporterDisplayName ?? 'Coffre',
    timestamp: options.timestamp ?? Math.floor(Date.now() / 1000),
    accounts: [
      {
        id: cxfId(),
        username: '',
        email: options.email ?? '',
        collections: [],
        items: cxfItems,
      },
    ],
  }

  return { document, json: JSON.stringify(document, null, 2), warnings }
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function editableValue(value: unknown): string {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  return record ? asString(record.value) : ''
}

function credentialType(credential: Record<string, unknown>): string {
  return asString(credential.type)
}

function importFieldType(value: unknown): CustomField['type'] {
  switch (value) {
    case 'concealed-string':
      return 'hidden'
    case 'email':
      return 'email'
    case 'number':
      return 'number'
    case 'boolean':
      return 'checkbox'
    case 'date':
      return 'date'
    case 'year-month':
      return 'month'
    default:
      return 'text'
  }
}

function cxfItemTypeExtension(item: Record<string, unknown>): string {
  if (!Array.isArray(item.extensions)) return ''
  for (const entry of item.extensions) {
    const record = asRecord(entry)
    if (record && asString(record.name) === ITEM_TYPE_EXTENSION) {
      return asString(record.itemType)
    }
  }
  return ''
}

function documentKindFromValue(value: string): DocumentKind {
  return value === 'identity' ||
    value === 'contract' ||
    value === 'invoice' ||
    value === 'certificate' ||
    value === 'other'
    ? value
    : 'other'
}

function wifiSecurityFromCxf(value: string): 'WPA' | 'WEP' | 'nopass' {
  return CXF_TO_WIFI[value] ?? 'WPA'
}

/** Retire les champs déjà convertis en propriétés structurées. */
function withoutFields(fields: CustomField[], labels: string[]): CustomField[] {
  return fields.filter((entry) => !labels.includes(entry.label))
}

/** Relit le texte produit par `recoveryCodesExportText`. */
function recoveryCodesFromText(text: string): RecoveryCode[] {
  const codes: RecoveryCode[] = []
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim()
    if (!value) continue
    const match = /^(.*) \(utilisé le ([^)]+)\)$/.exec(value)
    codes.push({
      id: cxfId(),
      code: (match ? match[1] : value).slice(0, 500),
      usedAt: match ? match[2] : null,
    })
  }
  return codes
}

function customFieldsFromCxf(credential: Record<string, unknown>): CustomField[] {
  const raw = credential.fields
  if (!Array.isArray(raw)) return []
  const fields: CustomField[] = []
  for (const entry of raw.slice(0, 30)) {
    const record = asRecord(entry)
    if (!record) continue
    const value = asString(record.value)
    const label = asString(record.label)
    if (!value && !label) continue
    fields.push({
      id: cxfId(),
      label: label.slice(0, 80) || 'Champ',
      value: value.slice(0, 10_000),
      type: importFieldType(record.fieldType),
    })
  }
  return fields
}

function totpUriFromCxf(credential: Record<string, unknown>): string {
  const secret = asString(credential.secret).replace(/\s+/g, '').toUpperCase()
  if (!secret) return ''
  const issuer = asString(credential.issuer)
  const username = asString(credential.username)
  const label = [issuer, username].filter(Boolean).join(':') || 'TOTP'
  const algorithm = asString(credential.algorithm).toLowerCase()
  const params = new URLSearchParams({
    secret,
    digits: String(Number(credential.digits) || 6),
    period: String(Number(credential.period) || 30),
    algorithm:
      algorithm === 'sha256' ? 'SHA256' : algorithm === 'sha512' ? 'SHA512' : 'SHA1',
  })
  if (issuer) params.set('issuer', issuer)
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`
}

function collectionTitles(account: Record<string, unknown>): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const walk = (raw: unknown, parents: string[]) => {
    if (!Array.isArray(raw)) return
    for (const entry of raw) {
      const collection = asRecord(entry)
      if (!collection) continue
      const title = asString(collection.title).trim()
      const chain = title ? [...parents, title.slice(0, 40)] : parents
      const links = Array.isArray(collection.items) ? collection.items : []
      for (const link of links) {
        const record = asRecord(link)
        const id = record ? asString(record.item) : ''
        if (!id) continue
        const existing = map.get(id) ?? []
        map.set(id, Array.from(new Set([...existing, ...chain])).slice(0, 30))
      }
      walk(collection.subCollections, chain)
    }
  }
  walk(account.collections, [])
  return map
}

function cxfExpiry(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim())
  return match ? `${match[2]}/${match[1].slice(-2)}` : value.slice(0, 10)
}

/**
 * Lit un document CXF 1.x. Les passkeys sont converties en éléments
 * `passkey` ; la clé publique COSE est recalculée localement depuis PKCS#8.
 */
export async function parseCxf(text: string, vaultId: string): Promise<ParsedImport> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ImportError('Fichier CXF illisible (JSON invalide).')
  }
  const document = asRecord(raw)
  const version = asRecord(document?.version)
  if (!document || !version || !Array.isArray(document.accounts)) {
    throw new ImportError('Ce fichier n’est pas un document CXF.')
  }
  const major = Number(version.major)
  if (major !== CXF_MAJOR) {
    throw new ImportError(
      `Version CXF ${major || '?'} non prise en charge (CXF 1.x attendu).`,
    )
  }

  const warnings: string[] = []
  const items: ItemDraft[] = []
  const unsupported = new Set<string>()
  let skippedPasskeys = 0

  for (const rawAccount of document.accounts) {
    const account = asRecord(rawAccount)
    if (!account || !Array.isArray(account.items)) continue
    const tagsByItem = collectionTitles(account)

    for (const rawItem of account.items) {
      if (items.length >= 5_000) {
        warnings.push('Seuls les 5 000 premiers éléments ont été importés.')
        break
      }
      const item = asRecord(rawItem)
      if (!item) continue
      const title = asString(item.title).trim().slice(0, 200) || 'Sans titre'
      const credentials = Array.isArray(item.credentials)
        ? item.credentials
            .map(asRecord)
            .filter((entry): entry is Record<string, unknown> => entry !== null)
        : []
      const tags = Array.from(
        new Set([
          ...(Array.isArray(item.tags)
            ? item.tags.map((tag) => asString(tag).trim()).filter(Boolean)
            : []),
          ...(tagsByItem.get(asString(item.id)) ?? []),
        ]),
      )
        .map((tag) => tag.slice(0, 40))
        .slice(0, 30)
      const favorite = item.favorite === true
      const scope = asRecord(item.scope)
      const urls = Array.isArray(scope?.urls)
        ? scope.urls
            .map((url) => asString(url).trim())
            .filter(Boolean)
            .slice(0, 10)
        : []

      const note = credentials.find((entry) => credentialType(entry) === 'note')
      const custom = credentials.filter(
        (entry) => credentialType(entry) === 'custom-fields',
      )
      const basic = credentials.find(
        (entry) => credentialType(entry) === 'basic-auth',
      )
      const totp = credentials.find((entry) => credentialType(entry) === 'totp')
      const card = credentials.find(
        (entry) => credentialType(entry) === 'credit-card',
      )
      const address = credentials.find((entry) => credentialType(entry) === 'address')
      const person = credentials.find(
        (entry) => credentialType(entry) === 'person-name',
      )
      const passkeys = credentials.filter(
        (entry) => credentialType(entry) === 'passkey',
      )
      const wifi = credentials.find((entry) => credentialType(entry) === 'wifi')
      const apiKey = credentials.find((entry) => credentialType(entry) === 'api-key')
      const sshKey = credentials.find(
        (entry) => credentialType(entry) === 'ssh-key',
      )
      const passport = credentials.find(
        (entry) => credentialType(entry) === 'passport',
      )
      const driversLicense = credentials.find(
        (entry) => credentialType(entry) === 'drivers-license',
      )
      const identityDocument = credentials.find(
        (entry) => credentialType(entry) === 'identity-document',
      )
      const coffreType = cxfItemTypeExtension(item)
      for (const credential of credentials) {
        const type = credentialType(credential)
        if (
          type &&
          ![
            'basic-auth',
            'totp',
            'note',
            'custom-fields',
            'credit-card',
            'address',
            'person-name',
            'passkey',
            'wifi',
            'api-key',
            'ssh-key',
            'passport',
            'drivers-license',
            'identity-document',
          ].includes(type)
        ) {
          unsupported.add(type)
        }
      }

      const importedFields = custom
        .flatMap(customFieldsFromCxf)
        .slice(0, 30)
      const expiryField = fieldValue(importedFields, ['Échéance'])
      const common = {
        title,
        notes: note ? editableValue(note.content) : '',
        tags,
        favorite,
        customFields: withoutFields(importedFields, ['Échéance']),
        expiresAt: expiryField?.value ?? '',
      }

      let created = false

      if (basic || totp) {
        const draft = emptyDraft('login', vaultId)
        if (draft.type === 'login') {
          draft.title = common.title
          draft.notes = common.notes
          draft.tags = common.tags
          draft.favorite = common.favorite
          draft.customFields = common.customFields
          draft.expiresAt = common.expiresAt
          draft.username = basic ? editableValue(basic.username) : ''
          draft.password = basic ? editableValue(basic.password) : ''
          draft.urls = urls.length > 0 ? urls : ['']
          draft.totp = totp ? totpUriFromCxf(totp) : ''
        }
        items.push(draft)
        created = true
      }

      if (card) {
        const draft = emptyDraft('card', vaultId)
        if (draft.type === 'card') {
          draft.title = common.title
          draft.notes = common.notes
          draft.tags = common.tags
          draft.favorite = common.favorite
          draft.customFields = common.customFields
          draft.expiresAt = common.expiresAt
          draft.number = editableValue(card.number)
          draft.cardholder = editableValue(card.fullName)
          draft.brand = editableValue(card.cardType)
          draft.cvc = editableValue(card.verificationNumber)
          draft.pin = editableValue(card.pin)
          draft.expiry = cxfExpiry(editableValue(card.expiryDate))
        }
        items.push(draft)
        created = true
      }

      if (wifi) {
        const draft = emptyDraft('wifi', vaultId)
        if (draft.type === 'wifi') {
          draft.title = common.title
          draft.notes = common.notes
          draft.tags = common.tags
          draft.favorite = common.favorite
          draft.customFields = common.customFields
          draft.expiresAt = common.expiresAt
          draft.ssid = editableValue(wifi.ssid)
          draft.password = editableValue(wifi.passphrase)
          draft.security = wifiSecurityFromCxf(
            editableValue(wifi.networkSecurityType),
          )
          draft.hidden = editableValue(wifi.hidden) === 'true'
        }
        items.push(draft)
        created = true
      }

      if (apiKey) {
        const environment = fieldValue(common.customFields, ['Environnement'])
        const draft = emptyDraft('api-credential', vaultId)
        if (draft.type === 'api-credential') {
          draft.title = common.title
          draft.notes = common.notes
          draft.tags = common.tags
          draft.favorite = common.favorite
          draft.customFields = withoutFields(common.customFields, ['Environnement'])
          draft.expiresAt =
            editableValue(apiKey.expiryDate) || common.expiresAt
          draft.keyId = editableValue(apiKey.username)
          draft.secret = editableValue(apiKey.key)
          draft.environment = environment?.value ?? ''
          draft.endpoint = editableValue(apiKey.url)
        }
        items.push(draft)
        created = true
      }

      const sshFallback = sshKey
        ? undefined
        : fieldValue(common.customFields, ['Clé privée SSH'])
      if (sshKey || sshFallback) {
        const publicKey = fieldValue(common.customFields, ['Clé publique SSH'])
        const fingerprint = fieldValue(common.customFields, ['Empreinte SSH'])
        const comment = fieldValue(common.customFields, ['Commentaire SSH'])
        try {
          const privateKey = sshKey
            ? sshPrivateKeyPem(asString(sshKey.privateKey))
            : sshFallback?.value ?? ''
          if (!privateKey) throw new Error('clé absente')
          const draft = emptyDraft('ssh-key', vaultId)
          if (draft.type === 'ssh-key') {
            draft.title = common.title
            draft.notes = common.notes
            draft.tags = common.tags
            draft.favorite = common.favorite
            draft.customFields = withoutFields(common.customFields, [
              'Clé publique SSH',
              'Empreinte SSH',
              'Clé privée SSH',
              'Commentaire SSH',
            ])
            draft.expiresAt = common.expiresAt
            draft.privateKey = privateKey
            draft.publicKey = publicKey?.value ?? ''
            draft.fingerprint = fingerprint?.value ?? ''
            draft.comment = sshKey
              ? asString(sshKey.keyComment)
              : comment?.value ?? ''
          }
          items.push(draft)
          created = true
        } catch {
          warnings.push(`« ${title} » : clé SSH CXF invalide, ignorée.`)
        }
      }

      const specialCoffreType =
        coffreType === 'document' || coffreType === 'software-license'
      if (
        !specialCoffreType &&
        (address || person || passport || driversLicense || identityDocument)
      ) {
        const draft = emptyDraft('identity', vaultId)
        if (draft.type === 'identity') {
          draft.title = common.title
          draft.notes = common.notes
          draft.tags = common.tags
          draft.favorite = common.favorite
          draft.customFields = common.customFields
          draft.expiresAt = common.expiresAt
          draft.firstName = person ? editableValue(person.given) : ''
          draft.lastName = person ? editableValue(person.surname) : ''
          draft.address = address ? editableValue(address.streetAddress) : ''
          draft.postalCode = address ? editableValue(address.postalCode) : ''
          draft.city = address ? editableValue(address.city) : ''
          draft.country = address ? editableValue(address.country) : ''
          draft.phone = address ? editableValue(address.tel) : ''
          draft.passportExpiry = passport ? editableValue(passport.expiryDate) : ''
          draft.licenseExpiry = driversLicense
            ? editableValue(driversLicense.expiryDate)
            : ''
          draft.idCardExpiry = identityDocument
            ? editableValue(identityDocument.expiryDate)
            : ''
          const documentBirthDate = identityDocument
            ? editableValue(identityDocument.birthDate)
            : ''
          if (documentBirthDate) draft.birthDate = documentBirthDate
          for (const fieldEntry of common.customFields) {
            if (fieldEntry.label === 'E-mail' && !draft.email) draft.email = fieldEntry.value
            if (fieldEntry.label === 'Naissance' && !draft.birthDate) {
              draft.birthDate = fieldEntry.value
            }
          }
          const fullName = [passport, driversLicense, identityDocument]
            .map((credential) =>
              credential ? editableValue(credential.fullName) : '',
            )
            .find(Boolean)
          if (fullName && !draft.firstName && !draft.lastName) {
            draft.customFields = [
              ...draft.customFields,
              {
                id: cxfId(),
                label: 'Nom complet',
                value: fullName,
                type: 'text' as const,
              },
            ].slice(0, 30)
          }
        }
        items.push(draft)
        created = true
      }

      if (coffreType === 'software-license') {
        const licenseKey = fieldValue(common.customFields, ['Clé de licence'])
        const licensedTo = fieldValue(common.customFields, ['Titulaire'])
        const version = fieldValue(common.customFields, ['Version'])
        const website = fieldValue(common.customFields, ['Site web'])
        const purchaseDate = fieldValue(common.customFields, ['Date d’achat'])
        const draft = emptyDraft('software-license', vaultId)
        if (draft.type === 'software-license') {
          draft.title = common.title
          draft.notes = common.notes
          draft.tags = common.tags
          draft.favorite = common.favorite
          draft.customFields = withoutFields(common.customFields, [
            'Clé de licence',
            'Titulaire',
            'Version',
            'Site web',
            'Date d’achat',
          ])
          draft.expiresAt = common.expiresAt
          draft.licenseKey = licenseKey?.value ?? ''
          draft.licensedTo = licensedTo?.value ?? ''
          draft.version = version?.value ?? ''
          draft.website = website?.value ?? ''
          draft.purchaseDate = purchaseDate?.value ?? ''
        }
        items.push(draft)
        created = true
      }

      if (coffreType === 'recovery-codes') {
        const notes = credentials
          .filter((entry) => credentialType(entry) === 'note')
          .map((entry) => editableValue(entry.content))
        const draft = emptyDraft('recovery-codes', vaultId)
        if (draft.type === 'recovery-codes') {
          draft.title = common.title
          draft.notes = notes.slice(1).join('\n\n')
          draft.tags = common.tags
          draft.favorite = common.favorite
          draft.customFields = common.customFields
          draft.expiresAt = common.expiresAt
          draft.codes = recoveryCodesFromText(notes[0] ?? '')
        }
        items.push(draft)
        created = true
      }

      if (coffreType === 'document') {
        const kind = fieldValue(common.customFields, ['Type de document'])
        const issuer = fieldValue(common.customFields, ['Émetteur'])
        const documentNumber = fieldValue(common.customFields, [
          'Numéro du document',
        ])
        const issuedAt = fieldValue(common.customFields, ['Date d’émission'])
        const draft = emptyDraft('document', vaultId)
        if (draft.type === 'document') {
          draft.title = common.title
          draft.notes = common.notes
          draft.tags = common.tags
          draft.favorite = common.favorite
          draft.customFields = withoutFields(common.customFields, [
            'Type de document',
            'Émetteur',
            'Numéro du document',
            'Date d’émission',
          ])
          draft.documentKind = documentKindFromValue(
            kind?.value ?? (identityDocument ? 'identity' : 'other'),
          )
          draft.issuer =
            issuer?.value ??
            (identityDocument
              ? editableValue(identityDocument.issuingAuthority)
              : '')
          draft.documentNumber =
            documentNumber?.value ??
            (identityDocument
              ? editableValue(identityDocument.documentNumber)
              : '')
          draft.issuedAt =
            issuedAt?.value ??
            (identityDocument ? editableValue(identityDocument.issueDate) : '')
          draft.expiresAt =
            common.expiresAt ||
            (identityDocument
              ? editableValue(identityDocument.expiryDate)
              : '')
        }
        items.push(draft)
        created = true
      }

      if (!created && (note || custom.length > 0)) {
        const draft = emptyDraft('note', vaultId)
        draft.title = common.title
        draft.notes = common.notes
        draft.tags = common.tags
        draft.favorite = common.favorite
        draft.customFields = common.customFields
        draft.expiresAt = common.expiresAt
        items.push(draft)
        created = true
      }

      for (const passkey of passkeys) {
        const credentialId = asString(passkey.credentialId)
        const rpId = asString(passkey.rpId)
        const key = asString(passkey.key)
        if (!credentialId || !rpId || !key) {
          skippedPasskeys += 1
          continue
        }
        try {
          const privateKey = toBase64(fromBase64Url(key))
          const publicKeyCose = await publicKeyCoseFromPrivateKey(privateKey)
          const draft = emptyDraft('passkey', vaultId)
          if (draft.type === 'passkey') {
            draft.title = common.title
            draft.notes = common.notes
            draft.tags = common.tags
            draft.favorite = common.favorite
            draft.customFields = common.customFields
            draft.expiresAt = common.expiresAt
            draft.rpId = rpId
            draft.userName =
              asString(passkey.username) || asString(passkey.userName)
            draft.userHandle = asString(passkey.userHandle)
            draft.credentialId = credentialId
            draft.privateKey = privateKey
            draft.publicKeyCose = publicKeyCose
            draft.signCount = 0
          }
          items.push(draft)
          created = true
        } catch {
          skippedPasskeys += 1
        }
      }

      if (!created) {
        warnings.push(`« ${title} » : aucun justificatif CXF reconnu.`)
      }
    }
  }

  if (unsupported.size > 0) {
    warnings.push(
      `Types de justificatifs CXF ignorés : ${Array.from(unsupported)
        .slice(0, 8)
        .join(', ')}.`,
    )
  }
  if (skippedPasskeys > 0) {
    warnings.push(
      `${skippedPasskeys} passkey${skippedPasskeys > 1 ? 's' : ''} CXF non importée${
        skippedPasskeys > 1 ? 's' : ''
      } (clé ou identifiant invalide).`,
    )
  }
  if (items.length === 0) warnings.push('Aucun élément importable trouvé.')

  return { format: 'cxf', source: 'cxf', items, warnings }
}
