/**
 * Import depuis d’autres gestionnaires de mots de passe.
 *
 * Formats pris en charge :
 *  - exports JSON non chiffrés de Bitwarden, Proton Pass et Enpass ;
 *  - CSV de Bitwarden, 1Password, LastPass, Chrome/Edge/Brave, Firefox, Safari,
 *    Dashlane, KeePass/KeePassXC, NordPass, Keeper, RoboForm, SafeInCloud et
 *    Enpass, avec détection des colonnes courantes.
 *
 * Les données sont converties en brouillons d’éléments, puis chiffrées par le
 * coffre. Aucun fichier importé n’est conservé tel quel.
 */

import { randomId } from './crypto'
import { parseKeePassXml } from './kdbx'
import { normalizeTotpUri } from './totp'
import {
  emptyDraft,
  MAX_CUSTOM_FIELDS,
  type CustomField,
  type ItemDraft,
  type ItemType,
  type VaultItem,
} from './types'

export type ImportFormat =
  | 'bitwarden-json'
  | 'protonpass-json'
  | 'enpass-json'
  | 'dashlane-json'
  | 'cxf'
  | '1pux'
  | 'keepass-xml'
  | 'csv'

export type ImportSource =
  | 'bitwarden'
  | 'protonpass'
  | 'enpass'
  | '1password'
  | 'lastpass'
  | 'chromium'
  | 'firefox'
  | 'safari'
  | 'dashlane'
  | 'keepass'
  | 'nordpass'
  | 'keeper'
  | 'roboform'
  | 'safeincloud'
  | 'cxf'
  | 'generic'

const SOURCE_LABELS: Record<ImportSource, string> = {
  bitwarden: 'Bitwarden',
  protonpass: 'Proton Pass',
  enpass: 'Enpass',
  '1password': '1Password',
  lastpass: 'LastPass',
  chromium: 'Chrome / Edge / Brave',
  firefox: 'Firefox',
  safari: 'Safari',
  dashlane: 'Dashlane',
  keepass: 'KeePass / KeePassXC',
  nordpass: 'NordPass',
  keeper: 'Keeper',
  roboform: 'RoboForm',
  safeincloud: 'SafeInCloud',
  cxf: 'CXF (FIDO)',
  generic: 'CSV générique',
}

export function importSourceLabel(source: ImportSource): string {
  return SOURCE_LABELS[source]
}

export interface ParsedImport {
  format: ImportFormat
  source: ImportSource
  items: ItemDraft[]
  warnings: string[]
}

export const MAX_IMPORT_ITEMS = 5_000

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

interface CommonFields {
  title: string
  notes: string
  tags: string[]
  favorite: boolean
  customFields: CustomField[]
  expiresAt?: string
}

interface ExtraFields {
  username?: string
  password?: string
  urls?: string[]
  totp?: string
  cardholder?: string
  number?: string
  expiry?: string
  cvc?: string
  pin?: string
  brand?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  address?: string
  city?: string
  postalCode?: string
  country?: string
  birthDate?: string
  passportExpiry?: string
  idCardExpiry?: string
  licenseExpiry?: string
}

/* ------------------------------------------------------------------ */
/* Détection et point d’entrée                                         */
/* ------------------------------------------------------------------ */

interface DetectedImport {
  format: ImportFormat
  source: ImportSource
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function recordList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is Record<string, unknown> => asRecord(entry) !== null,
    )
  }
  const record = asRecord(value)
  if (!record) return []
  return Object.values(record).filter(
    (entry): entry is Record<string, unknown> => asRecord(entry) !== null,
  )
}

/** Racine d’un export Enpass : `{ items, folders }` ou `{ vault: { items, folders } }`. */
function enpassRoot(raw: unknown): Record<string, unknown> | null {
  const obj = asRecord(raw)
  if (!obj) return null
  const vault = asRecord(obj.vault)
  if (vault && ('items' in vault || 'folders' in vault)) return vault
  return obj
}

function isEnpassExport(raw: unknown): boolean {
  const root = enpassRoot(raw)
  if (!root) return false

  const items = recordList(root.items)
  if (items.length > 0) {
    const first = items[0]
    // Les éléments Bitwarden ont aussi un tableau `fields`, mais pas de
    // `category` textuelle ni de champs `label`.
    if (
      typeof first.category === 'string' &&
      (Array.isArray(first.fields) || Array.isArray(first.entries))
    ) {
      return true
    }
  }

  const folders = recordList(root.folders)
  return folders.some(
    (folder) =>
      typeof folder.uuid === 'string' && typeof folder.title === 'string',
  )
}

function detectImport(text: string): DetectedImport | null {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data: unknown = JSON.parse(trimmed)
      const obj = asRecord(data)
      if (obj && typeof obj.exporterRpId === 'string' && Array.isArray(obj.accounts)) {
        return { format: 'cxf', source: 'cxf' }
      }
      if (obj && 'vaults' in obj) {
        return { format: 'protonpass-json', source: 'protonpass' }
      }
      if (isEnpassExport(data)) {
        return { format: 'enpass-json', source: 'enpass' }
      }
      if (Array.isArray(obj?.AUTHENTIFIANT)) {
        return { format: 'dashlane-json', source: 'dashlane' }
      }
    } catch {
      // Le message précis est produit par parseImport.
    }
    return { format: 'bitwarden-json', source: 'bitwarden' }
  }

  if (trimmed.startsWith('<')) {
    if (/<KeePassFile[\s>]/.test(trimmed)) {
      return { format: 'keepass-xml', source: 'keepass' }
    }
    return null
  }

  const lines = trimmed.split(/\r?\n/, 3)
  const firstLine = lines[0] ?? ''
  const delimiterLine = /[,;\t]/.test(firstLine) ? firstLine : (lines[1] ?? '')
  return /[,;\t]/.test(delimiterLine) ? { format: 'csv', source: 'generic' } : null
}

export function detectImportFormat(text: string): ImportFormat | null {
  return detectImport(text)?.format ?? null
}

export function parseImport(text: string, vaultId: string): ParsedImport {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) throw new ImportError('Le fichier est vide')

  const detected = detectImport(trimmed)
  if (!detected) {
    throw new ImportError(
      'Format non reconnu. Utilisez un export JSON Bitwarden, Proton Pass ou Enpass, ou un fichier CSV.',
    )
  }

  if (detected.format === 'csv') {
    return parseCsv(trimmed, vaultId)
  }

  if (detected.format === 'cxf') {
    throw new ImportError(
      'Le format CXF contient des passkeys : utilisez l’import CXF dédié.',
    )
  }

  if (detected.format === 'keepass-xml') {
    try {
      const parsed = parseKeePassXml(trimmed, vaultId)
      return {
        format: 'keepass-xml',
        source: 'keepass',
        items: parsed.items,
        warnings: parsed.warnings,
      }
    } catch (caught) {
      throw new ImportError(
        caught instanceof Error ? caught.message : 'Export XML KeePass illisible',
      )
    }
  }

  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    throw new ImportError('Fichier JSON illisible')
  }

  if (detected.format === 'protonpass-json') {
    return parseProtonPassJson(data, vaultId)
  }
  if (detected.format === 'enpass-json') {
    return parseEnpassJson(data, vaultId)
  }
  if (detected.format === 'dashlane-json') {
    return parseDashlaneJson(data, vaultId)
  }
  return parseBitwardenJson(data, vaultId)
}

/* ------------------------------------------------------------------ */
/* Bitwarden JSON                                                      */
/* ------------------------------------------------------------------ */

interface BitwardenField {
  name?: unknown
  value?: unknown
  type?: unknown
}

