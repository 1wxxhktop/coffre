import { describe, expect, it } from 'vitest'
import {
  cardLast4,
  hostFromUrl,
  hostMatches,
  identityFullName,
  loginAllowsHost,
  searchCards,
  searchIdentities,
  searchLogins,
} from './extensionProtocol'
import type { CardItem, IdentityItem, LoginItem, VaultItem } from './types'

function login(
  id: string,
  title: string,
  username: string,
  urls: string[],
  extra: Partial<VaultItem> = {},
): VaultItem {
  return {
    id,
    vaultId: 'v1',
    type: 'login',
    title,
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    username,
    password: 'secret',
    urls,
    totp: '',
    ...extra,
  } as VaultItem
}

const items: VaultItem[] = [
  login('1', 'GitHub', 'studio26', ['https://github.com']),
  login('2', 'Gist', 'studio26', ['https://gist.github.com']),
  login('3', 'Proton Mail', 'ada@proton.me', [], { totp: 'otpauth://totp/x?secret=ABC' }),
  login('4', 'Supprimé', 'ada', ['https://github.com'], {
    deletedAt: '2026-02-01T00:00:00.000Z',
  }),
  {
    id: '5',
    vaultId: 'v1',
    type: 'note',
    title: 'Note GitHub',
    favorite: false,
    notes: 'github',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

describe('passerelle extension', () => {
  it('normalise les URL et compare les domaines', () => {
    expect(hostFromUrl('https://www.Example.com/login')).toBe('example.com')
    expect(hostFromUrl('example.com')).toBe('example.com')
    expect(hostFromUrl('pas une url')).toBe('')
    expect(hostMatches('example.com', 'login.example.com')).toBe(true)
    expect(hostMatches('example.com', 'example.org')).toBe(false)
  })

  it('retrouve les connexions par domaine', () => {
    const results = searchLogins(items, 'github.com')
    expect(results.map((entry) => entry.id).sort()).toEqual(['1', '2'])
    expect(results[0]).toMatchObject({ title: expect.any(String), host: expect.any(String) })
  })

  it('retrouve une connexion par texte', () => {
    const results = searchLogins(items, 'proton')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: '3',
      title: 'Proton Mail',
      username: 'ada@proton.me',
      hasTotp: true,
    })
  })

  it('liste les connexions actives sans requête', () => {
    const results = searchLogins(items, '')
    expect(results.map((entry) => entry.id).sort()).toEqual(['1', '2', '3'])
  })

  it('ne renvoie rien pour un domaine inconnu', () => {
    expect(searchLogins(items, 'inconnu.example')).toEqual([])
  })

  it('refuse un remplissage pour un autre domaine', () => {
    const github = items[0] as LoginItem
    const proton = items[2] as LoginItem
    expect(loginAllowsHost(github, 'github.com')).toBe(true)
    expect(loginAllowsHost(github, 'https://login.github.com/')).toBe(true)
    expect(loginAllowsHost(github, 'github.io')).toBe(false)
    expect(loginAllowsHost(github, 'evil.example')).toBe(false)
    expect(loginAllowsHost(proton, 'proton.me')).toBe(false)
    expect(loginAllowsHost(github, '')).toBe(false)
  })
})


describe('recherche de cartes et d’identités', () => {
  const card: CardItem = {
    id: 'c1',
    vaultId: 'v1',
    type: 'card',
    title: 'Visa perso',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cardholder: 'Ada Lovelace',
    number: '4242 4242 4242 4242',
    expiry: '12/28',
    cvc: '123',
    pin: '4321',
    brand: 'Visa',
  }
  const identity: IdentityItem = {
    id: 'i1',
    vaultId: 'v1',
    type: 'identity',
    title: 'Adresse perso',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+33 6 12 34 56 78',
    address: '1 rue de Paris',
    city: 'Paris',
    postalCode: '75001',
    country: 'France',
    birthDate: '1815-12-10',
    passportExpiry: '',
    idCardExpiry: '',
    licenseExpiry: '',
  }
  const entries: VaultItem[] = [card, identity]

  it('ne renvoie que des résumés non sensibles', () => {
    const cards = searchCards(entries, 'visa')
    expect(cards).toEqual([
      {
        id: 'c1',
        kind: 'card',
        title: 'Visa perso',
        brand: 'Visa',
        last4: '4242',
        expiry: '12/28',
      },
    ])
    expect(JSON.stringify(cards)).not.toContain('4242 4242')
    expect(cardLast4(card)).toBe('4242')
  })

  it('retrouve une identité par nom ou e-mail', () => {
    expect(identityFullName(identity)).toBe('Ada Lovelace')
    expect(searchIdentities(entries, 'lovelace')[0]).toMatchObject({
      id: 'i1',
      kind: 'identity',
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
    })
    expect(searchIdentities(entries, 'ada@example.com')).toHaveLength(1)
    expect(searchIdentities(entries, 'inconnu')).toEqual([])
  })
})
