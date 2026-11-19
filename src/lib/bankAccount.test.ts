import { describe, expect, it } from 'vitest'
import { createItem, createVaultFile, parseItemContent, unlockVaultFile } from './vault'
import { emptyDraft, itemSubtitle, itemTypeLabel, type ItemDraft } from './types'
import { searchableText } from './vaultSearch'

const PASSWORD = 'phrase de passe de test solide'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

describe('élément compte bancaire', () => {
  it('initialise les champs', () => {
    const draft = emptyDraft('bank-account', 'v1')
    expect(draft.type).toBe('bank-account')
    if (draft.type !== 'bank-account') throw new Error('type compte bancaire attendu')
    expect(draft.accountHolder).toBe('')
    expect(draft.bankName).toBe('')
    expect(draft.iban).toBe('')
    expect(draft.swift).toBe('')
    expect(draft.accountNumber).toBe('')
    expect(draft.routingNumber).toBe('')
    expect(draft.branch).toBe('')
    expect(draft.currency).toBe('')
    expect(draft.username).toBe('')
    expect(draft.password).toBe('')
    expect(draft.urls).toEqual([''])
  })

  it('valide un contenu déchiffré', () => {
    const content = parseItemContent({
      type: 'bank-account',
      title: 'Compte courant',
      favorite: false,
      notes: '',
      tags: [],
      customFields: [],
      attachments: [],
      deletedAt: null,
      expiresAt: '',
      username: 'ada@example.com',
      password: 'mot-de-passe-du-site',
      urls: ['https://banque.example.com'],
      accountHolder: 'Ada Lovelace',
      bankName: 'Banque de test',
      iban: 'FR76 3000 6000 0112 3456 7890 189',
      swift: 'AGRIFRPP',
      accountNumber: '123456789',
      routingNumber: '12-34-56',
      branch: 'Paris',
      currency: 'EUR',
      cardholder: 'Ada Lovelace',
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/29',
      cardCvc: '123',
      cardPin: '1234',
      cardBrand: 'Visa',
    })
    expect(content.type).toBe('bank-account')
    if (content.type !== 'bank-account') throw new Error('type compte bancaire attendu')
    expect(content.iban).toBe('FR76 3000 6000 0112 3456 7890 189')
    expect(content.username).toBe('ada@example.com')
    expect(content.password).toBe('mot-de-passe-du-site')
    expect(content.urls).toEqual(['https://banque.example.com'])
    const searchable = searchableText({
      ...content,
      id: 'i',
      vaultId: 'v',
      createdAt: '',
      updatedAt: '',
    })
    expect(searchable).toContain('ada@example.com')
    expect(searchable).toContain('banque.example.com')
    expect(searchable).not.toContain('mot-de-passe-du-site')
    expect(itemSubtitle({ ...content, id: 'i', vaultId: 'v', createdAt: '', updatedAt: '' })).toBe(
      'Banque de test · •••• 0189 · ada@example.com',
    )
    expect(itemTypeLabel('bank-account')).toBe('Compte et carte')
    expect(
      itemSubtitle({
        ...content,
        id: 'i',
        vaultId: 'v',
        createdAt: '',
        updatedAt: '',
        iban: '',
        bankName: '',
      }),
    ).toBe('Visa · •••• 4242 · ada@example.com')
  })

  it('nettoie et normalise les coordonnées bancaires', async () => {
    const opened = await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
    const vaultId = opened.vaults[0].id
    const created = await createItem(opened.file, opened.session, {
      ...emptyDraft('bank-account', vaultId),
      title: 'Compte courant',
      username: '  ada@example.com ',
      password: '  mot-de-passe-du-site  ',
      urls: [' https://banque.example.com ', '', 'https://cartes.example.com'],
      accountHolder: '  Ada Lovelace ',
      bankName: '  Banque de test ',
      iban: ' fr76  3000 6000 0112 3456 7890 189 ',
      swift: ' agri frpp ',
      accountNumber: ' 123456789 ',
      routingNumber: ' 12-34-56 ',
      branch: ' Paris ',
      currency: ' eur ',
      cardholder: '  Ada Lovelace ',
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/29',
      cardCvc: '123',
      cardPin: '1234',
      cardBrand: ' Visa ',
    } as ItemDraft)

    const unlocked = await unlockVaultFile(created.file, PASSWORD)
    const item = unlocked.items[0]
    expect(item.type).toBe('bank-account')
    if (item.type !== 'bank-account') throw new Error('type compte bancaire attendu')
    expect(item.username).toBe('ada@example.com')
    expect(item.password).toBe('  mot-de-passe-du-site  ')
    expect(item.urls).toEqual([
      'https://banque.example.com',
      'https://cartes.example.com',
    ])
    expect(item.accountHolder).toBe('Ada Lovelace')
    expect(item.bankName).toBe('Banque de test')
    expect(item.iban).toBe('FR76 3000 6000 0112 3456 7890 189')
    expect(item.swift).toBe('AGRIFRPP')
    expect(item.accountNumber).toBe('123456789')
    expect(item.routingNumber).toBe('12-34-56')
    expect(item.branch).toBe('Paris')
    expect(item.currency).toBe('EUR')
    expect(item.cardholder).toBe('Ada Lovelace')
    expect(item.cardNumber).toBe('4242 4242 4242 4242')
    expect(item.cardExpiry).toBe('12/29')
    expect(item.cardCvc).toBe('123')
    expect(item.cardPin).toBe('1234')
    expect(item.cardBrand).toBe('Visa')
  })
})
