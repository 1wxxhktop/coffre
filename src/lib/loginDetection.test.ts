// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { detectLoginFields, fillDetectedLogin } from '../../extension/detect'

interface Case {
  name: string
  html: string
  username: string | null
  password: string | null
  otp?: string | null
}

const input = (attributes: string) => `<input ${attributes} />`

const CASES: Case[] = [
  {
    name: 'libellé explicite',
    html: `<form><label for="u">Identifiant</label>${input('id="u" name="user"')}<label for="p">Mot de passe</label>${input('id="p" name="pass" type="password"')}</form>`,
    username: 'user',
    password: 'pass',
  },
  {
    name: 'email et mot de passe',
    html: `<form>${input('name="email" type="email"')}${input('name="pass" type="password"')}</form>`,
    username: 'email',
    password: 'pass',
  },
  {
    name: 'autocomplete standard',
    html: `<form>${input('name="login" autocomplete="username"')}${input('name="secret" type="password" autocomplete="current-password"')}</form>`,
    username: 'login',
    password: 'secret',
  },
  {
    name: 'placeholder',
    html: `<form>${input('name="login" placeholder="Adresse e-mail"')}${input('name="secret" type="password"')}</form>`,
    username: 'login',
    password: 'secret',
  },
  {
    name: 'aria-label',
    html: `<form>${input('name="login" aria-label="Nom d’utilisateur"')}${input('name="secret" type="password"')}</form>`,
    username: 'login',
    password: 'secret',
  },
  {
    name: 'label englobant',
    html: `<form><label>Compte ${input('name="account"')}</label><label>Mot de passe ${input('name="secret" type="password"')}</label></form>`,
    username: 'account',
    password: 'secret',
  },
  {
    name: 'champ caché avant',
    html: `<form>${input('type="hidden" name="csrf" value="x"')}${input('name="username"')}${input('name="password" type="password"')}</form>`,
    username: 'username',
    password: 'password',
  },
  {
    name: 'champ de recherche avant',
    html: `<form>${input('name="search" type="text"')}${input('name="user"')}${input('name="pass" type="password"')}</form>`,
    username: 'user',
    password: 'pass',
  },
  {
    name: 'identifiant téléphone',
    html: `<form>${input('name="phone" type="tel"')}${input('name="pass" type="password"')}</form>`,
    username: 'phone',
    password: 'pass',
  },
  {
    name: 'identifiant account',
    html: `<form>${input('name="account"')}${input('name="pass" type="password"')}</form>`,
    username: 'account',
    password: 'pass',
  },
  {
    name: 'code de vérification',
    html: `<form>${input('name="login"')}${input('name="pass" type="password"')}${input('name="otp" autocomplete="one-time-code"')}</form>`,
    username: 'login',
    password: 'pass',
    otp: 'otp',
  },
  {
    name: 'code 2FA par nom',
    html: `<form>${input('name="login"')}${input('name="pass" type="password"')}${input('name="twofactor_code"')}</form>`,
    username: 'login',
    password: 'pass',
    otp: 'twofactor_code',
  },
  {
    name: 'code numérique',
    html: `<form>${input('name="login"')}${input('name="pass" type="password"')}${input('name="code" inputmode="numeric"')}</form>`,
    username: 'login',
    password: 'pass',
    otp: 'code',
  },
  {
    name: 'case à cocher',
    html: `<form>${input('name="user"')}${input('name="pass" type="password"')}<label><input type="checkbox" name="remember" /> Se souvenir</label></form>`,
    username: 'user',
    password: 'pass',
  },
  {
    name: 'sans formulaire',
    html: `<main>${input('name="user"')}${input('name="pass" type="password"')}</main>`,
    username: 'user',
    password: 'pass',
  },
  {
    name: 'deux champs texte sans indice',
    html: `<form>${input('name="a"')}${input('name="b"')}${input('name="pass" type="password"')}</form>`,
    username: 'a',
    password: 'pass',
  },
  {
    name: 'uniquement mot de passe',
    html: `<form>${input('name="pass" type="password"')}</form>`,
    username: null,
    password: 'pass',
  },
  {
    name: 'nom session username_or_email',
    html: `<form>${input('name="session[username_or_email]"')}${input('name="session[password]" type="password"')}</form>`,
    username: 'session[username_or_email]',
    password: 'session[password]',
  },
  {
    name: 'nom login simple',
    html: `<form>${input('name="login"')}${input('name="password" type="password"')}</form>`,
    username: 'login',
    password: 'password',
  },
  {
    name: 'bouton avant les champs',
    html: `<form><button type="button">Aide</button>${input('name="user"')}${input('name="pass" type="password"')}</form>`,
    username: 'user',
    password: 'pass',
  },
  {
    name: 'champ utilisateur masqué',
    html: `<form>${input('name="fake" style="display:none"')}${input('name="user"')}${input('name="pass" type="password"')}</form>`,
    username: 'user',
    password: 'pass',
  },
  {
    name: 'champ utilisateur invisible',
    html: `<form>${input('name="fake" style="visibility:hidden"')}${input('name="user"')}${input('name="pass" type="password"')}</form>`,
    username: 'user',
    password: 'pass',
  },
  {
    name: 'mot de passe transparent',
    html: `<form>${input('name="user"')}${input('name="fake" type="password" style="opacity:0"')}${input('name="pass" type="password"')}</form>`,
    username: 'user',
    password: 'pass',
  },
  {
    name: 'aria-hidden sur le champ factice',
    html: `<form><span aria-hidden="true">${input('name="fake"')}</span>${input('name="user"')}${input('name="pass" type="password"')}</form>`,
    username: 'user',
    password: 'pass',
  },
  {
    name: 'champ désactivé',
    html: `<form>${input('name="fake" disabled')}${input('name="user"')}${input('name="pass" type="password"')}</form>`,
    username: 'user',
    password: 'pass',
  },
  {
    name: 'libellé adresse e-mail',
    html: `<form><label for="mail">Adresse e-mail</label>${input('id="mail" name="mail"')}${input('name="pass" type="password"')}</form>`,
    username: 'mail',
    password: 'pass',
  },
  {
    name: 'champ identifiant en lecture seule',
    html: `<form>${input('name="user" readonly')}${input('name="login"')}${input('name="pass" type="password"')}</form>`,
    username: 'login',
    password: 'pass',
  },
  {
    name: 'inscription refusée',
    html: `<form>${input('name="user"')}${input('name="pass" type="password"')}${input('name="confirm" type="password"')}</form>`,
    username: null,
    password: null,
  },
  {
    name: 'changement de mot de passe refusé',
    html: `<form>${input('name="current" type="password"')}${input('name="new" type="password"')}</form>`,
    username: null,
    password: null,
  },
  {
    name: 'current-password parmi deux',
    html: `<form>${input('name="new" type="password"')}${input('name="user"')}${input('name="current" type="password" autocomplete="current-password"')}</form>`,
    username: 'user',
    password: 'current',
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

describe('détection des formulaires de connexion', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      document.body.innerHTML = testCase.html
      const detected = detectLoginFields(document)
      const identifier = (element: HTMLInputElement | null) =>
        element?.getAttribute('name') ?? null
      expect(identifier(detected.username)).toBe(testCase.username)
      expect(identifier(detected.password)).toBe(testCase.password)
      expect(identifier(detected.otp)).toBe(testCase.otp ?? null)
    })
  }

  it('couvre au moins 30 pages', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30)
  })

  it('remplit l’identifiant, le mot de passe et le code TOTP', () => {
    document.body.innerHTML = `<form>${input('id="u" name="user" autocomplete="username"')}${input('id="p" name="pass" type="password" autocomplete="current-password"')}${input('id="o" name="otp" autocomplete="one-time-code"')}</form>`
    const fields = detectLoginFields(document)
    const filled = fillDetectedLogin(fields, {
      username: 'ada',
      password: 'secret',
      totp: '123456',
    })
    expect(filled).toBe(3)
    expect(document.querySelector<HTMLInputElement>('#u')?.value).toBe('ada')
    expect(document.querySelector<HTMLInputElement>('#p')?.value).toBe('secret')
    expect(document.querySelector<HTMLInputElement>('#o')?.value).toBe('123456')
  })
})
