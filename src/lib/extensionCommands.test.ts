// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import {
  fillOtpField,
  fillPasswordField,
} from '../../extension/detect'
import {
  matchingLoginSummaries,
  totpLoginSummary,
} from '../../extension/commandHelpers'
import type {
  ExtensionAutofillSummary,
  ExtensionLoginSummary,
} from './extensionProtocol'

function login(
  id: string,
  host: string,
  hasTotp = false,
): ExtensionLoginSummary {
  return { id, title: id, username: 'ada', host, hasTotp }
}

const entries: ExtensionAutofillSummary[] = [
  login('github', 'github.com'),
  login('gist', 'gist.github.com', true),
  login('evil', 'evil.example'),
  {
    id: 'card',
    kind: 'card',
    title: 'Visa',
    brand: 'Visa',
    last4: '4242',
    expiry: '12/28',
  },
]

beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 120,
      height: 24,
      top: 0,
      left: 0,
      right: 120,
      bottom: 24,
      toJSON: () => ({}),
    }) as DOMRect
})

describe('raccourcis de remplissage', () => {
  it('ne garde que les connexions du domaine de la page active', () => {
    expect(matchingLoginSummaries(entries, 'github.com').map((item) => item.id))
      .toEqual(['github'])
    expect(matchingLoginSummaries(entries, 'gist.github.com').map((item) => item.id))
      .toEqual(['gist'])
    expect(matchingLoginSummaries(entries, 'www.github.com').map((item) => item.id))
      .toEqual(['github'])
    expect(matchingLoginSummaries(entries, 'evil.example').map((item) => item.id))
      .toEqual(['evil'])
    expect(matchingLoginSummaries(entries, 'inconnu.example')).toEqual([])
  })

  it('choisit la connexion avec un TOTP sans exposer les autres', () => {
    expect(totpLoginSummary(entries, 'gist.github.com')?.id).toBe('gist')
    expect(totpLoginSummary(entries, 'github.com')).toBeNull()
    expect(totpLoginSummary(entries, 'evil.example')).toBeNull()
  })

  it('remplit le champ de mot de passe actif', () => {
    document.body.innerHTML =
      '<input id="username" /><input id="password" type="password" />'
    const password = document.querySelector<HTMLInputElement>('#password')!
    password.focus()
    expect(fillPasswordField(document, 'secret-généré')).toBe(1)
    expect(password.value).toBe('secret-généré')
  })

  it('remplit le premier mot de passe d’un formulaire d’inscription', () => {
    document.body.innerHTML =
      '<input id="new-password" type="password" autocomplete="new-password" />' +
      '<input id="confirm" type="password" autocomplete="new-password" />'
    const password = document.querySelector<HTMLInputElement>('#new-password')!
    expect(fillPasswordField(document, 'mot-de-passe')).toBe(1)
    expect(password.value).toBe('mot-de-passe')
  })

  it('remplit le champ TOTP détecté', () => {
    document.body.innerHTML =
      '<input id="username" />' +
      '<input id="otp" autocomplete="one-time-code" inputmode="numeric" />'
    const otp = document.querySelector<HTMLInputElement>('#otp')!
    expect(fillOtpField(document, '123456')).toBe(1)
    expect(otp.value).toBe('123456')
  })
})
