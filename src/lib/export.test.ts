import { describe, expect, it } from 'vitest'
import { exportCsv } from './export'
import { parseImport } from './import'
import type {
  CardItem,
  CustomField,
  IdentityItem,
  LoginItem,
  NoteItem,
  VaultSummary,
} from './types'

const NOW = '2026-11-08T10:00:00.000Z'
const VAULT_ID = 'v_personnel'

const vault: VaultSummary = {
  id: VAULT_ID,
  name: 'Personnel',
  role: 'write',
  createdAt: NOW,
  updatedAt: NOW,
  itemCount: 1,
}

function login(overrides: Partial<LoginItem> = {}): LoginItem {
  return {
    id: 'i_login',
    vaultId: VAULT_ID,
    type: 'login',
    title: 'GitHub',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: NOW,
    updatedAt: NOW,
    username: 'studio26',
    password: 's3cret!',
    urls: ['https://github.com'],
    totp: '',
    ...overrides,
  }
}

function note(overrides: Partial<NoteItem> = {}): NoteItem {
  return {
    id: 'i_note',
    vaultId: VAULT_ID,
    type: 'note',
    title: 'Note interne',
    favorite: false,
    notes: 'Contenu de la note',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function card(overrides: Partial<CardItem> = {}): CardItem {
  return {
    id: 'i_card',
    vaultId: VAULT_ID,
    type: 'card',
    title: 'Carte perso',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: NOW,
    updatedAt: NOW,
    cardholder: 'Ada Lovelace',
    number: '4242 4242 4242 4242',
    expiry: '12/28',
    cvc: '123',
    pin: '4567',
    brand: 'Visa',
    ...overrides,
  }
}

function identity(overrides: Partial<IdentityItem> = {}): IdentityItem {
  return {
    id: 'i_identity',
    vaultId: VAULT_ID,
    type: 'identity',
    title: 'Identité',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: NOW,
    updatedAt: NOW,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+33 1 23 45 67 89',
    address: '1 rue de Paris',
    city: 'Paris',
    postalCode: '75001',
    country: 'France',
    birthDate: '1815-12-10',
    passportExpiry: '',
    idCardExpiry: '',
    licenseExpiry: '',
    ...overrides,
  }
}

describe('export CSV Mots de passe (Apple)', () => {
  it('produit l’en-tête exact, des lignes CRLF et les connexions actives', () => {
    const result = exportCsv([login()], [vault], 'apple')

    expect(result.filename).toMatch(/^mots-de-passe-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(result.exported).toBe(1)
    expect(result.content.startsWith('Title,URL,Username,Password,Notes,OTPAuth\r\n')).toBe(
      true,
    )
    expect(result.content).toContain(
      'GitHub,https://github.com,studio26,s3cret!,Coffre : Personnel,',
    )
    expect(result.content.endsWith('\r\n')).toBe(true)
  })

  it('échappe les virgules, guillemets et retours à la ligne', () => {
    const result = exportCsv(
      [
        login({
          title: 'Compte, "pro"',
          username: 'ada',
          password: 'ligne1\nligne2',
          notes: 'Note, avec "guillemets"',
        }),
      ],
      [vault],
      'apple',
    )

    expect(result.content).toContain('"Compte, ""pro"""')
    expect(result.content).toContain('"ligne1\nligne2"')
    expect(result.content).toContain('"Note, avec ""guillemets""')
  })

  it('conserve les champs, étiquettes et URL supplémentaires dans les notes', () => {
    const field: CustomField = {
      id: 'f_api',
      label: 'Clé API',
      value: 'abc,123',
      type: 'hidden',
    }
    const result = exportCsv(
      [
        login({
          urls: ['https://github.com', 'https://gist.github.com'],
          tags: ['travail', 'perso'],
          customFields: [field],
        }),
      ],
      [vault],
      'apple',
    )

    expect(result.content).toContain('Clé API : abc,123')
    expect(result.content).toContain('Étiquettes : travail, perso')
    expect(result.content).toContain('Coffre : Personnel')
    expect(result.content).toContain('Autres URL : https://gist.github.com')
  })

  it('ajoute https:// aux URL sans schéma', () => {
    const result = exportCsv([login({ urls: ['github.com'] })], [vault], 'apple')
    expect(result.content).toContain(',https://github.com,studio26,')
  })

  it('signale les connexions sans mot de passe ou sans URL', () => {
    const result = exportCsv([login({ password: '', urls: [''] })], [vault], 'apple')
    expect(result.warnings.join(' ')).toContain('sans mot de passe ou sans URL')
  })

  it('convertit un secret TOTP base32 en URI OTPAuth', () => {
    const result = exportCsv(
      [login({ totp: 'JBSWY3DPEHPK3PXP' })],
      [vault],
      'apple',
    )

    expect(result.content).toContain(
      'otpauth://totp/GitHub?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
    )
  })

  it('ignore les éléments non-connexion et la corbeille', () => {
    const result = exportCsv(
      [
        login(),
        note(),
        card(),
        login({ id: 'i_trash', deletedAt: '2026-11-07T10:00:00.000Z' }),
      ],
      [vault],
      'apple',
    )

    expect(result.exported).toBe(1)
    expect(result.skipped).toBe(3)
    expect(result.warnings.join(' ')).toMatch(/2 éléments non exportés/)
    expect(result.warnings.join(' ')).toMatch(/1 élément en corbeille/)
  })

  it('peut être réimporté par le parseur CSV de Coffre', () => {
    const parsed = parseImport(
      exportCsv([login({ customFields: [{ id: 'f1', label: 'API', value: 'abc', type: 'text' }] })], [vault], 'apple').content,
      'v_import',
    )

    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]).toMatchObject({
      type: 'login',
      title: 'GitHub',
      username: 'studio26',
      password: 's3cret!',
      urls: ['https://github.com'],
    })
    expect(parsed.items[0].notes).toContain('API : abc')
  })
})

describe('export CSV complet Coffre', () => {
  it('exporte tous les types avec leurs champs propres', () => {
    const result = exportCsv(
      [login(), note(), card(), identity()],
      [vault],
      'coffre',
    )

    expect(result.filename).toMatch(/^coffre-complet-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(result.exported).toBe(4)
    expect(result.content).toContain('type,title,url,username,password')
    expect(result.content).toContain('Ada Lovelace')
    expect(result.content).toContain('4242 4242 4242 4242')
    expect(result.content).toContain('ada@example.com')
    expect(result.content).toContain('Contenu de la note')
  })

  it('conserve les champs personnalisés et les adresses multiples', () => {
    const field: CustomField = {
      id: 'f_api',
      label: 'Clé API',
      value: 'abc-123',
      type: 'hidden',
    }
    const result = exportCsv(
      [
        login({
          urls: ['https://github.com', 'https://gist.github.com'],
          customFields: [field],
          tags: ['travail'],
        }),
      ],
      [vault],
      'coffre',
    )

    expect(result.content).toContain('https://github.com\nhttps://gist.github.com')
    expect(result.content).toContain(',travail,')
    expect(result.content).toContain('Clé API')
    expect(result.content).toContain('abc-123')
  })

  it('se réimporte en conservant types, champs et cartes', () => {
    const parsed = parseImport(
      exportCsv(
        [
          login({
            urls: ['https://github.com', 'https://gist.github.com'],
            customFields: [
              { id: 'f1', label: 'Clé API', value: 'abc-123', type: 'hidden' },
            ],
          }),
          note(),
          card(),
          identity(),
        ],
        [vault],
        'coffre',
      ).content,
      'v_import',
    )

    expect(parsed.items.map((item) => item.type)).toEqual([
      'login',
      'note',
      'card',
      'identity',
    ])
    expect(parsed.items[0]).toMatchObject({
      urls: ['https://github.com', 'https://gist.github.com'],
    })
    expect(parsed.items[0].customFields).toEqual([
      expect.objectContaining({
        label: 'Clé API',
        value: 'abc-123',
        type: 'hidden',
      }),
    ])
    expect(parsed.items[2]).toMatchObject({
      type: 'card',
      number: '4242 4242 4242 4242',
      cardholder: 'Ada Lovelace',
    })
    expect(parsed.items[3]).toMatchObject({
      type: 'identity',
      firstName: 'Ada',
      email: 'ada@example.com',
    })
  })

  it('exclut la corbeille et signale les pièces jointes', () => {
    const result = exportCsv(
      [
        login({
          attachments: [
            {
              id: 'a1',
              name: 'note.txt',
              mime: 'text/plain',
              size: 12,
              createdAt: NOW,
            },
          ],
        }),
        note({ id: 'i_trash', deletedAt: '2026-11-07T10:00:00.000Z' }),
      ],
      [vault],
      'coffre',
    )

    expect(result.exported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.warnings.join(' ')).toMatch(/1 pièce jointe non incluse/)
  })
})
