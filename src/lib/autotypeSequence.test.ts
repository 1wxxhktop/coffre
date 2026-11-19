import { describe, expect, it } from 'vitest'
import {
  AUTOTYPE_SEQUENCE_MAX_LENGTH,
  validateAutotypeSequence,
} from './autotypeSequence'

describe('validation de la séquence de saisie automatique', () => {
  it('accepte la séquence par défaut et les jetons connus', () => {
    expect(
      validateAutotypeSequence('{USERNAME}{TAB}{PASSWORD}{ENTER}'),
    ).toBeNull()
    expect(
      validateAutotypeSequence(
        '{USERNAME}{TAB}{PASSWORD}{TAB}{TOTP}{ENTER}{DELAY 500}',
      ),
    ).toBeNull()
    expect(validateAutotypeSequence('{ username }texte}{ESC}')).toBeNull()
  })

  it('accepte les accolades littérales', () => {
    expect(validateAutotypeSequence('{{USERNAME}}')).toBeNull()
    expect(validateAutotypeSequence('littéral {{ et }}')).toBeNull()
  })

  it('refuse un jeton non terminé', () => {
    expect(validateAutotypeSequence('{USERNAME')).toEqual({
      code: 'unclosed-token',
    })
  })

  it('refuse un délai invalide ou trop long', () => {
    expect(validateAutotypeSequence('{DELAY abc}')).toEqual({
      code: 'invalid-delay',
      token: 'DELAY abc',
    })
    expect(validateAutotypeSequence('{DELAY 60001}')).toEqual({
      code: 'delay-too-long',
    })
  })

  it('refuse un jeton inconnu', () => {
    expect(validateAutotypeSequence('{SECRET}')).toEqual({
      code: 'unknown-token',
      token: 'SECRET',
    })
  })

  it('refuse une séquence trop longue', () => {
    expect(validateAutotypeSequence('{'.repeat(AUTOTYPE_SEQUENCE_MAX_LENGTH + 1))).toEqual({
      code: 'too-long',
    })
  })
})