interface BitwardenItem {
  type?: unknown
  name?: unknown
  notes?: unknown
  favorite?: unknown
  folderId?: unknown
  deletedDate?: unknown
  fields?: unknown
  login?: {
    username?: unknown
    password?: unknown
    totp?: unknown
    uris?: unknown
    uri?: unknown
  }
  card?: Record<string, unknown>
  identity?: Record<string, unknown>
}

interface BitwardenExport {
  encrypted?: unknown
  folders?: unknown
  items?: unknown
}

function asString(value: unknown, max = 100_000): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function bitwardenCustomFields(items: unknown): CustomField[] {
  if (!Array.isArray(items)) return []
  return items
    .map((raw): CustomField | null => {
      const field = raw as BitwardenField
      const label = asString(field.name, 80).trim()
      if (!label) return null
      return {
        id: randomId('f'),
        label,
        value: asString(field.value, 10_000),
        type: field.type === 1 ? 'hidden' : 'text',
      }
    })
    .filter((field): field is CustomField => Boolean(field))
    .slice(0, MAX_CUSTOM_FIELDS)
}

function bitwardenUrls(login: BitwardenItem['login']): string[] {
  if (!login) return []
  const raw = login.uris
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (entry && typeof entry === 'object' && 'uri' in entry) {
          return asString((entry as { uri?: unknown }).uri, 2_000)
        }
        return ''
      })
      .map((url) => url.trim())
      .filter(Boolean)
      .slice(0, 10)
  }
  const single = asString(login.uri, 2_000).trim()
  return single ? [single] : []
}

function parseBitwardenJson(raw: unknown, vaultId: string): ParsedImport {
  const data = raw as BitwardenExport
  if (!data || typeof data !== 'object') {
    throw new ImportError('Fichier JSON illisible')
  }

  if (data && typeof data === 'object' && 'format' in data && data.format === 'coffre') {
    throw new ImportError(
      'Ce fichier est un coffre Coffre. Utilisez « Importer un coffre » avec son mot de passe.',
    )
  }
  if (data?.encrypted === true) {
    throw new ImportError(
      'Les exports Bitwarden chiffrés ne sont pas pris en charge. Exportez d’abord en JSON non chiffré.',
    )
  }
  if (!Array.isArray(data?.items)) {
    throw new ImportError(
      'Ce JSON ne ressemble pas à un export Bitwarden (liste « items » absente).',
    )
  }

  const warnings: string[] = []
  const folderNames = new Map<string, string>()
  if (Array.isArray(data.folders)) {
    for (const raw of data.folders) {
      if (!raw || typeof raw !== 'object') continue
      const folder = raw as { id?: unknown; name?: unknown }
      if (typeof folder.id === 'string' && typeof folder.name === 'string') {
        folderNames.set(folder.id, folder.name)
      }
    }
  }

  const items: ItemDraft[] = []
  for (const raw of data.items.slice(0, MAX_IMPORT_ITEMS)) {
    const source = raw as BitwardenItem
    if (!source || typeof source !== 'object') continue
    if (asString(source.deletedDate).trim()) continue

    const type = bitwardenType(source.type)
    const folderId = asString(source.folderId)
    const folderName = folderId ? folderNames.get(folderId) : undefined
    const common: CommonFields = {
      title: asString(source.name, 200).trim() || 'Sans titre',
      notes: asString(source.notes),
      tags: folderName ? [folderName.slice(0, 40)] : [],
      favorite: source.favorite === true,
      customFields: bitwardenCustomFields(source.fields),
    }

    const login = source.login
    const card = source.card ?? {}
    const identity = source.identity ?? {}
    const extras: ExtraFields = {
      username: login ? asString(login.username, 500) : '',
      password: login ? asString(login.password, 2_000) : '',
      urls: bitwardenUrls(login),
      totp: login ? asString(login.totp, 4_096) : '',
      cardholder: asString(card.cardholderName, 200),
      number: asString(card.number, 40),
      expiry: bitwardenExpiry(card),
      cvc: asString(card.code, 8),
      pin: '',
      brand: asString(card.brand, 40),
      firstName: asString(identity.firstName, 200),
      lastName: asString(identity.lastName, 200),
      email: asString(identity.email, 500),
      phone: asString(identity.phone, 100),
      address: asString(identity.address1, 500),
      city: asString(identity.city, 200),
      postalCode: asString(identity.postalCode, 40),
      country: asString(identity.country, 200),
      birthDate: asString(identity.birthDate, 40),
    }

    items.push(makeDraft(type, vaultId, common, extras))
  }

  if (data.items.length > MAX_IMPORT_ITEMS) {
    warnings.push(
      `Seuls les ${MAX_IMPORT_ITEMS} premiers éléments ont été importés.`,
    )
  }
  if (items.length === 0) warnings.push('Aucun élément importable trouvé.')

  return { format: 'bitwarden-json', source: 'bitwarden', items, warnings }
}

function bitwardenType(value: unknown): ItemType {
  switch (Number(value)) {
    case 2:
      return 'note'
    case 3:
      return 'card'
    case 4:
      return 'identity'
    case 1:
    default:
      return 'login'
  }
}

function bitwardenExpiry(card: Record<string, unknown>): string {
  const month = asString(card.expMonth, 10).trim()
  const year = asString(card.expYear, 10).trim()
  if (!month && !year) return ''
  return `${month}/${year.slice(-2)}`
}

function makeDraft(
  type: ItemType,
  vaultId: string,
  common: CommonFields,
  extras: ExtraFields,
): ItemDraft {
  const draft = {
    ...emptyDraft(type, vaultId),
    ...common,
  } as ItemDraft

  switch (type) {
    case 'login':
      return {
        ...draft,
        type: 'login',
        username: extras.username ?? '',
        password: extras.password ?? '',
        urls: extras.urls?.length ? extras.urls : [''],
        totp: extras.totp ?? '',
      }
    case 'card':
      return {
        ...draft,
        type: 'card',
        cardholder: extras.cardholder ?? '',
        number: extras.number ?? '',
        expiry: extras.expiry ?? '',
        cvc: extras.cvc ?? '',
        pin: extras.pin ?? '',
        brand: extras.brand ?? '',
      }
    case 'identity':
      return {
        ...draft,
        type: 'identity',
        firstName: extras.firstName ?? '',
        lastName: extras.lastName ?? '',
        email: extras.email ?? '',
        phone: extras.phone ?? '',
        address: extras.address ?? '',
        city: extras.city ?? '',
        postalCode: extras.postalCode ?? '',
        country: extras.country ?? '',
        birthDate: extras.birthDate ?? '',
        passportExpiry: extras.passportExpiry ?? '',
        idCardExpiry: extras.idCardExpiry ?? '',
        licenseExpiry: extras.licenseExpiry ?? '',
      }
    case 'note':
      return { ...draft, type: 'note' }
    case 'passkey':
      return {
        ...emptyDraft('passkey', vaultId),
        ...common,
        type: 'passkey',
      } as ItemDraft
    case 'ssh-key':
      return {
        ...emptyDraft('ssh-key', vaultId),
        ...common,
        type: 'ssh-key',
        privateKey: '',
        publicKey: '',
        fingerprint: '',
        comment: '',
      } as ItemDraft
    case 'wifi':
      return {
        ...emptyDraft('wifi', vaultId),
        ...common,
        type: 'wifi',
        ssid: '',
        password: '',
        security: 'WPA',
        hidden: false,
      } as ItemDraft
  }
}

/* ------------------------------------------------------------------ */
/* Proton Pass JSON                                                    */
/* ------------------------------------------------------------------ */

interface ProtonPassVault {
  name?: unknown
  items?: unknown
}

interface ProtonPassExtraField {
  fieldName?: unknown
  type?: unknown
  data?: unknown
}

