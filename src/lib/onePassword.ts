/**
 * Import 1Password `.1pux`.
 *
 * Le fichier est une archive ZIP non chiffrée contenant `export.attributes` et
 * `export.data`. Il est lu entièrement en mémoire ; les pièces jointes ne sont
 * pas extraites. Aucun fichier n’est conservé après l’import.
 */

import { randomId } from './crypto'
import { unzipSync } from 'fflate'
import { ImportError, MAX_IMPORT_ITEMS, type ParsedImport } from './import'
import { normalizeTotpUri } from './totp'
import {
  emptyDraft,
  MAX_CUSTOM_FIELDS,
  type CustomField,
  type CustomFieldType,
  type ItemDraft,
  type ItemType,
} from './types'

const MAX_1PUX_ENTRY_BYTES = 100 * 1024 * 1024
const MAX_1PUX_TOTAL_BYTES = 128 * 1024 * 1024

type JsonObject = Record<string, unknown>

interface P1uxField {
  title?: unknown
  value?: unknown
  multiline?: unknown
  inputTraits?: unknown
}

interface P1uxItem {
  categoryUuid?: unknown
  favIndex?: unknown
  state?: unknown
  overview?: unknown
  details?: unknown
}

interface P1uxVault {
  attrs?: unknown
  items?: unknown
}

interface P1uxAccount {
  vaults?: unknown
}

const LOGIN = '001'
const CARD = '002'
const NOTE = '003'
const IDENTITY = '004'

function record(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' ? (value as JsonObject) : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function normalize(value: unknown): string {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function scalar(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (!value || typeof value !== 'object') return ''

  const object = value as JsonObject
  for (const key of [
    'concealed',
    'string',
    'url',
    'email',
    'phone',
    'creditCardNumber',
    'date',
    'monthYear',
    'menu',
    'reference',
    'number',
    'value',
  ]) {
    const entry = object[key]
    if (typeof entry === 'string' || typeof entry === 'number') return String(entry)
  }
  return ''
}

function fieldType(field: P1uxField): CustomFieldType {
  const title = normalize(field.title)
  const value = record(field.value)
  if (field.multiline === true) return 'multiline'
  if ('concealed' in value || /password|secret|token|pin|cle|key/.test(title)) {
    return 'hidden'
  }
  if ('url' in value || /url|website|site/.test(title)) return 'url'
  return 'text'
}

function allFields(details: JsonObject): P1uxField[] {
  const fields: P1uxField[] = []
  for (const section of array(details.sections)) {
    for (const entry of array(record(section).fields)) {
      fields.push(record(entry) as P1uxField)
    }
  }
  return fields
}

function findField(
  fields: P1uxField[],
  pattern: RegExp,
  used: Set<number>,
): { index: number; value: string } | null {
  for (let index = 0; index < fields.length; index += 1) {
    if (used.has(index)) continue
    const title = normalize(fields[index].title)
    if (pattern.test(title)) {
      const value = scalar(fields[index].value).trim()
      if (value) return { index, value }
    }
  }
  return null
}

function urlsFromOverview(overview: JsonObject): string[] {
  const values = [text(overview.url), ...array(overview.urls).map((entry) => text(record(entry).url))]
  return Array.from(
    new Set(
      values
        .map((value) => value.trim().slice(0, 2_000))
        .filter(Boolean),
    ),
  ).slice(0, 10)
}

function tagsFromOverview(overview: JsonObject, vaultName: string, archived: boolean): string[] {
  const tags = array(overview.tags)
    .map((tag) => text(tag).trim().slice(0, 40))
    .filter(Boolean)
  if (vaultName) tags.push(vaultName.slice(0, 40))
  if (archived) tags.push('Archivé')
  return Array.from(new Set(tags)).slice(0, 30)
}

function customFields(
  fields: P1uxField[],
  used: Set<number>,
): CustomField[] {
  const result: CustomField[] = []
  for (let index = 0; index < fields.length; index += 1) {
    if (used.has(index)) continue
    const field = fields[index]
    const value = scalar(field.value).trim()
    if (!value) continue
    const label = text(field.title).trim() || 'Champ'
    result.push({
      id: randomId('f'),
      label: label.slice(0, 80),
      value: value.slice(0, 10_000),
      type: fieldType(field),
    })
    if (result.length >= MAX_CUSTOM_FIELDS) break
  }
  return result
}

