import { describe, expect, it } from 'vitest'
import {
  EXPIRY_HORIZON_DAYS,
  cardExpiryDate,
  collectExpiries,
  dateOnly,
  daysUntil,
  expiryBadgeLabel,
  expiryDescription,
  expiryTone,
  formatExpiryDate,
  itemExpiryCandidates,
  nextExpiry,
  normalizeDateOnly,
  parseDateOnly,
} from './expiry'
import type { CardItem, IdentityItem, LoginItem, NoteItem, VaultItem } from './types'

const NOW = new Date(2026, 10, 8) // 8 novembre 2026, heure locale.
const STAMP = '2026-11-08T10:00:00.000Z'

function base() {
  return {
    vaultId: 'v1',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: STAMP,
    updatedAt: STAMP,
  }
}

function login(overrides: Partial<LoginItem> = {}): LoginItem {
  return {
    ...base(),
    id: 'i_login',
    type: 'login',
    title: 'GitHub',
    username: 'ada',
    password: 'secret',
    urls: ['https://github.com'],
    totp: '',
    ...overrides,
  }
}

function card(overrides: Partial<CardItem> = {}): CardItem {
  return {
    ...base(),
    id: 'i_card',
    type: 'card',
    title: 'Carte',
    cardholder: 'Ada',
    number: '4242',
    expiry: '11/26',
    cvc: '',
    pin: '',
    brand: '',
    ...overrides,
  }
}

function identity(overrides: Partial<IdentityItem> = {}): IdentityItem {
  return {
    ...base(),
    id: 'i_identity',
    type: 'identity',
    title: 'Ada',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: '',
    phone: '',
    address: '',
    city: '',
    postalCode: '',
    country: '',
    birthDate: '',
    passportExpiry: '',
    idCardExpiry: '',
    licenseExpiry: '',
    ...overrides,
  }
}

function note(overrides: Partial<NoteItem> = {}): NoteItem {
  return {
    ...base(),
    id: 'i_note',
    type: 'note',
    title: 'Licence',
    ...overrides,
  }
}

describe('dates d’échéance', () => {
  it('analyse les dates locales sans décalage de fuseau', () => {
    const date = parseDateOnly('2026-11-08')
    expect(date).not.toBeNull()
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(10)
    expect(date?.getDate()).toBe(8)
    expect(dateOnly(date!)).toBe('2026-11-08')

    expect(parseDateOnly('2026-02-29')).toBeNull()
    expect(parseDateOnly('2024-02-29')).not.toBeNull()
    expect(parseDateOnly('2026-13-01')).toBeNull()
    expect(parseDateOnly('08/11/2026')).toBeNull()
    expect(normalizeDateOnly('2026-11-08')).toBe('2026-11-08')
    expect(normalizeDateOnly('inconnue')).toBe('')
  })

  it('calcule le dernier jour du mois d’une carte', () => {
    expect(dateOnly(cardExpiryDate('12/28')!)).toBe('2028-12-31')
    expect(dateOnly(cardExpiryDate('02/27')!)).toBe('2027-02-28')
    expect(dateOnly(cardExpiryDate('2/2028')!)).toBe('2028-02-29')
    expect(cardExpiryDate('13/28')).toBeNull()
    expect(cardExpiryDate('')).toBeNull()
  })

  it('compte les jours calendaires', () => {
    expect(daysUntil(new Date(2026, 10, 8), NOW)).toBe(0)
    expect(daysUntil(new Date(2026, 10, 9), NOW)).toBe(1)
    expect(daysUntil(new Date(2026, 10, 1), NOW)).toBe(-7)
  })
})

describe('collecte des échéances', () => {
  it('déclare les rappels, cartes et documents d’identité', () => {
    expect(
      itemExpiryCandidates(login({ expiresAt: '2026-12-01' })),
    ).toEqual([
      {
        date: '2026-12-01',
        label: 'Mot de passe à changer',
        kind: 'item',
      },
    ])

    expect(itemExpiryCandidates(card())).toEqual([
      { date: '2026-11-30', label: 'Carte bancaire', kind: 'card' },
    ])

    expect(
      itemExpiryCandidates(
        identity({
          passportExpiry: '2027-01-15',
          idCardExpiry: '2026-12-01',
          licenseExpiry: '2026-10-01',
        }),
      ),
    ).toEqual([
      { date: '2027-01-15', label: 'Passeport', kind: 'passport' },
      { date: '2026-12-01', label: 'Carte d’identité', kind: 'id-card' },
      { date: '2026-10-01', label: 'Permis de conduire', kind: 'license' },
    ])
  })

  it('trie les échéances proches, ignore les lointaines et la corbeille', () => {
    const items: VaultItem[] = [
      login({ id: 'a', title: 'GitHub', expiresAt: '2026-11-20' }),
      card({ id: 'b', title: 'Carte perso', expiry: '11/26' }),
      identity({
        id: 'c',
        title: 'Ada',
        passportExpiry: '2027-01-15', // au-delà de l’horizon
        idCardExpiry: '2026-12-01',
        licenseExpiry: '2026-10-01',
      }),
      note({ id: 'd', title: 'Licence', expiresAt: '2026-12-15' }),
      login({
        id: 'e',
        title: 'Supprimé',
        expiresAt: '2026-11-10',
        deletedAt: '2026-11-01T00:00:00.000Z',
      }),
    ]

    const events = collectExpiries(items, NOW)
    expect(events.map((event) => [event.item.id, event.kind, event.date])).toEqual([
      ['c', 'license', '2026-10-01'],
      ['a', 'item', '2026-11-20'],
      ['b', 'card', '2026-11-30'],
      ['c', 'id-card', '2026-12-01'],
      ['d', 'item', '2026-12-15'],
    ])
    expect(events[0].daysLeft).toBe(-38)
    expect(events[1].daysLeft).toBe(12)
    expect(events.every((event) => event.daysLeft <= EXPIRY_HORIZON_DAYS)).toBe(true)
  })

  it('renvoie l’échéance la plus proche d’un élément', () => {
    const item = identity({
      passportExpiry: '2027-01-15',
      idCardExpiry: '2026-12-01',
    })
    expect(nextExpiry(item, NOW)).toMatchObject({
      kind: 'id-card',
      date: '2026-12-01',
      daysLeft: 23,
    })
    expect(nextExpiry(note(), NOW)).toBeNull()
  })
})

describe('affichage des échéances', () => {
  it('produit des libellés courts et explicites', () => {
    expect(expiryBadgeLabel(-3)).toBe('Expiré')
    expect(expiryBadgeLabel(0)).toBe('Aujourd’hui')
    expect(expiryBadgeLabel(12)).toBe('J-12')
    expect(expiryDescription(-3)).toBe('Expiré depuis 3 jours')
    expect(expiryDescription(0)).toBe('Expire aujourd’hui')
    expect(expiryDescription(1)).toBe('Expire demain')
    expect(expiryDescription(12)).toBe('Expire dans 12 jours')
  })

  it('choisit le ton visuel selon l’urgence', () => {
    expect(expiryTone(-1)).toBe('danger')
    expect(expiryTone(0)).toBe('warning')
    expect(expiryTone(30)).toBe('warning')
    expect(expiryTone(31)).toBe('neutral')
  })

  it('formate une date française', () => {
    expect(formatExpiryDate('2026-12-01')).toMatch(/1.*déc.*2026/)
    expect(formatExpiryDate('')).toBe('—')
  })
})
