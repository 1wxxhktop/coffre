/**
 * Export CSV.
 *
 * Deux formats sont proposés :
 *  - « Mots de passe » (Apple) : les six colonnes attendues par l’application
 *    Mots de passe, pour les connexions actives uniquement ;
 *  - « Coffre complet » : un format propre à Coffre qui conserve tous les types
 *    d’éléments et les champs personnalisés, et que l’import CSV sait relire.
 *
 * Le CSV est un format en clair : il ne doit servir qu’à une migration, puis
 * être supprimé. Le fichier `.coffre` chiffré reste la sauvegarde complète.
 */

import { normalizeTotpUri } from './totp'
import type { CustomField, VaultItem, VaultSummary } from './types'

export type CsvExportFormat = 'apple' | 'coffre'

export interface CsvExportResult {
  content: string
  filename: string
  exported: number
  skipped: number
  warnings: string[]
}

const APPLE_HEADERS = ['Title', 'URL', 'Username', 'Password', 'Notes', 'OTPAuth']

const FULL_HEADERS = [
  'type',
  'title',
  'url',
  'username',
  'password',
  'totp',
  'notes',
  'folder',
  'tags',
  'favorite',
  'coffre_custom_fields',
  'cardholder',
  'card_number',
  'expiry',
  'cvc',
  'pin',
  'brand',
  'first_name',
  'last_name',
  'email',
  'phone',
  'address',
  'city',
  'postal_code',
  'country',
  'birth_date',
]

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function buildCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function vaultNameMap(vaults: VaultSummary[]): Map<string, string> {
  return new Map(vaults.map((vault) => [vault.id, vault.name]))
}

function customFieldLines(fields: CustomField[]): string[] {
  return fields
    .map((field) => {
      const value = field.value.trim()
      if (!value) return ''
      return `${field.label.trim() || 'Champ'} : ${value}`
    })
    .filter(Boolean)
}

function appleNotes(item: VaultItem, vaultName: string, extra: string[]): string {
  const lines: string[] = []
  if (item.notes.trim()) lines.push(item.notes.trim())
  lines.push(...customFieldLines(item.customFields))
  if (item.tags.length > 0) lines.push(`Étiquettes : ${item.tags.join(', ')}`)
  if (vaultName) lines.push(`Coffre : ${vaultName}`)
  lines.push(...extra)
  return lines.join('\n')
}

function appleUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function appleOtp(item: Extract<VaultItem, { type: 'login' }>): string {
  const normalized = normalizeTotpUri(item.totp, item.title)
  return /^otpauth:\/\//i.test(normalized) ? normalized : ''
}

function exportApple(items: VaultItem[], vaults: VaultSummary[]): CsvExportResult {
  const names = vaultNameMap(vaults)
  const active = items.filter((item) => !item.deletedAt)
  const logins = active.filter(
    (item): item is Extract<VaultItem, { type: 'login' }> => item.type === 'login',
  )

  const rows = logins.map((item) => {
    const otp = appleOtp(item)
    const urls = item.urls.map((url) => url.trim()).filter(Boolean)
    const extra: string[] = []
    if (urls.length > 1) extra.push(`Autres URL : ${urls.slice(1).join(', ')}`)
    if (item.totp && !otp) extra.push(`TOTP : ${item.totp}`)
    return [
      item.title.trim() || 'Sans titre',
      appleUrl(urls[0] ?? ''),
      item.username,
      item.password,
      appleNotes(item, names.get(item.vaultId) ?? '', extra),
      otp,
    ]
  })

  const skipped = active.length - logins.length
  const trashed = items.length - active.length
  const warnings: string[] = []
  if (skipped > 0) {
    warnings.push(
      `${skipped} élément${skipped > 1 ? 's' : ''} non exporté${
        skipped > 1 ? 's' : ''
      } : le format Mots de passe ne prend en charge que les connexions.`,
    )
  }
  const incomplete = logins.filter(
    (item) => !item.password.trim() || !item.urls.some((url) => url.trim()),
  ).length
  if (incomplete > 0) {
    warnings.push(
      `${incomplete} connexion${incomplete > 1 ? 's' : ''} sans mot de passe ou sans URL : Mots de passe peut les ignorer.`,
    )
  }
  if (trashed > 0) {
    warnings.push(
      `${trashed} élément${trashed > 1 ? 's' : ''} en corbeille ignoré${
        trashed > 1 ? 's' : ''
      }.`,
    )
  }

  return {
    content: buildCsv(APPLE_HEADERS, rows),
    filename: `mots-de-passe-${dateStamp()}.csv`,
    exported: rows.length,
    skipped: items.length - rows.length,
    warnings,
  }
}

function fullRow(item: VaultItem, vaultName: string): string[] {
  const login = item.type === 'login' ? item : null
  const card = item.type === 'card' ? item : null
  const identity = item.type === 'identity' ? item : null
  const customFields = JSON.stringify(
    item.customFields
      .filter((field) => field.label.trim() || field.value.trim())
      .map((field) => ({
        label: field.label,
        value: field.value,
        type: field.type,
      })),
  )

  return [
    item.type,
    item.title,
    login ? login.urls.join('\n') : '',
    login ? login.username : '',
    login ? login.password : '',
    login ? login.totp : '',
    item.notes,
    vaultName,
    item.tags.join(';'),
    item.favorite ? '1' : '0',
    customFields === '[]' ? '' : customFields,
    card ? card.cardholder : '',
    card ? card.number : '',
    card ? card.expiry : '',
    card ? card.cvc : '',
    card ? card.pin : '',
    card ? card.brand : '',
    identity ? identity.firstName : '',
    identity ? identity.lastName : '',
    identity ? identity.email : '',
    identity ? identity.phone : '',
    identity ? identity.address : '',
    identity ? identity.city : '',
    identity ? identity.postalCode : '',
    identity ? identity.country : '',
    identity ? identity.birthDate : '',
  ]
}

function exportFull(items: VaultItem[], vaults: VaultSummary[]): CsvExportResult {
  const names = vaultNameMap(vaults)
  const active = items.filter((item) => !item.deletedAt)
  const rows = active.map((item) => fullRow(item, names.get(item.vaultId) ?? ''))

  const trashed = items.length - active.length
  const attachments = active.reduce((total, item) => total + item.attachments.length, 0)
  const warnings: string[] = []
  if (trashed > 0) {
    warnings.push(
      `${trashed} élément${trashed > 1 ? 's' : ''} en corbeille ignoré${
        trashed > 1 ? 's' : ''
      }.`,
    )
  }
  if (attachments > 0) {
    warnings.push(
      `${attachments} pièce${attachments > 1 ? 's' : ''} jointe${
        attachments > 1 ? 's' : ''
      } non incluse${attachments > 1 ? 's' : ''} : utilisez l’export .coffre.`,
    )
  }

  return {
    content: buildCsv(FULL_HEADERS, rows),
    filename: `coffre-complet-${dateStamp()}.csv`,
    exported: rows.length,
    skipped: trashed,
    warnings,
  }
}

/**
 * Produit le contenu CSV et ses métadonnées. Les éléments en corbeille sont
 * toujours exclus ; les pièces jointes ne sont jamais incluses.
 */
export function exportCsv(
  items: VaultItem[],
  vaults: VaultSummary[],
  format: CsvExportFormat,
): CsvExportResult {
  return format === 'apple'
    ? exportApple(items, vaults)
    : exportFull(items, vaults)
}