function convertItem(
  raw: unknown,
  vaultId: string,
  vaultName: string,
): { draft: ItemDraft | null; attachments: number; passwordHistory: number } {
  const item = record(raw) as P1uxItem
  const category = text(item.categoryUuid)
  const type: ItemType =
    category === LOGIN
      ? 'login'
      : category === CARD
        ? 'card'
        : category === IDENTITY
          ? 'identity'
          : 'note'
  const overview = record(item.overview)
  const details = record(item.details)
  const state = normalize(item.state)
  if (state === 'deleted' || state === 'trashed') {
    return { draft: null, attachments: 0, passwordHistory: 0 }
  }

  const draft = emptyDraft(type, vaultId)
  draft.title = (text(overview.title).trim() || 'Sans titre').slice(0, 200)
  draft.notes = text(details.notesPlain).slice(0, 100_000)
  draft.favorite = Number(item.favIndex) > 0
  draft.tags = tagsFromOverview(overview, vaultName, state === 'archived')

  const fields = allFields(details)
  const used = new Set<number>()

  let attachments = 0
  if (details.documentAttributes) attachments += 1
  if (array(details.files).length > 0) attachments += array(details.files).length
  const passwordHistory = array(details.passwordHistory).length

  if (draft.type === 'login') {
    draft.urls = urlsFromOverview(overview)
    for (const entry of array(details.loginFields)) {
      const field = record(entry)
      const value = scalar(field.value)
      const designation = normalize(field.designation)
      const name = normalize(field.name)
      if (
        designation === 'username' ||
        (!draft.username && /username|email|login|user/.test(name))
      ) {
        draft.username = value.slice(0, 500)
      } else if (
        designation === 'password' ||
        (!draft.password && /password|pass/.test(name))
      ) {
        draft.password = value.slice(0, 2_000)
      }
    }
    const otp = findField(fields, /\b(one time password|otp|totp|2fa)\b/, used)
    if (otp) {
      draft.totp = normalizeTotpUri(otp.value, draft.title).slice(0, 4_096)
      used.add(otp.index)
    }
    if (draft.urls.length === 0) draft.urls = ['']
  }

  if (draft.type === 'card') {
    const mappings: Array<[keyof typeof draft, RegExp]> = [
      ['cvc', /\b(verification number|cvv|cvc|security code)\b/],
      ['number', /\b(card number|number|credit card number)\b/],
      ['expiry', /\b(expiry|expiration|expires|exp date)\b/],
      ['cardholder', /\b(cardholder|card holder|name on card|titulaire)\b/],
      ['pin', /^pin$/],
      ['brand', /\b(type|brand|card type|card network)\b/],
    ]
    for (const [key, pattern] of mappings) {
      const found = findField(fields, pattern, used)
      if (!found) continue
      draft[key] = found.value.slice(0, key === 'number' ? 40 : 200) as never
      used.add(found.index)
    }
  }

  if (draft.type === 'identity') {
    const mappings: Array<[keyof typeof draft, RegExp]> = [
      ['firstName', /\b(first name|given name|prenom)\b/],
      ['lastName', /\b(last name|surname|family name|nom de famille)\b/],
      ['email', /\b(email|e mail|courriel)\b/],
      ['phone', /\b(phone|telephone|tel|mobile)\b/],
      ['address', /\b(address|street|adresse)\b/],
      ['city', /\b(city|ville)\b/],
      ['postalCode', /\b(postal code|zip|postcode|code postal)\b/],
      ['country', /\b(country|pays)\b/],
      ['birthDate', /\b(birth date|birthday|date of birth|date de naissance)\b/],
    ]
    for (const [key, pattern] of mappings) {
      const found = findField(fields, pattern, used)
      if (!found) continue
      draft[key] = found.value.slice(0, 500) as never
      used.add(found.index)
    }
  }

  if (type === 'note' && category !== NOTE) {
    draft.notes = [draft.notes, ...fields.map((field) => `${text(field.title) || 'Champ'} : ${scalar(field.value)}`)]
      .filter(Boolean)
      .join('\n')
      .slice(0, 100_000)
  } else {
    draft.customFields = customFields(fields, used)
  }

  return { draft, attachments, passwordHistory }
}

