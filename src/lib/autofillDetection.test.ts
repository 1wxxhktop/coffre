// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import {
  canFillCard,
  detectAutofillFields,
  detectCardFields,
  detectIdentityFields,
  fillDetectedCard,
  fillDetectedIdentity,
  fillFieldsByLabel,
  isPaymentProviderHost,
  readCardValues,
  readIdentityValues,
} from '../../extension/detect'

const input = (attributes: string) => `<input ${attributes} />`

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

describe('détection de carte bancaire', () => {
  it('reconnaît les attributs autocomplete standard', () => {
    const document = mount(`
      <form>
        ${input('name="ccname" autocomplete="cc-name"')}
        ${input('name="cardnumber" autocomplete="cc-number"')}
        ${input('name="exp" autocomplete="cc-exp"')}
        ${input('name="cvc" autocomplete="cc-csc"')}
      </form>
    `)
    const fields = detectCardFields(document)
    expect(fields).not.toBeNull()
    expect(fields?.cardholder?.name).toBe('ccname')
    expect(fields?.number?.name).toBe('cardnumber')
    expect(fields?.expiry?.name).toBe('exp')
    expect(fields?.cvc?.name).toBe('cvc')
  })

  it('reconnaît les libellés français et les champs mois/année', () => {
    const document = mount(`
      <form>
        <label for="n">Numéro de carte</label>${input('id="n"')}
        <label for="m">Mois d’expiration</label>${input('id="m"')}
        <label for="y">Année d’expiration</label>${input('id="y"')}
        <label for="c">Code de sécurité</label>${input('id="c"')}
        <label for="t">Titulaire</label>${input('id="t"')}
      </form>
    `)
    const fields = detectCardFields(document)
    expect(fields).not.toBeNull()
    expect(fields?.number?.id).toBe('n')
    expect(fields?.expiryMonth?.id).toBe('m')
    expect(fields?.expiryYear?.id).toBe('y')
    expect(fields?.cvc?.id).toBe('c')
    expect(fields?.cardholder?.id).toBe('t')
  })

  it('ignore les champs cachés', () => {
    const document = mount(`
      <form>
        ${input('name="decoy" autocomplete="cc-number" style="display:none"')}
        ${input('id="n" autocomplete="cc-number"')}
        ${input('id="e" autocomplete="cc-exp"')}
      </form>
    `)
    const fields = detectCardFields(document)
    expect(fields?.number?.id).toBe('n')
  })

  it('ne confond pas un formulaire de connexion avec une carte', () => {
    const document = mount(`
      <form>
        ${input('name="user" autocomplete="username"')}
        ${input('name="pass" type="password" autocomplete="current-password"')}
      </form>
    `)
    expect(detectCardFields(document)).toBeNull()
    expect(detectAutofillFields(document)?.kind).toBe('login')
  })

  it('remplit le CVC et le PIN seulement sur demande explicite', () => {
    const document = mount(`
      <form>
        ${input('id="n" autocomplete="cc-number"')}
        ${input('id="e" autocomplete="cc-exp"')}
        ${input('id="c" autocomplete="cc-csc"')}
        ${input('id="p" name="card pin"')}
      </form>
    `)
    const fields = detectCardFields(document)!
    const values = {
      cardholder: 'Ada Lovelace',
      number: '4242424242424242',
      expiry: '12/28',
      cvc: '123',
      pin: '4321',
      brand: 'Visa',
    }

    expect(fillDetectedCard(fields, values, false)).toBe(2)
    expect((document.getElementById('n') as HTMLInputElement).value).toBe(
      '4242424242424242',
    )
    expect((document.getElementById('e') as HTMLInputElement).value).toBe('12/28')
    expect((document.getElementById('c') as HTMLInputElement).value).toBe('')
    expect((document.getElementById('p') as HTMLInputElement).value).toBe('')

    expect(fillDetectedCard(fields, values, true)).toBe(4)
    expect((document.getElementById('c') as HTMLInputElement).value).toBe('123')
    expect((document.getElementById('p') as HTMLInputElement).value).toBe('4321')
  })
})