interface ProtonPassItemData {
  metadata?: {
    name?: unknown
    note?: unknown
    pinned?: unknown
  }
  extraFields?: unknown
  type?: unknown
  content?: Record<string, unknown>
}

interface ProtonPassItem {
  state?: unknown
  aliasEmail?: unknown
  data?: ProtonPassItemData
}

function protonPassVaults(raw: unknown): ProtonPassVault[] | null {
  if (Array.isArray(raw)) {
    return raw.filter(
      (vault): vault is ProtonPassVault =>
        Boolean(vault) && typeof vault === 'object',
    )
  }
  if (raw && typeof raw === 'object') {
    return Object.values(raw).filter(
      (vault): vault is ProtonPassVault =>
        Boolean(vault) && typeof vault === 'object',
    )
  }
  return null
}

function protonPassCustomFields(raw: unknown): CustomField[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry): CustomField | null => {
      const field = entry as ProtonPassExtraField
      if (!field || typeof field !== 'object') return null
      const label = asString(field.fieldName, 80).trim()
      if (!label) return null
      const data = field.data
      const value =
        typeof data === 'string'
          ? data
          : data && typeof data === 'object' && 'content' in data
            ? asString((data as { content?: unknown }).content, 10_000)
            : ''
      return {
        id: randomId('f'),
        label,
        value,
        type: field.type === 'hidden' || field.type === 'totp' ? 'hidden' : 'text',
      }
    })
    .filter((field): field is CustomField => Boolean(field))
    .slice(0, MAX_CUSTOM_FIELDS)
}

function protonPassUrls(content: Record<string, unknown>): string[] {
  if (!Array.isArray(content.urls)) return []
  return content.urls
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry && typeof entry === 'object' && 'url' in entry) {
        return asString((entry as { url?: unknown }).url, 2_000)
      }
      return ''
    })
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 10)
}

function protonPassExpiry(value: unknown): string {
  const raw = asString(value, 40).trim()
  const iso = /^(\d{4})-(\d{1,2})$/.exec(raw)
  if (iso) return `${iso[2].padStart(2, '0')}/${iso[1].slice(-2)}`
  const slash = /^(\d{1,2})\/(\d{2,4})$/.exec(raw)
  if (slash) {
    return `${slash[1].padStart(2, '0')}/${slash[2].slice(-2)}`
  }
  return raw
}

function protonPassType(
  value: unknown,
  content: Record<string, unknown>,
): { type: ItemType; warning?: string } {
  switch (asString(value, 40)) {
    case 'login':
      return { type: 'login' }
    case 'note':
      return { type: 'note' }
    case 'creditCard':
      return { type: 'card' }
    case 'identity':
      return { type: 'identity' }
    case 'alias':
      return { type: 'login' }
    case 'sshKey':
      return {
        type: 'note',
        warning: 'Les clés SSH sont importées comme notes.',
      }
    case 'wifi':
      return {
        type: 'note',
        warning: 'Les réseaux Wi-Fi sont importés comme notes.',
      }
    case 'custom':
      return {
        type: 'note',
        warning: 'Les éléments personnalisés sont importés comme notes.',
      }
    default:
      if (
        asString(content.username) ||
        asString(content.password) ||
        protonPassUrls(content).length > 0
      ) {
        return { type: 'login' }
      }
      if (asString(content.number)) return { type: 'card' }
      if (asString(content.fullName) || asString(content.email)) {
        return { type: 'identity' }
      }
      return { type: 'note' }
  }
}

function protonPassIdentityFields(
  content: Record<string, unknown>,
): CustomField[] {
  const fields: Array<[string, unknown]> = [
    ['Organisation', content.organization],
    ['Fonction', content.jobTitle],
    ['Région / État', content.state],
    ['Site web', content.website],
    ['Compte X', content.xHandle],
    ['Téléphone secondaire', content.secondPhoneNumber],
    ['Société', content.company],
    ['Numéro de TVA', content.vatNumber],
    ['Sécurité sociale', content.socialSecurityNumber],
    ['Passeport', content.passportNumber],
    ['Permis de conduire', content.licenseNumber],
  ]
  return fields
    .map(([label, raw]): CustomField | null => {
      const value = asString(raw, 10_000).trim()
      if (!value) return null
      return {
        id: randomId('f'),
        label,
        value,
        type: /sécurité|passeport|permis/i.test(label) ? 'hidden' : 'text',
      }
    })
    .filter((field): field is CustomField => Boolean(field))
    .slice(0, MAX_CUSTOM_FIELDS)
}

function protonPassNoteContent(
  type: string,
  content: Record<string, unknown>,
): string {
  const lines: string[] = []
  const add = (label: string, value: unknown) => {
    const text = asString(value, 10_000).trim()
    if (text) lines.push(`${label} : ${text}`)
  }

  if (type === 'sshKey') {
    add('Clé publique', content.publicKey)
    add('Clé privée', content.privateKey)
  } else if (type === 'wifi') {
    add('SSID', content.ssid)
    add('Mot de passe', content.password)
    add('Sécurité', content.security)
  } else {
    for (const [key, value] of Object.entries(content)) {
      if (typeof value === 'string' && value.trim()) {
        add(key, value)
      }
    }
  }
  return lines.join('\n')
}

function parseProtonPassJson(raw: unknown, vaultId: string): ParsedImport {
  const data = raw as { encrypted?: unknown; vaults?: unknown }
  if (!data || typeof data !== 'object') {
    throw new ImportError('Fichier JSON illisible')
  }
  if (data.encrypted === true) {
    throw new ImportError(
      'Les exports Proton Pass chiffrés ne sont pas pris en charge. Exportez d’abord en JSON non chiffré.',
    )
  }

  const vaults = protonPassVaults(data.vaults)
  if (!vaults) {
    throw new ImportError(
      'Ce JSON ne ressemble pas à un export Proton Pass (liste « vaults » absente).',
    )
  }

  const warnings: string[] = []
  const warnedTypes = new Set<string>()
  const items: ItemDraft[] = []
  let skippedTrashed = 0
  let skippedPasskeys = 0
  let truncated = false

  for (const vault of vaults) {
    const vaultName = asString(vault.name, 40).trim()
    const rawItems = Array.isArray(vault.items) ? vault.items : []

    for (const entry of rawItems) {
      if (items.length >= MAX_IMPORT_ITEMS) {
        truncated = true
        break
      }

      const source = entry as ProtonPassItem
      if (!source || typeof source !== 'object') continue
      if (Number(source.state) === 2) {
        skippedTrashed += 1
        continue
      }

      const itemData = source.data
      if (!itemData || typeof itemData !== 'object') continue
      const content =
        itemData.content && typeof itemData.content === 'object'
          ? itemData.content
          : {}
      const metadata = itemData.metadata ?? {}
      const rawType = asString(itemData.type, 40)
      const mapped = protonPassType(rawType, content)

      if (mapped.warning && !warnedTypes.has(rawType)) {
        warnedTypes.add(rawType)
        warnings.push(mapped.warning)
      }
      if (Array.isArray(content.passkeys) && content.passkeys.length > 0) {
        skippedPasskeys += content.passkeys.length
      }

      const title =
        asString(metadata.name, 200).trim() ||
        asString(source.aliasEmail, 200).trim() ||
        'Sans titre'
      const notes = [asString(metadata.note)]
      if (rawType === 'alias') {
        const alias = asString(source.aliasEmail, 500).trim()
        if (alias) notes.push(`Alias Proton : ${alias}`)
      }
      if (mapped.type === 'note' && rawType !== 'note') {
        notes.push(protonPassNoteContent(rawType, content))
      }

      const common: CommonFields = {
        title,
        notes: notes.filter(Boolean).join('\n\n'),
        tags: vaultName ? [vaultName] : [],
        favorite: metadata.pinned === true,
        customFields: protonPassCustomFields(itemData.extraFields),
      }

      let extras: ExtraFields = {}
      if (mapped.type === 'login') {
        const alias = asString(source.aliasEmail, 500).trim()
        extras = {
          username:
            asString(content.username, 500).trim() || (rawType === 'alias' ? alias : ''),
          password: asString(content.password, 2_000),
          urls: protonPassUrls(content),
          totp: asString(content.totpUri, 4_096),
        }
      } else if (mapped.type === 'card') {
        extras = {
          cardholder: asString(content.cardholderName, 200),
          number: asString(content.number, 40),
          expiry: protonPassExpiry(content.expirationDate),
          cvc: asString(content.securityCode, 8),
          pin: asString(content.pin, 12),
          brand: asString(content.cardType, 40),
        }
      } else if (mapped.type === 'identity') {
        const fullName = asString(content.fullName, 400).trim()
        const parts = fullName.split(/\s+/).filter(Boolean)
        common.customFields = [
          ...common.customFields,
          ...protonPassIdentityFields(content),
        ].slice(0, MAX_CUSTOM_FIELDS)
        extras = {
          firstName: asString(content.firstName, 200) || parts[0] || '',
          lastName:
            asString(content.lastName, 200) || parts.slice(1).join(' ') || '',
          email: asString(content.email, 500),
          phone: asString(content.phoneNumber, 100),
          address: asString(content.streetAddress, 500),
          city: asString(content.city, 200),
          postalCode: asString(content.zipCode, 40),
          country: asString(content.country, 200),
          birthDate: asString(content.birthdate, 40),
        }
      }

      items.push(makeDraft(mapped.type, vaultId, common, extras))
    }
    if (truncated) break
  }

  if (truncated) {
    warnings.push(
      `Seuls les ${MAX_IMPORT_ITEMS} premiers éléments ont été importés.`,
    )
  }
  if (skippedTrashed > 0) {
    warnings.push(
      `${skippedTrashed} élément${skippedTrashed > 1 ? 's' : ''} en corbeille ignoré${
        skippedTrashed > 1 ? 's' : ''
      }.`,
    )
  }
  if (skippedPasskeys > 0) {
    warnings.push(
      `${skippedPasskeys} passkey${skippedPasskeys > 1 ? 's' : ''} ignorée${
        skippedPasskeys > 1 ? 's' : ''
      } (non prises en charge).`,
    )
  }
  if (items.length === 0) warnings.push('Aucun élément importable trouvé.')

  return { format: 'protonpass-json', source: 'protonpass', items, warnings }
}