/**
 * Décode une archive 1PUX et convertit ses éléments en brouillons Coffre.
 * L’import est plafonné à `MAX_IMPORT_ITEMS` éléments et ignore les pièces
 * jointes binaires.
 */
export async function parse1pux(
  bytes: Uint8Array,
  vaultId: string,
): Promise<ParsedImport> {
  let entries: Record<string, Uint8Array>
  let totalBytes = 0
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.name !== 'export.attributes' && file.name !== 'export.data') {
          return false
        }
        if (file.originalSize > MAX_1PUX_ENTRY_BYTES) {
          throw new ImportError('Entrée .1pux trop volumineuse')
        }
        totalBytes += file.originalSize
        if (totalBytes > MAX_1PUX_TOTAL_BYTES) {
          throw new ImportError('Archive .1pux décompressée trop volumineuse')
        }
        return true
      },
    })
  } catch (error) {
    if (error instanceof ImportError) throw error
    throw new ImportError('Ce fichier .1pux n’est pas une archive ZIP valide')
  }

  const decoder = new TextDecoder()
  let attributes: JsonObject = {}
  if (entries['export.attributes']) {
    try {
      attributes = record(JSON.parse(decoder.decode(entries['export.attributes'])))
    } catch {
      throw new ImportError('Les métadonnées .1pux sont illisibles')
    }
    const version = Number(attributes.version)
    if (Number.isFinite(version) && version > 3) {
      throw new ImportError(
        `Version 1PUX ${version} non prise en charge (version 3 maximum)`,
      )
    }
  }

  if (!entries['export.data']) {
    throw new ImportError('Archive .1pux incomplète : export.data est absent')
  }

  let data: JsonObject
  try {
    data = record(JSON.parse(decoder.decode(entries['export.data'])))
  } catch {
    throw new ImportError('Le fichier export.data est illisible')
  }

  const items: ItemDraft[] = []
  const warnings: string[] = []
  let skipped = 0
  let attachments = 0
  let passwordHistory = 0
  let truncated = false

  for (const accountEntry of array(data.accounts)) {
    const account = record(accountEntry) as P1uxAccount
    for (const vaultEntry of array(account.vaults)) {
      const vault = record(vaultEntry) as P1uxVault
      const vaultAttrs = record(vault.attrs)
      const vaultName = text(vaultAttrs.name).trim()
      for (const itemEntry of array(vault.items)) {
        if (items.length >= MAX_IMPORT_ITEMS) {
          truncated = true
          break
        }
        const converted = convertItem(itemEntry, vaultId, vaultName)
        attachments += converted.attachments
        passwordHistory += converted.passwordHistory
        if (!converted.draft) {
          skipped += 1
          continue
        }
        items.push(converted.draft)
      }
      if (truncated) break
    }
    if (truncated) break
  }

  if (truncated) {
    warnings.push(
      `Seuls les ${MAX_IMPORT_ITEMS} premiers éléments ont été importés.`,
    )
  }
  if (skipped > 0) {
    warnings.push(`${skipped} élément${skipped > 1 ? 's' : ''} supprimé${skipped > 1 ? 's' : ''} dans 1Password ignoré${skipped > 1 ? 's' : ''}.`)
  }
  if (attachments > 0) {
    warnings.push(
      `${attachments} pièce${attachments > 1 ? 's' : ''} jointe${
        attachments > 1 ? 's' : ''
      } 1Password non importée${attachments > 1 ? 's' : ''}.`,
    )
  }
  if (passwordHistory > 0) {
    warnings.push(
      `${passwordHistory} ancien${passwordHistory > 1 ? 's' : ''} mot${
        passwordHistory > 1 ? 's' : ''
      } de passe (historique 1Password) non importé${passwordHistory > 1 ? 's' : ''}.`,
    )
  }
  if (items.length === 0) warnings.push('Aucun élément importable trouvé.')

  return { format: '1pux', source: '1password', items, warnings }
}
