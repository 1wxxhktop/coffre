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
import { emptyDraft, type CustomField, type ItemDraft, type VaultItem } from './types'

const CXF_MAJOR = 1
const CXF_MINOR = 0

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

export interface CxfItem {
  id: string
  creationAt?: number
  modifiedAt?: number
  title: string
  subtitle?: string
  favorite?: boolean
  scope?: { urls: string[]; androidApps?: unknown[] }
  credentials: CxfCredential[]
  tags?: string[]
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
    const extra = baseCustomFields(item)
    if (item.email) extra.push(field(item.email, 'email', 'E-mail'))
    if (item.birthDate) extra.push(field(item.birthDate, 'date', 'Naissance'))
    if (item.passportExpiry) {
      extra.push(field(item.passportExpiry, 'date', 'Expiration passeport'))
    }
    if (item.idCardExpiry) {
      extra.push(field(item.idCardExpiry, 'date', "Expiration carte d’identité"))
    }
    if (item.licenseExpiry) {
      extra.push(field(item.licenseExpiry, 'date', 'Expiration permis'))
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
    const urls = scopeUrls(item)
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
      ...(urls.length > 0 ? { scope: { urls } } : {}),
      credentials,
      ...(item.tags.length > 0 ? { tags: item.tags.slice(0, 30) } : {}),
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
          ].includes(type)
        ) {
          unsupported.add(type)
        }
      }

      const common = {
        title,
        notes: note ? editableValue(note.content) : '',
        tags,
        favorite,
        customFields: custom.flatMap(customFieldsFromCxf).slice(0, 30),
        expiresAt: '',
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

      if (address || person) {
        const draft = emptyDraft('identity', vaultId)
        if (draft.type === 'identity') {
          draft.title = common.title
          draft.notes = common.notes
          draft.tags = common.tags
          draft.favorite = common.favorite
          draft.customFields = common.customFields
          draft.firstName = person ? editableValue(person.given) : ''
          draft.lastName = person ? editableValue(person.surname) : ''
          draft.address = address ? editableValue(address.streetAddress) : ''
          draft.postalCode = address ? editableValue(address.postalCode) : ''
          draft.city = address ? editableValue(address.city) : ''
          draft.country = address ? editableValue(address.country) : ''
          draft.phone = address ? editableValue(address.tel) : ''
          for (const fieldEntry of common.customFields) {
            if (fieldEntry.label === 'E-mail' && !draft.email) draft.email = fieldEntry.value
            if (fieldEntry.label === 'Naissance' && !draft.birthDate) {
              draft.birthDate = fieldEntry.value
            }
          }
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