/* ------------------------------------------------------------------ */
/* Enpass JSON                                                         */
/* ------------------------------------------------------------------ */

interface EnpassField {
  label?: unknown
  type?: unknown
  value?: unknown
  sensitive?: unknown
}

function enpassFields(raw: unknown): EnpassField[] {
  return Array.isArray(raw)
    ? raw.filter(
        (entry): entry is EnpassField =>
          Boolean(entry) && typeof entry === 'object',
      )
    : []
}

/** Les champs Enpass peuvent être à la racine ou dans des sections `entries`. */
function enpassItemFields(item: Record<string, unknown>): EnpassField[] {
  const fields = [...enpassFields(item.fields)]
  for (const section of recordList(item.entries)) {
    fields.push(...enpassFields(section.fields))
  }
  return fields
}

function enpassFolderPaths(root: Record<string, unknown>): Map<string, string> {
  const folders = new Map<string, { title: string; parent: string }>()
  for (const folder of recordList(root.folders)) {
    const uuid = asString(folder.uuid, 100).trim()
    const title = asString(folder.title, 100).trim()
    if (!uuid || !title) continue
    folders.set(uuid, {
      title,
      parent: asString(folder.parent_uuid, 100).trim(),
    })
  }

  const paths = new Map<string, string>()
  const resolve = (uuid: string, seen: Set<string>): string => {
    const cached = paths.get(uuid)
    if (cached) return cached
    const folder = folders.get(uuid)
    if (!folder) return ''
    if (seen.has(uuid)) return folder.title
    seen.add(uuid)
    const parent =
      folder.parent && folder.parent !== uuid
        ? resolve(folder.parent, seen)
        : ''
    const path = parent ? `${parent} / ${folder.title}` : folder.title
    paths.set(uuid, path)
    return path
  }
  for (const uuid of folders.keys()) resolve(uuid, new Set())
  return paths
}

const ENPASS_CARD_NUMBER =
  /\b(card ?number|cardnumber|credit card number|cc number|numero de carte)\b/
const ENPASS_CARDHOLDER =
  /\b(card ?holder|cardholder|cardholder name|name on card|titulaire)\b/
const ENPASS_EXPIRY = /\b(expir\w*|exp ?date|expiration\w*)\b/
const ENPASS_CVC = /\b(cvc|cvv|cvv2|csc|security ?code|card code)\b/
const ENPASS_PIN = /\b(pin|card pin)\b/
const ENPASS_BRAND = /\b(brand|card ?type|card ?network)\b/
const ENPASS_FULL_NAME = /\b(full ?name|fullname|nom complet)\b/
const ENPASS_FIRST_NAME = /\b(first ?name|firstname|given ?name|prenom)\b/
const ENPASS_LAST_NAME =
  /\b(last ?name|lastname|surname|family ?name|nom de famille|nom)\b/
const ENPASS_EMAIL = /\b(email|e mail|email address|courriel)\b/
const ENPASS_PHONE = /\b(phone|phone ?number|telephone|tel|mobile)\b/
const ENPASS_ADDRESS =
  /\b(address|address ?1|street|street ?address|adresse)\b/
const ENPASS_CITY = /\b(city|town|ville)\b/
const ENPASS_POSTAL =
  /\b(zip|zip ?code|postal ?code|postcode|code postal)\b/
const ENPASS_COUNTRY = /\b(country|pays)\b/
const ENPASS_BIRTH = /\b(birth ?date|birthday|date of birth|dob|date de naissance)\b/
const ENPASS_USERNAME =
  /\b(username|user ?name|login|login ?name|identifiant|userid|user id)\b/
const ENPASS_PASSWORD = /\b(password|passwd|pass|mot de passe)\b/
const ENPASS_URL = /\b(url|website|web site|uri|link)\b/
const ENPASS_TOTP = /\b(totp|otp|otpauth|one time password|two factor|2fa)\b/

function enpassType(category: string, fields: EnpassField[]): ItemType {
  const normalized = normalizeHeader(category)
  if (/credit ?card|cartes? bancaire|payment card/.test(normalized)) {
    return 'card'
  }
  if (/identity|identite|personal info/.test(normalized)) return 'identity'
  if (/note|secure note/.test(normalized)) return 'note'
  if (/login|password|connexion|credential|website/.test(normalized)) {
    return 'login'
  }

  const combined = fields
    .map((field) =>
      normalizeHeader(
        `${asString(field.type, 60)} ${asString(field.label, 60)}`,
      ),
    )
    .join(' ')
  return /\b(username|user name|password|url|website|totp|otp)\b/.test(combined)
    ? 'login'
    : 'note'
}

function pushEnpassCustom(
  fields: CustomField[],
  label: string,
  value: string,
  sensitive: boolean,
): void {
  if (!value || fields.length >= MAX_CUSTOM_FIELDS) return
  const base = label.trim().slice(0, 80) || 'Champ'
  let unique = base
  let index = 2
  while (fields.some((field) => field.label === unique)) {
    unique = `${base} (${index})`.slice(0, 80)
    index += 1
  }
  fields.push({
    id: randomId('f'),
    label: unique,
    value: value.slice(0, 10_000),
    type: sensitive ? 'hidden' : 'text',
  })
}

