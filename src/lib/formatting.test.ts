import { describe, expect, it } from 'vitest'
import {
  formatCardNumberInput,
  formatIbanInput,
  formatPhoneInput,
  formatSortCodeInput,
  sanitizeCardNumber,
} from './formatting'

describe('formatage des numéros', () => {
  it('groupe les IBAN par quatre en majuscules', () => {
    expect(formatIbanInput('fr76 3000 6000 0112 3456 7890 189')).toBe(
      'FR76 3000 6000 0112 3456 7890 189',
    )
    expect(formatIbanInput('FR7630006000011234567890189')).toBe(
      'FR76 3000 6000 0112 3456 7890 189',
    )
    expect(formatIbanInput('FR76 30')).toBe('FR76 30')
    expect(formatIbanInput('fr76-30')).toBe('FR76 30')
  })

  it('groupe les cartes par quatre, avec le format Amex', () => {
    expect(formatCardNumberInput('4242424242424242')).toBe(
      '4242 4242 4242 4242',
    )
    expect(formatCardNumberInput('424242')).toBe('4242 42')
    expect(formatCardNumberInput('378282246310005')).toBe('3782 822463 10005')
    expect(formatCardNumberInput('4242-4242')).toBe('4242 4242')
    expect(sanitizeCardNumber('4242-abc 4242')).toBe('4242 4242')
  })

  it('formate les téléphones français sans toucher aux autres formats', () => {
    expect(formatPhoneInput('0612345678')).toBe('06 12 34 56 78')
    expect(formatPhoneInput('06 12 34')).toBe('06 12 34')
    expect(formatPhoneInput('+33612345678')).toBe('+33 6 12 34 56 78')
    expect(formatPhoneInput('+33 6 12')).toBe('+33 6 12')
    expect(formatPhoneInput('+14155551234')).toBe('+14155551234')
  })

  it('formate les codes de routage en paires ou en 3-3-3', () => {
    expect(formatSortCodeInput('123456')).toBe('12-34-56')
    expect(formatSortCodeInput('12345')).toBe('12-34-5')
    expect(formatSortCodeInput('1234567')).toBe('123-456-7')
    expect(formatSortCodeInput('123456789')).toBe('123-456-789')
    expect(formatSortCodeInput('12-34-56')).toBe('12-34-56')
    expect(formatSortCodeInput('AB-12-CD')).toBe('AB-12-CD')
  })
})
