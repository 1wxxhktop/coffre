import { describe, expect, it } from 'vitest'
import {
  autofillOnLoadBlocked,
  selectAutofillLogin,
} from './extensionAutofill'

describe('remplissage au chargement', () => {
  const base = {
    enabled: true,
    topFrame: true,
    protocol: 'https:',
    host: 'example.com',
    excluded: false,
  }

  it('accepte une page HTTPS autorisée dans le cadre principal', () => {
    expect(autofillOnLoadBlocked(base)).toBeNull()
  })

  it('refuse un réglage désactivé', () => {
    expect(autofillOnLoadBlocked({ ...base, enabled: false })).toBe('disabled')
  })

  it('refuse les iframes', () => {
    expect(autofillOnLoadBlocked({ ...base, topFrame: false })).toBe('frame')
  })

  it('refuse HTTP', () => {
    expect(autofillOnLoadBlocked({ ...base, protocol: 'http:' })).toBe(
      'insecure-context',
    )
  })

  it('refuse un hôte vide', () => {
    expect(autofillOnLoadBlocked({ ...base, host: '' })).toBe('invalid')
  })

  it('refuse un site exclu', () => {
    expect(autofillOnLoadBlocked({ ...base, excluded: true })).toBe('excluded')
  })

  it('choisit l’unique connexion correspondante', () => {
    expect(
      selectAutofillLogin(
        [
          { id: 'login-1', kind: 'login', host: 'example.com' },
          { id: 'login-2', kind: 'login', host: 'autre.test' },
        ],
        'example.com',
      ),
    ).toEqual({ itemId: 'login-1' })
  })

  it('accepte la variante www', () => {
    expect(
      selectAutofillLogin(
        [{ id: 'login-1', kind: 'login', host: 'www.example.com' }],
        'example.com',
      ),
    ).toEqual({ itemId: 'login-1' })
  })

  it('ne devine pas entre deux comptes', () => {
    expect(
      selectAutofillLogin(
        [
          { id: 'login-1', kind: 'login', host: 'example.com' },
          { id: 'login-2', kind: 'login', host: 'www.example.com' },
        ],
        'example.com',
      ),
    ).toEqual({ error: 'multiple' })
  })

  it('ignore les éléments qui ne sont pas des connexions', () => {
    expect(
      selectAutofillLogin(
        [
          { id: 'card-1', kind: 'card', host: 'example.com' },
          { id: 'login-1', kind: 'login', host: 'example.com' },
        ],
        'example.com',
      ),
    ).toEqual({ itemId: 'login-1' })
  })

  it('ignore les identifiants et hôtes invalides', () => {
    expect(
      selectAutofillLogin(
        [
          { id: '', kind: 'login', host: 'example.com' },
          { id: 'login-2', kind: 'login', host: '' },
          { id: 'login-3', kind: 'login', host: 'example.com' },
        ],
        'example.com',
      ),
    ).toEqual({ itemId: 'login-3' })
  })

  it('ne correspond pas à un sous-domaine arbitraire', () => {
    expect(
      selectAutofillLogin(
        [{ id: 'login-1', kind: 'login', host: 'app.example.com' }],
        'example.com',
      ),
    ).toEqual({ error: 'not-found' })
  })

  it('déduplique un même identifiant renvoyé deux fois', () => {
    expect(
      selectAutofillLogin(
        [
          { id: 'login-1', kind: 'login', host: 'example.com' },
          { id: 'login-1', kind: 'login', host: 'www.example.com' },
        ],
        'example.com',
      ),
    ).toEqual({ itemId: 'login-1' })
  })
})