function parseEnpassJson(raw: unknown, vaultId: string): ParsedImport {
  const root = enpassRoot(raw)
  if (!root) throw new ImportError('Fichier JSON illisible')
  if (!('items' in root)) {
    throw new ImportError(
      'Ce JSON ne ressemble pas à un export Enpass (liste « items » absente).',
    )
  }

  const folderPaths = enpassFolderPaths(root)
  const rawItems = recordList(root.items)
  const warnings: string[] = []
  const items: ItemDraft[] = []
  const unsupportedCategories = new Set<string>()
  let skippedTrashed = 0
  let skippedAttachments = 0
  let truncated = false

  for (const source of rawItems) {
    if (items.length >= MAX_IMPORT_ITEMS) {
      truncated = true
      break
    }
    if (
      source.trashed === true ||
      Number(source.trashed) === 1 ||
      source.deleted === true
    ) {
      skippedTrashed += 1
      continue
    }

    const category = asString(source.category, 60).trim()
    const fields = enpassItemFields(source)
    const type = enpassType(category, fields)
    if (
      type === 'note' &&
      category &&
      !/note|secure note/.test(normalizeHeader(category))
    ) {
      unsupportedCategories.add(category)
    }

    const subtitle = asString(source.subtitle, 500).trim()
    let title = asString(source.title, 200).trim() || subtitle
    if (!title) title = 'Sans titre'

    const folderIds = Array.isArray(source.folders)
      ? source.folders
          .map((entry) => asString(entry, 100).trim())
          .filter(Boolean)
      : []
    const tags = Array.from(
      new Set(
        folderIds
          .map((uuid) => folderPaths.get(uuid) ?? '')
          .filter(Boolean)
          .map((tag) => tag.slice(0, 40)),
      ),
    ).slice(0, 30)

    const customFields: CustomField[] = []
    const extras: ExtraFields = {}
    let username = ''
    let password = ''
    let totp = ''
    const urls: string[] = []

    for (const field of fields) {
      const value = asString(field.value, 10_000).trim()
      if (!value) continue
      const kind = normalizeHeader(
        `${asString(field.type, 60)} ${asString(field.label, 60)}`,
      )
      const sensitive = Number(field.sensitive) > 0
      const label =
        asString(field.label, 80).trim() ||
        asString(field.type, 80).trim() ||
        'Champ'

      if (type === 'card') {
        if (ENPASS_CARD_NUMBER.test(kind) && !extras.number) {
          extras.number = value
        } else if (ENPASS_CARDHOLDER.test(kind) && !extras.cardholder) {
          extras.cardholder = value
        } else if (ENPASS_EXPIRY.test(kind) && !extras.expiry) {
          extras.expiry = value
        } else if (ENPASS_CVC.test(kind) && !extras.cvc) {
          extras.cvc = value
        } else if (ENPASS_PIN.test(kind) && !extras.pin) {
          extras.pin = value
        } else if (ENPASS_BRAND.test(kind) && !extras.brand) {
          extras.brand = value
        } else {
          pushEnpassCustom(customFields, label, value, sensitive)
        }
        continue
      }

      if (type === 'identity') {
        if (ENPASS_FULL_NAME.test(kind) && !extras.firstName && !extras.lastName) {
          const parts = value.split(/\s+/).filter(Boolean)
          extras.firstName = parts[0] ?? ''
          extras.lastName = parts.slice(1).join(' ')
        } else if (ENPASS_FIRST_NAME.test(kind) && !extras.firstName) {
          extras.firstName = value
        } else if (ENPASS_LAST_NAME.test(kind) && !extras.lastName) {
          extras.lastName = value
        } else if (ENPASS_EMAIL.test(kind) && !extras.email) {
          extras.email = value
        } else if (ENPASS_PHONE.test(kind) && !extras.phone) {
          extras.phone = value
        } else if (ENPASS_ADDRESS.test(kind) && !extras.address) {
          extras.address = value
        } else if (ENPASS_CITY.test(kind) && !extras.city) {
          extras.city = value
        } else if (ENPASS_POSTAL.test(kind) && !extras.postalCode) {
          extras.postalCode = value
        } else if (ENPASS_COUNTRY.test(kind) && !extras.country) {
          extras.country = value
        } else if (ENPASS_BIRTH.test(kind) && !extras.birthDate) {
          extras.birthDate = value
        } else {
          pushEnpassCustom(customFields, label, value, sensitive)
        }
        continue
      }

      if (type === 'login') {
        if (ENPASS_PASSWORD.test(kind)) {
          if (!password) password = value
          else pushEnpassCustom(customFields, label, value, true)
        } else if (ENPASS_USERNAME.test(kind)) {
          if (!username) username = value
          else pushEnpassCustom(customFields, label, value, sensitive)
        } else if (ENPASS_EMAIL.test(kind)) {
          if (!username) username = value
          else pushEnpassCustom(customFields, label, value, sensitive)
        } else if (ENPASS_URL.test(kind)) {
          if (urls.length < 10) urls.push(value)
        } else if (ENPASS_TOTP.test(kind)) {
          if (!totp) totp = normalizeTotpUri(value, title)
          else pushEnpassCustom(customFields, label, value, true)
        } else {
          pushEnpassCustom(customFields, label, value, sensitive)
        }
        continue
      }

      pushEnpassCustom(customFields, label, value, sensitive)
    }

    if (type === 'login' && !username && subtitle) {
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(subtitle)) {
        username = subtitle.slice(0, 500)
      }
    }
    if (type === 'login') {
      extras.username = username
      extras.password = password
      extras.urls = urls
      extras.totp = totp
    }

    const attachments = Array.isArray(source.attachments)
      ? source.attachments.length
      : 0
    skippedAttachments += attachments

    const common: CommonFields = {
      title,
      notes: asString(source.note),
      tags,
      favorite: source.favorite === true || Number(source.favorite) === 1,
      customFields,
    }
    items.push(makeDraft(type, vaultId, common, extras))
  }

  if (truncated) {
    warnings.push(
      `Seuls les ${MAX_IMPORT_ITEMS} premiers éléments ont été importés.`,
    )
  }
  if (skippedTrashed > 0) {
    warnings.push(
      `${skippedTrashed} élément${skippedTrashed > 1 ? 's' : ''} en corbeille ignoré${
        skippedTrashed > 1 ? 's' : ''
      }.`,
    )
  }
  if (skippedAttachments > 0) {
    warnings.push(
      `${skippedAttachments} pièce${skippedAttachments > 1 ? 's' : ''} jointe${
        skippedAttachments > 1 ? 's' : ''
      } Enpass non importée${skippedAttachments > 1 ? 's' : ''}.`,
    )
  }
  if (unsupportedCategories.size > 0) {
    const labels = Array.from(unsupportedCategories).slice(0, 5).join(', ')
    warnings.push(
      `Catégories Enpass non prises en charge (${labels}) importées comme notes.`,
    )
  }
  if (items.length === 0) warnings.push('Aucun élément importable trouvé.')

  return { format: 'enpass-json', source: 'enpass', items, warnings }
}

/* ------------------------------------------------------------------ */
/* Dashlane JSON                                                       */
/* ------------------------------------------------------------------ */

const DASHLANE_KEYS = new Set([
  'title',
  'domain',
  'login',
  'password',
  'note',
  'email',
  'secondaryLogin',
])

