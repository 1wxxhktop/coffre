/**
 * Règles des champs personnalisés : secrets, validation douce et
 * normalisation à l’enregistrement. Le contenu reste une chaîne, chiffrée
 * avec l’élément ; le type ne change que la saisie et l’affichage.
 */

import { isTotpUri, normalizeTotpUri } from './totp'
import type { CustomFieldType } from './types'

/** Libellés source (traduits par `tt`) des types de champs. */
export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Texte',
  multiline: 'Texte long',
  hidden: 'Texte masqué',
  password: 'Mot de passe',
  pin: 'Code PIN',
  totp: 'Code 2FA (TOTP)',
  url: 'Adresse web',
  email: 'E-mail',
  phone: 'Téléphone',
  number: 'Nombre',
  date: 'Date',
  month: 'Mois et année',
  checkbox: 'Oui / non',
}

/** Valeurs masquées à l’affichage, protégées à l’export et hors recherche. */
export function isSecretFieldType(type: CustomFieldType): boolean {
  return type === 'hidden' || type === 'password' || type === 'pin' || type === 'totp'
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[\d\s().-]{3,30}$/
const NUMBER = /^-?\d+(?:[.,]\d+)?$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const PIN = /^\d{2,12}$/

/**
 * Vrai si la valeur convient au type. La validation reste indicative : une
 * valeur non conforme est signalée mais jamais refusée ni modifiée.
 */
export function isCustomFieldValueValid(type: CustomFieldType, value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  switch (type) {
    case 'email':
      return EMAIL.test(trimmed)
    case 'phone':
      return PHONE.test(trimmed)
    case 'number':
      return NUMBER.test(trimmed)
    case 'date':
      return DATE.test(trimmed)
    case 'month':
      return MONTH.test(trimmed)
    case 'pin':
      return PIN.test(trimmed)
    case 'checkbox':
      return trimmed === 'true' || trimmed === 'false'
    case 'totp':
      return isTotpUri(normalizeTotpUri(trimmed, 'Coffre'))
    case 'url':
      return /^https?:\/\/\S+$/i.test(trimmed) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(trimmed)
    default:
      return true
  }
}

/**
 * Valeur enregistrée : une clé TOTP devient un lien otpauth://, une case à
 * cocher vaut `true` ou `false`. Les autres valeurs sont conservées telles
 * quelles (au plus 10 000 caractères).
 */
export function normalizeCustomFieldValue(
  type: CustomFieldType,
  value: string,
  itemTitle: string,
  fieldLabel: string,
): string {
  const raw = (value ?? '').slice(0, 10_000)
  if (type === 'checkbox') return raw.trim() === 'true' ? 'true' : 'false'
  if (type === 'totp' && raw.trim()) {
    return normalizeTotpUri(raw, itemTitle, fieldLabel).slice(0, 10_000)
  }
  return raw
}

/** Date `AAAA-MM-JJ` lue dans le fuseau local (pas de décalage UTC). */
export function formatCustomDate(value: string, locale: string): string {
  const match = DATE.exec(value.trim())
  if (!match) return value
  const [year, month, day] = value.trim().split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Mois `AAAA-MM` affiché « mars 2027 ». */
export function formatCustomMonth(value: string, locale: string): string {
  if (!MONTH.test(value.trim())) return value
  const [year, month] = value.trim().split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  })
}
