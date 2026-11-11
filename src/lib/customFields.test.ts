import { describe, expect, it } from 'vitest'
import {
  CUSTOM_FIELD_TYPE_LABELS,
  formatCustomDate,
  formatCustomMonth,
  isCustomFieldValueValid,
  isSecretFieldType,
  normalizeCustomFieldValue,
} from './customFields'
import { isTotpUri, normalizeTotpUri, totpInputValue } from './totp'
import { CUSTOM_FIELD_TYPES } from './types'

describe('types de champs personnalisés', () => {
  it('a un libellé pour chaque type', () => {
    for (const type of CUSTOM_FIELD_TYPES) {
      expect(CUSTOM_FIELD_TYPE_LABELS[type]).toBeTruthy()
    }
  })

  it('traite comme secrets le masqué, le mot de passe, le PIN et le TOTP', () => {
    expect(CUSTOM_FIELD_TYPES.filter(isSecretFieldType)).toEqual([
      'hidden',
      'password',
      'pin',
      'totp',
    ])
  })

  it('valide sans bloquer les valeurs selon le type', () => {
    expect(isCustomFieldValueValid('email', 'ada@example.com')).toBe(true)
    expect(isCustomFieldValueValid('email', 'ada@')).toBe(false)
    expect(isCustomFieldValueValid('phone', '+33 6 12 34 56 78')).toBe(true)
    expect(isCustomFieldValueValid('number', '-12,5')).toBe(true)
    expect(isCustomFieldValueValid('number', 'douze')).toBe(false)
    expect(isCustomFieldValueValid('date', '2027-02-28')).toBe(true)
    expect(isCustomFieldValueValid('date', '2027-13-01')).toBe(false)
    expect(isCustomFieldValueValid('month', '2027-03')).toBe(true)
    expect(isCustomFieldValueValid('pin', '1234')).toBe(true)
    expect(isCustomFieldValueValid('pin', '12a4')).toBe(false)
    expect(isCustomFieldValueValid('totp', 'jbsw y3dp ehpk 3pxp')).toBe(true)
    expect(isCustomFieldValueValid('totp', 'pas une clé')).toBe(false)
    expect(isCustomFieldValueValid('url', 'example.com/login')).toBe(true)
    // Une valeur vide est toujours acceptée.
    expect(isCustomFieldValueValid('email', '  ')).toBe(true)
  })

  it('normalise la case à cocher et la clé TOTP à l’enregistrement', () => {
    expect(normalizeCustomFieldValue('checkbox', 'true', 'Site', 'Actif')).toBe('true')
    expect(normalizeCustomFieldValue('checkbox', 'oui', 'Site', 'Actif')).toBe('false')
    const uri = normalizeCustomFieldValue('totp', 'jbsw y3dp ehpk 3pxp', 'GitHub', '2FA')
    expect(uri).toBe('otpauth://totp/GitHub:2FA?secret=JBSWY3DPEHPK3PXP&issuer=GitHub')
    expect(isTotpUri(uri)).toBe(true)
    expect(normalizeCustomFieldValue('text', ' garde les espaces ', 'Site', 'Note')).toBe(
      ' garde les espaces ',
    )
  })

  it('affiche les dates et les mois dans la langue choisie, sans décalage', () => {
    expect(formatCustomDate('2027-01-01', 'fr-FR')).toBe('1 janvier 2027')
    expect(formatCustomMonth('2027-03', 'fr-FR')).toBe('mars 2027')
    expect(formatCustomDate('bientôt', 'fr-FR')).toBe('bientôt')
  })
})

describe('saisie de la clé TOTP', () => {
  it('construit un lien avec le site et l’identifiant', () => {
    expect(normalizeTotpUri('JBSW Y3DP EHPK 3PXP', 'GitHub', 'ada@example.com')).toBe(
      'otpauth://totp/GitHub:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
    )
    expect(normalizeTotpUri('jbswy3dpehpk3pxp', 'GitHub')).toBe(
      'otpauth://totp/GitHub?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
    )
  })

  it('conserve un lien otpauth:// tel quel', () => {
    const uri = 'otpauth://totp/Site:ada?secret=JBSWY3DPEHPK3PXP&digits=8'
    expect(normalizeTotpUri(uri, 'Autre', 'autre')).toBe(uri)
  })

  it('affiche la clé seule pour un lien standard, le lien sinon', () => {
    expect(
      totpInputValue('otpauth://totp/GitHub:ada?secret=JBSWY3DPEHPK3PXP&issuer=GitHub'),
    ).toBe('JBSW Y3DP EHPK 3PXP')
    const custom = 'otpauth://totp/Site?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256'
    expect(totpInputValue(custom)).toBe(custom)
    expect(totpInputValue('JBSW')).toBe('JBSW')
  })
})