function parseDashlaneJson(raw: unknown, vaultId: string): ParsedImport {
  const root = asRecord(raw)
  if (!root) throw new ImportError('Fichier JSON illisible')
  if (!Array.isArray(root.AUTHENTIFIANT)) {
    throw new ImportError(
      'Ce JSON ne ressemble pas à un export Dashlane (liste « AUTHENTIFIANT » absente).',
    )
  }

  const warnings: string[] = []
  const items: ItemDraft[] = []
  const ignoredFields = new Set<string>()
  let skippedEmpty = 0
  let secondaryLogins = 0

  for (const source of recordList(root.AUTHENTIFIANT).slice(0, MAX_IMPORT_ITEMS)) {
    for (const [key, value] of Object.entries(source)) {
      if (!DASHLANE_KEYS.has(key) && asString(value).trim()) {
        ignoredFields.add(key.slice(0, 60))
      }
    }

    const title = asString(source.title, 200).trim()
    const username =
      asString(source.login, 500).trim() || asString(source.email, 500).trim()
    const password = asString(source.password, 2_000)
    const url = asString(source.domain, 2_000).trim()
    const note = asString(source.note)
    const secondary = asString(source.secondaryLogin, 500).trim()
    if (secondary) secondaryLogins += 1

    if (!title && !username && !password && !url && !note) {
      skippedEmpty += 1
      continue
    }

    const customFields: CustomField[] = secondary
      ? [
          {
            id: randomId('f'),
            label: 'Identifiant secondaire',
            value: secondary,
            type: 'text',
          },
        ]
      : []

    items.push(
      makeDraft(
        'login',
        vaultId,
        {
          title: title || titleFromUrl(url) || 'Sans titre',
          notes: note,
          tags: [],
          favorite: false,
          customFields,
        },
        { username, password, urls: url ? [url] : [] },
      ),
    )
  }

  if (recordList(root.AUTHENTIFIANT).length > MAX_IMPORT_ITEMS) {
    warnings.push(
      `Seuls les ${MAX_IMPORT_ITEMS} premiers éléments ont été importés.`,
    )
  }
  if (skippedEmpty > 0) {
    warnings.push(
      `${skippedEmpty} entrée${skippedEmpty > 1 ? 's' : ''} vide${
        skippedEmpty > 1 ? 's' : ''
      } Dashlane ignorée${skippedEmpty > 1 ? 's' : ''}.`,
    )
  }
  if (secondaryLogins > 0) {
    warnings.push(
      `${secondaryLogins} identifiant${secondaryLogins > 1 ? 's' : ''} secondaire${
        secondaryLogins > 1 ? 's' : ''
      } conservé${secondaryLogins > 1 ? 's' : ''} en champ personnalisé.`,
    )
  }
  if (ignoredFields.size > 0) {
    warnings.push(
      `Champs Dashlane ignorés : ${Array.from(ignoredFields).slice(0, 8).join(', ')}.`,
    )
  }
  if (items.length === 0) warnings.push('Aucun élément importable trouvé.')

  return { format: 'dashlane-json', source: 'dashlane', items, warnings }
}

/* ------------------------------------------------------------------ */
/* Déduplication                                                       */
/* ------------------------------------------------------------------ */

