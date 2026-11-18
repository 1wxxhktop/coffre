// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import {
  detectAutofillFields,
  detectSignupFields,
  fillSignupPasswords,
} from '../../extension/detect'

function mount(html: string): Document {
  document.body.innerHTML = html
  return document
}

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

describe('détection de l’inscription', () => {
  it('reconnaît un nouveau mot de passe et sa confirmation', () => {
    const document = mount(`
      <form>
        <label>E-mail <input id="email" autocomplete="username" /></label>
        <label>Mot de passe <input id="new-password" type="password" autocomplete="new-password" /></label>
        <label>Confirmer <input id="confirm" type="password" autocomplete="new-password" /></label>
        <button type="submit">Créer mon compte</button>
      </form>
    `)
    const fields = detectSignupFields(document)
    expect(fields?.password.id).toBe('new-password')
    expect(fields?.confirm?.id).toBe('confirm')
    expect(fields?.username?.id).toBe('email')
    expect(fields?.change).toBe(false)
    expect(detectAutofillFields(document)?.kind).toBe('signup')

    expect(fillSignupPasswords(fields!, 'mot-de-passe-fort')).toBe(2)
    expect(
      document.querySelector<HTMLInputElement>('#new-password')?.value,
    ).toBe('mot-de-passe-fort')
    expect(document.querySelector<HTMLInputElement>('#confirm')?.value).toBe(
      'mot-de-passe-fort',
    )
  })

  it('ne déclenche pas sur un formulaire de connexion simple', () => {
    const document = mount(`
      <form>
        <input id="username" autocomplete="username" />
        <input id="password" type="password" autocomplete="current-password" />
        <button>Connexion</button>
      </form>
    `)
    expect(detectSignupFields(document)).toBeNull()
    expect(detectAutofillFields(document)?.kind).toBe('login')
  })

  it('reconnaît un changement de mot de passe à deux champs', () => {
    const document = mount(`
      <form>
        <input id="username" autocomplete="username" />
        <input id="password" type="password" autocomplete="new-password" />
        <input id="confirm" type="password" autocomplete="new-password" />
      </form>
    `)
    const fields = detectSignupFields(document)
    expect(fields?.password.id).toBe('password')
    expect(fields?.confirm?.id).toBe('confirm')
  })

  it('reconnaît un formulaire d’inscription avec un seul nouveau champ', () => {
    const document = mount(`
      <form>
        <h2>Créer un compte</h2>
        <input id="email" type="email" autocomplete="email" />
        <input id="password" type="password" autocomplete="new-password" />
      </form>
    `)
    const fields = detectSignupFields(document)
    expect(fields?.password.id).toBe('password')
    expect(fields?.confirm).toBeNull()
  })

  it('reconnaît le texte du formulaire quand autocomplete manque', () => {
    const document = mount(`
      <form>
        <h2>Créer un compte</h2>
        <input id="email" type="email" />
        <input id="password" type="password" />
      </form>
    `)
    expect(detectSignupFields(document)?.password.id).toBe('password')
  })

  it('ignore le lien « Mot de passe oublié » d’une connexion', () => {
    const document = mount(`
      <form>
        <input id="email" type="email" name="email" />
        <input id="password" type="password" name="password" />
        <a href="#">Mot de passe oublié ?</a>
        <button>Se connecter</button>
      </form>
    `)
    expect(detectSignupFields(document)).toBeNull()
    expect(detectAutofillFields(document)?.kind).toBe('login')
  })

  it('ignore le lien « Sign up » d’une connexion', () => {
    const document = mount(`
      <form>
        <input id="username" name="username" />
        <input id="password" type="password" name="password" />
        <button>Log in</button>
        <p>No account? <a href="#">Sign up</a></p>
      </form>
    `)
    expect(detectSignupFields(document)).toBeNull()
    expect(detectAutofillFields(document)?.kind).toBe('login')
  })

  it('ne retient pas le champ actuel d’un changement sans indices', () => {
    const document = mount(`
      <form>
        <input id="old" type="password" />
        <input id="new" type="password" />
        <input id="again" type="password" />
      </form>
    `)
    const fields = detectSignupFields(document)
    expect(fields?.password.id).toBe('new')
    expect(fields?.confirm?.id).toBe('again')
    expect(fields?.change).toBe(true)
  })

  it('ne remplit jamais un champ marqué current-password', () => {
    const document = mount(`
      <form>
        <input id="old" type="password" autocomplete="current-password" />
        <input id="new" type="password" autocomplete="new-password" />
        <input id="again" type="password" />
      </form>
    `)
    const fields = detectSignupFields(document)
    expect(fields?.password.id).toBe('new')
    expect(fields?.confirm?.id).toBe('again')
    expect(fields?.change).toBe(true)
  })

  it('reconnaît un changement à deux champs sans autocomplete ni identifiant', () => {
    const document = mount(`
      <form>
        <h2>Changer le mot de passe</h2>
        <input id="old" type="password" />
        <input id="new" type="password" />
        <button>Enregistrer</button>
      </form>
    `)
    const fields = detectSignupFields(document)
    expect(fields?.password.id).toBe('new')
    expect(fields?.username).toBeNull()
    expect(fields?.change).toBe(true)
  })

  it('écarte l’ancien mot de passe désigné par son libellé', () => {
    const document = mount(`
      <form>
        <label>Ancien mot de passe <input id="old" type="password" /></label>
        <label>Nouveau mot de passe <input id="new" type="password" /></label>
        <label>Confirmer <input id="again" type="password" /></label>
      </form>
    `)
    const fields = detectSignupFields(document)
    expect(fields?.password.id).toBe('new')
    expect(fields?.confirm?.id).toBe('again')
    expect(fields?.change).toBe(true)
  })

  it('ne prend pas l’ancien champ pour une confirmation', () => {
    const document = mount(`
      <form>
        <label>Mot de passe actuel <input id="old" type="password" /></label>
        <label>Nouveau mot de passe <input id="new" type="password" /></label>
      </form>
    `)
    const fields = detectSignupFields(document)
    expect(fields?.password.id).toBe('new')
    expect(fields?.confirm).toBeNull()
    expect(fields?.change).toBe(true)
  })

  it('reconnaît un changement réduit à un seul nouveau champ', () => {
    const document = mount(`
      <form>
        <h2>Modifier mon mot de passe</h2>
        <input id="password" type="password" />
        <button>Mettre à jour</button>
      </form>
    `)
    const fields = detectSignupFields(document)
    expect(fields?.password.id).toBe('password')
    expect(fields?.change).toBe(true)
  })
})
