import { describe, expect, it } from 'vitest'
import { buildContextMenuModel } from '../../extension/contextMenuModel'
import type {
  ExtensionAutofillSummary,
  ExtensionLoginSummary,
} from './extensionProtocol'

function login(id: string, host: string): ExtensionLoginSummary {
  return { id, title: id, username: 'ada', host, hasTotp: false }
}

const logins: ExtensionAutofillSummary[] = [
  login('github', 'github.com'),
  login('evil', 'evil.example'),
]
const cards: ExtensionAutofillSummary[] = [
  {
    id: 'visa',
    kind: 'card',
    title: 'Visa perso',
    brand: 'Visa',
    last4: '4242',
    expiry: '12/28',
  },
]
const identities: ExtensionAutofillSummary[] = [
  {
    id: 'adresse',
    kind: 'identity',
    title: 'Adresse perso',
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
  },
]

describe('menu contextuel', () => {
  it('ne montre que les connexions du domaine actif', () => {
    const model = buildContextMenuModel({
      unlocked: true,
      host: 'github.com',
      logins,
      cards,
      identities,
    })
    const titles = model
      .filter((entry) => entry.parentId === 'fill-login')
      .map((entry) => entry.title)
    expect(titles).toEqual(['github'])
    expect(titles).not.toContain('evil')
    expect(model.some((entry) => entry.id === 'fill-login:evil')).toBe(false)
  })

  it('propose de choisir la connexion sans permission d’hôte', () => {
    const model = buildContextMenuModel({
      unlocked: true,
      host: '',
      logins,
      cards,
      identities,
    })
    expect(model.find((entry) => entry.id === 'fill-login-choose')).toMatchObject(
      { parentId: 'fill-login', titleKey: 'context_chooseLogin' },
    )
  })

  it('liste les cartes et identités disponibles', () => {
    const model = buildContextMenuModel({
      unlocked: true,
      host: 'github.com',
      logins,
      cards,
      identities,
    })
    expect(model.find((entry) => entry.id === 'fill-card:visa')?.title).toBe(
      'Visa perso',
    )
    expect(
      model.find((entry) => entry.id === 'fill-identity:adresse')?.title,
    ).toBe('Adresse perso')
  })

  it('masque les actions de remplissage quand le site est exclu', () => {
    const model = buildContextMenuModel({
      unlocked: true,
      fillAllowed: false,
      host: 'github.com',
      logins,
      cards,
      identities,
    })
    expect(model.map((entry) => entry.id)).toEqual(['open-app', 'add-site'])
  })

  it('ne garde que « Déverrouiller Coffre » quand le coffre est verrouillé', () => {
    const model = buildContextMenuModel({
      unlocked: false,
      host: 'github.com',
      logins,
      cards,
      identities,
    })
    expect(model).toEqual([
      { id: 'unlock', titleKey: 'context_unlock', contexts: ['all'] },
    ])
  })
})