type FingerprintItem = ItemDraft | VaultItem

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeUrl(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`.toLowerCase()
  } catch {
    return normalizeText(raw)
  }
}

function firstUrl(item: ItemDraft | VaultItem): string {
  return item.type === 'login'
    ? normalizeUrl(item.urls.find((entry) => entry.trim()) ?? '')
    : ''
}

/** Clé de rapprochement, sans l’URL pour tolérer les entrées incomplètes. */
function fingerprintKey(item: FingerprintItem): string {
  const title = normalizeText(item.title)
  switch (item.type) {
    case 'login':
      return `login|${title}|${normalizeText(item.username)}`
    case 'card':
      return `card|${title}|${item.number.replace(/\s+/g, '').slice(-4)}`
    case 'identity':
      return `identity|${title}|${normalizeText(item.email)}`
    case 'note':
      return `note|${title}|${normalizeText(item.notes).slice(0, 200)}`
    case 'passkey':
      return `passkey|${title}|${normalizeText(item.rpId)}|${normalizeText(item.userName)}`
    case 'ssh-key':
      return `ssh-key|${title}|${normalizeText(item.fingerprint)}`
    case 'wifi':
      return `wifi|${title}|${normalizeText(item.ssid)}`
  }
}

function sameImportItem(a: FingerprintItem, b: FingerprintItem): boolean {
  if (a.type !== b.type) return false
  if (fingerprintKey(a) !== fingerprintKey(b)) return false
  if (a.type === 'login' && b.type === 'login') {
    const urlA = firstUrl(a)
    const urlB = firstUrl(b)
    // Une URL absente ne doit pas empêcher de reconnaître un doublon.
    return !urlA || !urlB || urlA === urlB
  }
  return true
}

/**
 * Sépare les brouillons déjà présents dans le coffre (ou répétés dans le
 * fichier) des nouveaux éléments. Les éléments en corbeille sont ignorés.
 */
export function dedupeImport(
  drafts: ItemDraft[],
  existing: FingerprintItem[],
): { items: ItemDraft[]; duplicates: ItemDraft[] } {
  const buckets = new Map<string, FingerprintItem[]>()
  for (const item of existing) {
    if (item.deletedAt) continue
    const key = fingerprintKey(item)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }

  const items: ItemDraft[] = []
  const duplicates: ItemDraft[] = []

  for (const draft of drafts) {
    const key = fingerprintKey(draft)
    const bucket = buckets.get(key)
    if (bucket?.some((candidate) => sameImportItem(draft, candidate))) {
      duplicates.push(draft)
      continue
    }
    if (bucket) bucket.push(draft)
    else buckets.set(key, [draft])
    items.push(draft)
  }

  return { items, duplicates }
}

/* ------------------------------------------------------------------ */
/* CSV générique                                                       */
/* ------------------------------------------------------------------ */

type Row = string[]

function detectDelimiter(line: string): string {
  const counts: Array<[string, number]> = [
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (!quoted) {
      const entry = counts.find(([delimiter]) => delimiter === char)
      if (entry) entry[1] += 1
    }
  }
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

function parseRows(text: string, delimiter: string): Row[] {
  const rows: Row[] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
      continue
    }

    if (char === delimiter) {
      row.push(field)
      field = ''
      continue
    }

    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
      continue
    }

    field += char
  }

  row.push(field)
  if (row.some((cell) => cell.trim() !== '')) rows.push(row)
  return rows
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Reconnaît les dialectes CSV courants à partir de leurs en-têtes. Sert
 * uniquement à afficher la provenance ; le mapping reste générique.
 */
function detectCsvSource(headers: string[]): ImportSource {
  const set = new Set(headers)
  const has = (...names: string[]) =>
    names.every((name) => set.has(normalizeHeader(name)))

  if (has('login_username') || has('login_password') || has('login_uri')) {
    return 'bitwarden'
  }
  if (has('httprealm') || has('formactionorigin')) return 'firefox'
  if (has('otpsecret') || has('username2')) return 'dashlane'
  if (has('grouping') && has('extra')) return 'lastpass'
  if (has('cardholdername') && (has('expirydate') || has('cardnumber'))) {
    return 'nordpass'
  }
  if (has('otpauth') && (has('favorite') || has('archived') || has('tags'))) {
    return '1password'
  }
  if (has('otpauth')) return 'safari'
  if (has('account') && has('login name')) return 'keepass'
  if (has('group') && has('title') && has('totp')) return 'keepass'
  if (has('login') && has('website')) return 'keeper'
  if (has('name') && has('url') && has('login') && has('pwd')) return 'roboform'
  if (has('name') && has('url') && has('username') && has('password')) {
    return has('note') ? 'chromium' : 'roboform'
  }
  if (has('title') && has('login') && has('password') && has('url')) {
    return 'safeincloud'
  }
  return 'generic'
}

/** Utilise le domaine comme titre quand l’export n’en fournit pas. */
function titleFromUrl(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const HEADER_ALIASES: Record<string, string[]> = {
  title: ['name', 'title', 'account', 'item name', 'item', 'entry', 'record', 'website name'],
  url: [
    'url',
    'urls',
    'website',
    'web site',
    'web address',
    'site',
    'login uri',
    'login url',
    'login website',
    'uri',
    'site url',
    'link',
  ],
  username: [
    'username',
    'user',
    'user name',
    'login username',
    'login name',
    'login',
    'login id',
    'userid',
    'user id',
    'email',
    'email address',
    'e mail',
    'identifiant',
  ],
  password: ['password', 'pass', 'passwd', 'pwd', 'login password', 'mot de passe'],
  notes: [
    'notes',
    'note',
    'extra',
    'comments',
    'comment',
    'description',
    'memo',
    'remarque',
  ],
  totp: [
    'totp',
    'otpauth',
    'otp',
    'one time password',
    'login totp',
    'otp secret',
    'otpsecret',
    'totp secret',
    'otpauth url',
    'otp auth',
    'two factor',
    '2fa',
    'authenticator key',
  ],
  favorite: ['favorite', 'favourite', 'fav', 'starred', 'pinned'],
  type: ['type', 'category', 'item type', 'kind'],
  folder: ['folder', 'folder name', 'grouping', 'group', 'group name', 'collection', 'vault', 'category name', 'path'],
  tags: ['tags', 'tag', 'labels'],
  customFields: ['coffre custom fields'],
  fullName: ['full name', 'fullname', 'nom complet'],
  cardholder: [
    'cardholder',
    'cardholder name',
    'cardholdername',
    'card holder',
    'card holder name',
    'name on card',
    'titulaire',
    'titulaire de la carte',
  ],
  number: [
    'card number',
    'cardnumber',
    'card no',
    'cc number',
    'credit card number',
    'numero de carte',
  ],
  expiry: [
    'expiry',
    'expirydate',
    'expiry date',
    'expiration',
    'expirationdate',
    'expiration date',
    'exp date',
    'expires',
    'exp month',
    'date d expiration',
  ],
  cvc: ['cvc', 'cvv', 'cvv2', 'security code', 'securitycode', 'csc', 'card code'],
  pin: ['pin', 'card pin', 'code pin'],
  brand: ['brand', 'card type', 'cardtype', 'card network', 'network'],
  firstName: ['first name', 'firstname', 'given name', 'givenname', 'prenom'],
  lastName: ['last name', 'lastname', 'surname', 'family name', 'familyname', 'nom de famille'],
  email: ['email', 'email address', 'emailaddress', 'e mail', 'courriel', 'mail'],
  phone: ['phone', 'phone number', 'phonenumber', 'telephone', 'tel', 'mobile', 'mobile phone'],
  address: ['address', 'address1', 'address 1', 'street', 'street address', 'adresse', 'adresse 1'],
  city: ['city', 'ville', 'town'],
  postalCode: ['postal code', 'postalcode', 'zip', 'zip code', 'zipcode', 'postcode', 'code postal'],
  country: ['country', 'pays'],
  birthDate: ['birthdate', 'birthday', 'date of birth', 'dob', 'date de naissance'],
  expiresAt: [
    'expires at',
    'expiresat',
    'echeance',
    'date d echeance',
    'rappel d echeance',
    'review at',
    'review date',
  ],
  passportExpiry: [
    'passport expiry',
    'passport expiration',
    'passportexpiry',
    'expiration passeport',
    'expiration du passeport',
  ],
  idCardExpiry: [
    'id card expiry',
    'identity card expiry',
    'idcardexpiry',
    'expiration carte identite',
    'expiration de la carte d identite',
  ],
  licenseExpiry: [
    'license expiry',
    'licence expiry',
    'licenseexpiry',
    'expiration permis',
    'expiration du permis de conduire',
  ],
}

const KNOWN_HEADERS = new Set(
  Object.values(HEADER_ALIASES).flat().map(normalizeHeader),
)

const METADATA_HEADERS = new Set(
  [
    'id',
    'uuid',
    'guid',
    'created',
    'created at',
    'createdate',
    'modified',
    'modified at',
    'updated',
    'updated at',
    'last modified',
    'revision',
    'archived',
    'deleted',
    'deleted at',
    'reprompt',
    'http realm',
    'form action origin',
    'time created',
    'time last used',
    'time password changed',
  ].map(normalizeHeader),
)

function findHeader(headers: string[], key: keyof typeof HEADER_ALIASES): number {
  const aliases = HEADER_ALIASES[key]
  for (const alias of aliases) {
    const index = headers.indexOf(normalizeHeader(alias))
    if (index >= 0) return index
  }
  return -1
}

function pick(row: Row, headers: string[], key: keyof typeof HEADER_ALIASES): string {
  const index = findHeader(headers, key)
  return index >= 0 ? (row[index] ?? '').trim() : ''
}

function parseFavorite(value: string): boolean {
  return /^(1|true|yes|y|oui|on|fav|favorite)$/i.test(value.trim())
}

function parseCsvType(
  value: string,
  row: Row,
  headers: string[],
): ItemType {
  const type = normalizeHeader(value)
  if (type) {
    if (/card|credit|debit|carte/.test(type)) return 'card'
    if (/identity|identite|personal info|contact/.test(type)) return 'identity'
    if (/note|secure note/.test(type)) return 'note'
    if (/login|password|connexion|credential/.test(type)) return 'login'
    if (type === '1') return 'login'
    if (type === '2') return 'note'
    if (type === '3') return 'card'
    if (type === '4') return 'identity'
  }

  if (pick(row, headers, 'number')) return 'card'
  if (
    pick(row, headers, 'firstName') ||
    pick(row, headers, 'lastName') ||
    pick(row, headers, 'fullName') ||
    pick(row, headers, 'address')
  ) {
    return 'identity'
  }
  if (
    pick(row, headers, 'username') ||
    pick(row, headers, 'password') ||
    pick(row, headers, 'url') ||
    pick(row, headers, 'totp')
  ) {
    return 'login'
  }
  return 'note'
}

function splitTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[;,]/)
        .map((tag) => tag.trim().slice(0, 40))
        .filter(Boolean),
    ),
  ).slice(0, 30)
}

function splitUrls(value: string): string[] {
  return value
    .split(/[\r\n]+/)
    .map((url) => url.trim().slice(0, 2_000))
    .filter(Boolean)
    .slice(0, 10)
}

function customFieldsFromRow(
  row: Row,
  headers: string[],
  originalHeaders: string[],
  skipHeaders?: Set<string>,
): CustomField[] {
  const fields: CustomField[] = []
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index]
    const value = (row[index] ?? '').trim()
    if (!header || !value) continue
    if (
      KNOWN_HEADERS.has(header) ||
      METADATA_HEADERS.has(header) ||
      skipHeaders?.has(header)
    ) {
      continue
    }
    if (fields.length >= MAX_CUSTOM_FIELDS) break

    const type = /password|secret|token|key|pin|api/.test(header)
      ? 'hidden'
      : /url|website|link/.test(header)
        ? 'url'
        : 'text'
    fields.push({
      id: randomId('f'),
      label: (originalHeaders[index] ?? header).slice(0, 80),
      value: value.slice(0, 10_000),
      type,
    })
  }
  return fields
}

/**
 * Relit la colonne « fields » des exports CSV Bitwarden, au format
 * `nom: valeur` séparé par des retours à la ligne.
 */
function parseBitwardenCsvFields(value: string): CustomField[] {
  const fields: CustomField[] = []
  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const label = line.slice(0, separator).trim().slice(0, 80)
    const fieldValue = line.slice(separator + 1).trim().slice(0, 10_000)
    if (!label || !fieldValue) continue
    fields.push({
      id: randomId('f'),
      label,
      value: fieldValue,
      type: /pass|pin|secret|token|key|api/i.test(label) ? 'hidden' : 'text',
    })
    if (fields.length >= MAX_CUSTOM_FIELDS) break
  }
  return fields
}

/**
 * Relit la colonne JSON produite par l’export CSV complet de Coffre. Les
 * fichiers d’autres gestionnaires ne sont pas concernés : leur éventuelle
 * colonne « custom fields » reste traitée comme un champ inconnu.
 */
function parseCoffreCustomFields(value: string): CustomField[] {
  const raw = value.trim()
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const fields: CustomField[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label.slice(0, 80) : ''
    const fieldValue =
      typeof record.value === 'string' ? record.value.slice(0, 10_000) : ''
    if (!label && !fieldValue) continue
    const type =
      record.type === 'hidden' || record.type === 'url' || record.type === 'multiline'
        ? record.type
        : 'text'
    fields.push({
      id: randomId('f'),
      label: label || 'Champ',
      value: fieldValue,
      type,
    })
    if (fields.length >= MAX_CUSTOM_FIELDS) break
  }
  return fields
}

function cell(row: Row, headers: string[], name: string): string {
  const index = headers.indexOf(normalizeHeader(name))
  return index >= 0 ? (row[index] ?? '').trim() : ''
}

function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return (
    /^(https?:\/\/|www\.)/i.test(trimmed) ||
    /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)
  )
}

/**
 * Certains exports (Dashlane, Keeper) n’ont pas de ligne d’en-tête. On les
 * reconnaît à leur forme : cinq colonnes avec une URL en deuxième position
 * (Dashlane), ou sept colonnes avec une URL en cinquième position (Keeper).
 */
function headerlessCsvColumns(
  rows: Row[],
): { labels: string[]; source: ImportSource } | null {
  for (const row of rows.slice(0, 20)) {
    if (row.length === 5 && looksLikeUrl(row[1]) && (row[2].trim() || row[3].trim())) {
      return {
        labels: ['title', 'url', 'username', 'password', 'notes'],
        source: 'dashlane',
      }
    }
    if (
      row.length === 7 &&
      looksLikeUrl(row[4]) &&
      row[1].trim() &&
      (row[2].trim() || row[3].trim())
    ) {
      return {
        labels: ['folder', 'title', 'username', 'password', 'url', 'notes', ''],
        source: 'keeper',
      }
    }
  }
  return null
}

function parseCsv(text: string, vaultId: string): ParsedImport {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = detectDelimiter(firstLine)
  const rows = parseRows(text, delimiter)
  if (rows.length < 2) {
    throw new ImportError('Le fichier CSV ne contient aucune ligne de données')
  }

  let originalHeaders = rows[0].map((header) => header.trim())
  let headers = originalHeaders.map(normalizeHeader)
  let source = detectCsvSource(headers)
  let dataRows = rows.slice(1)
  let headerless = false

  const recognized = [
    'title',
    'username',
    'password',
    'url',
    'notes',
    'totp',
  ].some((key) => findHeader(headers, key as keyof typeof HEADER_ALIASES) >= 0)

  if (!recognized) {
    const columns = headerlessCsvColumns(rows)
    if (columns) {
      headerless = true
      originalHeaders = columns.labels
      headers = columns.labels.map(normalizeHeader)
      dataRows = rows
      source = columns.source
    }
  }

  const warnings: string[] = []
  const items: ItemDraft[] = []

  const ignoredColumns = originalHeaders.filter((_header, index) => {
    const normalized = headers[index]
    if (!METADATA_HEADERS.has(normalized) || normalized === 'archived') return false
    return dataRows
      .slice(0, MAX_IMPORT_ITEMS + 1)
      .some((row) => (row[index] ?? '').trim())
  })
  if (ignoredColumns.length > 0) {
    warnings.push(
      `Colonnes ignorées : ${ignoredColumns.slice(0, 8).join(', ')}.`,
    )
  }

  if (!recognized && !headerless) {
    warnings.push(
      'Les en-têtes CSV sont inhabituels ; les colonnes non reconnues deviendront des champs personnalisés.',
    )
  }

  for (const row of dataRows.slice(0, MAX_IMPORT_ITEMS + 1)) {
    const urls = splitUrls(pick(row, headers, 'url'))
    const title = (
      pick(row, headers, 'title') ||
      titleFromUrl(urls[0] ?? '') ||
      'Sans titre'
    ).slice(0, 200)
    const type = parseCsvType(pick(row, headers, 'type'), row, headers)
    const tags = splitTags(
      [pick(row, headers, 'folder'), pick(row, headers, 'tags')]
        .filter(Boolean)
        .join(';'),
    )
    if (parseFavorite(cell(row, headers, 'archived')) && tags.length < 30) {
      if (!tags.includes('Archivé')) tags.push('Archivé')
    }

    const fullName = pick(row, headers, 'fullName').slice(0, 400)
    const nameParts = fullName.split(/\s+/).filter(Boolean)

    const common: CommonFields = {
      title,
      notes: pick(row, headers, 'notes').slice(0, 100_000),
      tags,
      favorite: parseFavorite(pick(row, headers, 'favorite')),
      customFields: [
        ...customFieldsFromRow(
          row,
          headers,
          originalHeaders,
          source === 'bitwarden' ? new Set(['fields']) : undefined,
        ),
        ...(source === 'bitwarden'
          ? parseBitwardenCsvFields(cell(row, headers, 'fields'))
          : []),
        ...parseCoffreCustomFields(pick(row, headers, 'customFields')),
      ].slice(0, MAX_CUSTOM_FIELDS),
      expiresAt: pick(row, headers, 'expiresAt').slice(0, 40),
    }

    const expMonth = pick(row, headers, 'expiry')
    const extras: ExtraFields = {
      username: pick(row, headers, 'username').slice(0, 500),
      password: pick(row, headers, 'password').slice(0, 2_000),
      urls,
      totp: normalizeTotpUri(pick(row, headers, 'totp'), title).slice(0, 4_096),
      cardholder: pick(row, headers, 'cardholder').slice(0, 200),
      number: pick(row, headers, 'number').slice(0, 40),
      expiry: expMonth.slice(0, 10),
      cvc: pick(row, headers, 'cvc').slice(0, 8),
      pin: pick(row, headers, 'pin').slice(0, 12),
      brand: pick(row, headers, 'brand').slice(0, 40),
      firstName:
        pick(row, headers, 'firstName').slice(0, 200) || nameParts[0] || '',
      lastName:
        pick(row, headers, 'lastName').slice(0, 200) ||
        nameParts.slice(1).join(' '),
      email: pick(row, headers, 'email').slice(0, 500),
      phone: pick(row, headers, 'phone').slice(0, 100),
      address: pick(row, headers, 'address').slice(0, 500),
      city: pick(row, headers, 'city').slice(0, 200),
      postalCode: pick(row, headers, 'postalCode').slice(0, 40),
      country: pick(row, headers, 'country').slice(0, 200),
      birthDate: pick(row, headers, 'birthDate').slice(0, 40),
      passportExpiry: pick(row, headers, 'passportExpiry').slice(0, 40),
      idCardExpiry: pick(row, headers, 'idCardExpiry').slice(0, 40),
      licenseExpiry: pick(row, headers, 'licenseExpiry').slice(0, 40),
    }

    items.push(makeDraft(type, vaultId, common, extras))
  }

  if (dataRows.length > MAX_IMPORT_ITEMS) {
    warnings.push(
      `Seuls les ${MAX_IMPORT_ITEMS} premiers éléments ont été importés.`,
    )
  }
  if (items.length === 0) warnings.push('Aucun élément importable trouvé.')

  return { format: 'csv', source, items, warnings }
}
