/**
 * Index de recherche des éléments du coffre.
 *
 * Le texte est normalisé une seule fois par élément (casse, accents), puis
 * réutilisé à chaque frappe. Les valeurs secrètes ne sont jamais indexées :
 * seuls leurs libellés restent cherchables.
 */

import { isSecretFieldType } from './customFields'
import { itemSubtitle, type VaultItem } from './types'

/** Normalise une chaîne pour une recherche insensible à la casse et aux accents. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Texte cherchable d’un élément, sans aucun secret. */
export function searchableText(item: VaultItem): string {
  const common = [
    item.title,
    itemSubtitle(item),
    item.tags.join(' '),
    item.notes,
    // Les valeurs secrètes (masqué, mot de passe, PIN, TOTP) ne sont pas
    // indexées : seul leur nom est cherchable.
    item.customFields
      .map((field) =>
        isSecretFieldType(field.type) ? field.label : `${field.label} ${field.value}`,
      )
      .join(' '),
    item.attachments.map((attachment) => attachment.name).join(' '),
  ]

  switch (item.type) {
    case 'login':
      common.push(item.username, item.urls.join(' '))
      break
    case 'card':
      common.push(item.cardholder, item.number.slice(-4), item.brand)
      break
    case 'identity':
      common.push(
        item.firstName,
        item.lastName,
        item.email,
        item.phone,
        item.city,
        item.country,
      )
      break
    case 'bank-account':
      common.push(
        item.accountHolder,
        item.bankName,
        item.iban.replace(/\s+/g, '').slice(-4),
        item.swift,
        item.currency,
        item.cardholder,
        item.cardBrand,
        item.cardNumber.replace(/\s+/g, '').slice(-4),
      )
      break
    case 'note':
      break
    case 'passkey':
      common.push(item.rpId, item.userName)
      break
    case 'ssh-key':
      common.push(item.comment, item.fingerprint, item.publicKey)
      break
    case 'wifi':
      common.push(item.ssid, item.security)
      break
    case 'api-credential':
      common.push(item.keyId, item.environment, item.endpoint)
      break
    case 'software-license':
      common.push(item.licensedTo, item.version, item.website)
      break
    case 'document':
      common.push(item.issuer, item.documentNumber, item.documentKind)
      break
    case 'recovery-codes':
      common.push('codes de secours', 'recovery codes')
      break
  }

  return normalizeSearchText(common.join(' '))
}

/** Construit l’index id → texte normalisé en une seule passe. */
export function buildSearchIndex(
  items: readonly VaultItem[],
): Map<string, string> {
  return new Map(items.map((item) => [item.id, searchableText(item)]))
}