describe('détection d’identité', () => {
  it('reconnaît un formulaire d’adresse français', () => {
    const document = mount(`
      <form>
        <label for="p">Prénom</label>${input('id="p"')}
        <label for="n">Nom</label>${input('id="n"')}
        <label for="a">Adresse</label>${input('id="a"')}
        <label for="v">Ville</label>${input('id="v"')}
        <label for="cp">Code postal</label>${input('id="cp"')}
        <label for="pa">Pays</label>${input('id="pa"')}
      </form>
    `)
    const fields = detectIdentityFields(document)
    expect(fields).not.toBeNull()
    expect(fields?.firstName?.id).toBe('p')
    expect(fields?.lastName?.id).toBe('n')
    expect(fields?.address?.id).toBe('a')
    expect(fields?.city?.id).toBe('v')
    expect(fields?.postalCode?.id).toBe('cp')
    expect(fields?.country?.id).toBe('pa')
  })

  it('remplit et relit les valeurs', () => {
    const document = mount(`
      <form>
        ${input('id="e" type="email" autocomplete="email"')}
        ${input('id="t" type="tel" autocomplete="tel"')}
        ${input('id="a" autocomplete="street-address"')}
        ${input('id="c" autocomplete="address-level2"')}
        ${input('id="z" autocomplete="postal-code"')}
        ${input('id="p" autocomplete="country-name"')}
      </form>
    `)
    const fields = detectIdentityFields(document)!
    const filled = fillDetectedIdentity(fields, {
      fullName: '',
      firstName: '',
      lastName: '',
      email: 'ada@example.com',
      phone: '+33 6 12 34 56 78',
      address: '1 rue de Paris',
      city: 'Paris',
      postalCode: '75001',
      country: 'France',
    })
    expect(filled).toBe(6)
    expect(readIdentityValues(fields)).toMatchObject({
      email: 'ada@example.com',
      phone: '+33 6 12 34 56 78',
      address: '1 rue de Paris',
      city: 'Paris',
      postalCode: '75001',
      country: 'France',
    })
  })

  it('remplit des champs personnalisés par libellé', () => {
    const document = mount(`
      <form>
        <label for="h">Hôte</label>${input('id="h"')}
        <label for="k">Clé API</label>${input('id="k"')}
      </form>
    `)
    const filled = fillFieldsByLabel([
      { label: 'Hôte', value: 'serveur.example' },
      { label: 'Clé API', value: 'secret' },
    ])
    expect(filled).toBe(2)
    expect((document.getElementById('h') as HTMLInputElement).value).toBe(
      'serveur.example',
    )
    expect((document.getElementById('k') as HTMLInputElement).value).toBe('secret')
  })

  it('relit une carte saisie', () => {
    const document = mount(`
      <form>
        ${input('id="n" autocomplete="cc-number" value="4242424242424242"')}
        ${input('id="m" autocomplete="cc-exp-month" value="12"')}
        ${input('id="y" autocomplete="cc-exp-year" value="2028"')}
        ${input('id="c" autocomplete="cc-csc" value="123"')}
        ${input('id="t" autocomplete="cc-name" value="Ada Lovelace"')}
      </form>
    `)
    const fields = detectCardFields(document)!
    expect(readCardValues(fields)).toMatchObject({
      number: '4242424242424242',
      expiry: '12/2028',
      cvc: '123',
      cardholder: 'Ada Lovelace',
    })
  })
})

describe('origines de paiement', () => {
  it('autorise les prestataires connus et leurs sous-domaines', () => {
    expect(isPaymentProviderHost('js.stripe.com')).toBe(true)
    expect(isPaymentProviderHost('checkout.adyen.com')).toBe(true)
    expect(isPaymentProviderHost('paypal.com')).toBe(true)
    expect(isPaymentProviderHost('example.com')).toBe(false)
    expect(isPaymentProviderHost('stripe.com.evil.example')).toBe(false)
  })

  it('exige HTTPS et limite les iframes tierces aux prestataires connus', () => {
    expect(canFillCard('https:', false, 'example.com')).toBe(true)
    expect(canFillCard('http:', false, 'example.com')).toBe(false)
    expect(canFillCard('https:', true, 'example.com')).toBe(false)
    expect(canFillCard('https:', true, 'js.stripe.com')).toBe(true)
  })
})
