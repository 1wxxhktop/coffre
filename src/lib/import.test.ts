import { describe, expect, it } from 'vitest'
import dashlaneJson from './__fixtures__/dashlane-export.json?raw'
import onepasswordCsv from './__fixtures__/imports/1password8.csv?raw'
import bitwardenCsv from './__fixtures__/imports/bitwarden.csv?raw'
import chromeCsv from './__fixtures__/imports/chrome.csv?raw'
import dashlaneCsv from './__fixtures__/imports/dashlane.csv?raw'
import firefoxCsv from './__fixtures__/imports/firefox.csv?raw'
import keepassCsv from './__fixtures__/imports/keepass.csv?raw'
import keeperCsv from './__fixtures__/imports/keeper.csv?raw'
import lastpassCsv from './__fixtures__/imports/lastpass.csv?raw'
import nordpassCsv from './__fixtures__/imports/nordpass.csv?raw'
import roboformCsv from './__fixtures__/imports/roboform.csv?raw'
import safeincloudCsv from './__fixtures__/imports/safeincloud.csv?raw'
import keepassXml from './__fixtures__/keepass-export.xml?raw'
import {
  dedupeImport,
  detectImportFormat,
  ImportError,
  importSourceLabel,
  parseImport,
  type ParsedImport,
} from './import'

const VAULT_ID = 'v_test'

function loginItem(parsed: ParsedImport, index = 0) {
  const item = parsed.items[index]
  if (item.type !== 'login') throw new Error('Élément de connexion attendu')
  return item
}

describe('import Bitwarden JSON', () => {
  it('convertit les quatre types et les champs personnalisés', () => {
    const parsed = parseImport(
      JSON.stringify({
        encrypted: false,
        folders: [{ id: 'folder-1', name: 'Travail' }],
        items: [
          {
            type: 1,
            name: 'GitHub',
            notes: 'Compte principal',
            favorite: true,
            folderId: 'folder-1',
            login: {
              username: 'studio26',
              password: 's3cret!',
              totp: 'otpauth://totp/GitHub?secret=ABC',
              uris: [{ uri: 'https://github.com' }, { uri: 'https://gist.github.com' }],
            },
            fields: [{ name: 'Clé API', value: 'abc-123', type: 1 }],
          },
          { type: 2, name: 'Note interne', notes: 'Contenu' },
          {
            type: 3,
            name: 'Carte perso',
            card: {
              cardholderName: 'Ada Lovelace',
              number: '4242424242424242',
              expMonth: '12',
              expYear: '2028',
              code: '123',
              brand: 'Visa',
            },
          },
          {
            type: 4,
            name: 'Identité',
            identity: {
              firstName: 'Ada',
              lastName: 'Lovelace',
              email: 'ada@example.com',
              address1: '1 rue de Paris',
              city: 'Paris',
              postalCode: '75001',
              country: 'France',
            },
          },
          { type: 1, name: 'Supprimé', deletedDate: '2026-01-01' },
        ],
      }),
      VAULT_ID,
    )

    expect(parsed.format).toBe('bitwarden-json')
    expect(parsed.items).toHaveLength(4)
    expect(parsed.items[0]).toMatchObject({
      type: 'login',
      vaultId: VAULT_ID,
      title: 'GitHub',
      username: 'studio26',
      password: 's3cret!',
      favorite: true,
      tags: ['Travail'],
      urls: ['https://github.com', 'https://gist.github.com'],
    })
    expect(parsed.items[0].customFields[0]).toMatchObject({
      label: 'Clé API',
      value: 'abc-123',
      type: 'hidden',
    })
    expect(parsed.items[1]).toMatchObject({ type: 'note', notes: 'Contenu' })
    expect(parsed.items[2]).toMatchObject({
      type: 'card',
      number: '4242424242424242',
      expiry: '12/28',
      cvc: '123',
      brand: 'Visa',
    })
    expect(parsed.items[3]).toMatchObject({
      type: 'identity',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    })
  })

  it('refuse un export chiffré', () => {
    expect(() =>
      parseImport(JSON.stringify({ encrypted: true, items: [] }), VAULT_ID),
    ).toThrow(ImportError)
  })

  it('refuse un fichier .coffre', () => {
    expect(() =>
      parseImport(JSON.stringify({ format: 'coffre', version: 1 }), VAULT_ID),
    ).toThrow(/coffre Coffre/)
  })
})

describe('import Proton Pass JSON', () => {
  const protonExport = {
    version: '1.0.0',
    userId: 'user-1',
    encrypted: false,
    vaults: {
      'share-1': {
        name: 'Personnel',
        description: '',
        items: [
          {
            itemId: 'item-1',
            shareId: 'share-1',
            state: 1,
            data: {
              metadata: { name: 'GitHub', note: 'Compte principal', pinned: true },
              type: 'login',
              content: {
                username: 'studio26',
                password: 's3cret!',
                urls: ['https://github.com', 'https://gist.github.com'],
                totpUri: 'otpauth://totp/GitHub?secret=ABC',
                passkeys: [{ key: 'ignored' }],
              },
              extraFields: [
                {
                  fieldName: 'Clé API',
                  type: 'hidden',
                  data: { content: 'abc-123' },
                },
              ],
            },
          },
          {
            itemId: 'item-2',
            shareId: 'share-1',
            state: 1,
            data: {
              metadata: { name: 'Carte perso' },
              type: 'creditCard',
              content: {
                cardholderName: 'Ada Lovelace',
                cardType: 'Visa',
                number: '4242424242424242',
                expirationDate: '2028-12',
                securityCode: '123',
              },
            },
          },
          {
            itemId: 'item-3',
            shareId: 'share-1',
            state: 1,
            data: {
              metadata: { name: 'Identité' },
              type: 'identity',
              content: {
                fullName: 'Ada Lovelace',
                email: 'ada@example.com',
                phoneNumber: '+33 6 12 34 56 78',
                streetAddress: '1 rue de Paris',
                city: 'Paris',
                zipCode: '75001',
                country: 'France',
                organization: 'Analytical Engines',
              },
            },
          },
          {
            itemId: 'item-4',
            shareId: 'share-1',
            state: 1,
            aliasEmail: 'ada@passinbox.com',
            data: {
              metadata: { name: 'Alias boutique' },
              type: 'alias',
              content: {},
            },
          },
          {
            itemId: 'item-5',
            shareId: 'share-1',
            state: 1,
            data: {
              metadata: { name: 'Wi-Fi maison' },
              type: 'wifi',
              content: { ssid: 'Maison', password: 'wifi-secret' },
            },
          },
          {
            itemId: 'item-6',
            shareId: 'share-1',
            state: 2,
            data: {
              metadata: { name: 'Supprimé' },
              type: 'login',
              content: {},
            },
          },
        ],
      },
    },
  }

  it('convertit les types, champs et coffres Proton Pass', () => {
    const parsed = parseImport(JSON.stringify(protonExport), VAULT_ID)

    expect(parsed.format).toBe('protonpass-json')
    expect(parsed.items).toHaveLength(5)
    expect(parsed.items[0]).toMatchObject({
      type: 'login',
      title: 'GitHub',
      username: 'studio26',
      password: 's3cret!',
      notes: 'Compte principal',
      favorite: true,
      tags: ['Personnel'],
      urls: ['https://github.com', 'https://gist.github.com'],
      totp: 'otpauth://totp/GitHub?secret=ABC',
    })
    expect(parsed.items[0].customFields[0]).toMatchObject({
      label: 'Clé API',
      value: 'abc-123',
      type: 'hidden',
    })
    expect(parsed.items[1]).toMatchObject({
      type: 'card',
      number: '4242424242424242',
      expiry: '12/28',
      cvc: '123',
      brand: 'Visa',
    })
    expect(parsed.items[2]).toMatchObject({
      type: 'identity',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      city: 'Paris',
      postalCode: '75001',
    })
    expect(parsed.items[2].customFields).toEqual([
      expect.objectContaining({ label: 'Organisation', value: 'Analytical Engines' }),
    ])
    expect(parsed.items[3]).toMatchObject({
      type: 'login',
      title: 'Alias boutique',
      username: 'ada@passinbox.com',
    })
    expect(parsed.items[3].notes).toContain('Alias Proton : ada@passinbox.com')
    expect(parsed.items[4]).toMatchObject({
      type: 'note',
      title: 'Wi-Fi maison',
    })
    expect(parsed.items[4].notes).toContain('SSID : Maison')
    expect(parsed.warnings.join(' ')).toContain('Wi-Fi')
    expect(parsed.warnings.join(' ')).toContain('1 élément en corbeille ignoré')
    expect(parsed.warnings.join(' ')).toContain('1 passkey ignorée')
  })

  it('accepte une liste de coffres et un état sous forme de texte', () => {
    const parsed = parseImport(
      JSON.stringify({
        encrypted: false,
        vaults: [
          {
            name: 'Travail',
            items: [
              {
                state: '1',
                data: {
                  metadata: { name: 'Site' },
                  type: 'login',
                  content: { username: 'ada', urls: ['example.com'] },
                },
              },
            ],
          },
        ],
      }),
      VAULT_ID,
    )

    expect(parsed.items[0]).toMatchObject({
      title: 'Site',
      username: 'ada',
      urls: ['example.com'],
      tags: ['Travail'],
    })
  })

  it('refuse un export Proton Pass chiffré', () => {
    expect(() =>
      parseImport(
        JSON.stringify({ encrypted: true, vaults: {} }),
        VAULT_ID,
      ),
    ).toThrow(/Proton Pass chiffrés/)
  })
})

describe('déduplication', () => {
  it('ignore les doublons du coffre et ceux répétés dans le fichier', () => {
    const parsed = parseImport(
      [
        'name,url,username,password',
        'GitHub,https://github.com,studio26,s3cret!',
        'GitHub,https://github.com,studio26,autre-mot-de-passe',
        'GitLab,https://gitlab.com,studio26,s3cret!',
      ].join('\n'),
      VAULT_ID,
    )

    const existing = [parsed.items[0]]
    const result = dedupeImport(parsed.items, existing)

    expect(result.duplicates).toHaveLength(2)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].title).toBe('GitLab')
  })

  it('ne confond pas deux comptes du même site', () => {
    const parsed = parseImport(
      [
        'name,url,username,password',
        'GitHub,https://github.com,ada,s3cret!',
        'GitHub,https://github.com,grace,s3cret!',
      ].join('\n'),
      VAULT_ID,
    )

    const result = dedupeImport(parsed.items, [])
    expect(result.items).toHaveLength(2)
    expect(result.duplicates).toHaveLength(0)
  })

  it('ignore les éléments en corbeille lors de la comparaison', () => {
    const parsed = parseImport(
      ['name,url,username,password', 'GitHub,https://github.com,ada,s3cret!'].join(
        '\n',
      ),
      VAULT_ID,
    )

    const result = dedupeImport(parsed.items, [
      { ...parsed.items[0], deletedAt: '2026-01-01T00:00:00.000Z' },
    ])
    expect(result.items).toHaveLength(1)
    expect(result.duplicates).toHaveLength(0)
  })
})

describe('import CSV', () => {
  it('lit un CSV Bitwarden avec des champs entre guillemets', () => {
    const parsed = parseImport(
      [
        'folder,favorite,type,name,notes,login_uri,login_username,login_password,login_totp',
        'Travail,1,login,GitHub,"Note, avec virgule",https://github.com,studio26,s3cret!,',
      ].join('\n'),
      VAULT_ID,
    )

    expect(parsed.format).toBe('csv')
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]).toMatchObject({
      type: 'login',
      title: 'GitHub',
      notes: 'Note, avec virgule',
      username: 'studio26',
      password: 's3cret!',
      urls: ['https://github.com'],
      tags: ['Travail'],
      favorite: true,
    })
  })

  it('lit un CSV 1Password avec des notes multilignes', () => {
    const parsed = parseImport(
      [
        'Title,Url,Username,Password,OTPAuth,Favorite,Tags,Notes',
        '"Compte, pro",https://example.com,ada,s3cret!,,true,"travail,perso","Ligne 1',
        'Ligne 2"',
      ].join('\n'),
      VAULT_ID,
    )

    expect(parsed.items[0]).toMatchObject({
      type: 'login',
      title: 'Compte, pro',
      notes: 'Ligne 1\nLigne 2',
      tags: ['travail', 'perso'],
      favorite: true,
    })
  })

  it('détecte un séparateur point-virgule et une carte', () => {
    const parsed = parseImport(
      [
        'Name;Type;Card Number;Expiry;CVC;Notes',
        'Carte perso;Carte bancaire;4242 4242 4242 4242;12/28;123;Test',
      ].join('\n'),
      VAULT_ID,
    )

    expect(parsed.items[0]).toMatchObject({
      type: 'card',
      title: 'Carte perso',
      number: '4242 4242 4242 4242',
      expiry: '12/28',
      cvc: '123',
      notes: 'Test',
    })
  })

  it('classe une ligne sans identifiants comme note', () => {
    const parsed = parseImport(
      ['name,notes', 'Idée,"Acheter du café"'].join('\n'),
      VAULT_ID,
    )
    expect(parsed.items[0]).toMatchObject({ type: 'note', title: 'Idée' })
  })

  it('convertit les colonnes inconnues en champs personnalisés', () => {
    const parsed = parseImport(
      ['name,url,username,password,notes,Compte interne'].join('\n') +
        '\nSite,https://example.com,ada,s3cret!,,ABC-123',
      VAULT_ID,
    )

    expect(parsed.items[0].customFields).toEqual([
      expect.objectContaining({
        label: 'Compte interne',
        value: 'ABC-123',
        type: 'text',
      }),
    ])
  })

  it('refuse un CSV vide ou sans données', () => {
    expect(() => parseImport('name,url\n', VAULT_ID)).toThrow(ImportError)
  })

  it('refuse un format inconnu', () => {
    expect(() => parseImport('bonjour', VAULT_ID)).toThrow(ImportError)
  })
})

describe('import Enpass JSON', () => {
  const enpassExport = {
    folders: [
      { uuid: 'folder-work', parent_uuid: '', title: 'Travail' },
      { uuid: 'folder-dev', parent_uuid: 'folder-work', title: 'Développement' },
    ],
    items: [
      {
        uuid: 'item-1',
        title: 'GitHub',
        subtitle: 'studio26',
        category: 'login',
        favorite: 1,
        folders: ['folder-dev'],
        note: 'Compte principal',
        fields: [
          { label: 'Username', type: 'username', value: 'studio26', sensitive: 0 },
          { label: 'Email', type: 'email', value: 'ada@example.com', sensitive: 0 },
          { label: 'Password', type: 'password', value: 's3cret!', sensitive: 1 },
          { label: 'Website', type: 'url', value: 'https://github.com', sensitive: 0 },
          { label: 'Website', type: 'url', value: 'https://gist.github.com', sensitive: 0 },
          {
            label: 'Authenticator',
            type: 'totp',
            value: 'JBSWY3DPEHPK3PXP',
            sensitive: 1,
          },
          { label: 'Clé API', type: 'text', value: 'abc-123', sensitive: 1 },
          { label: 'Vide', type: 'text', value: '', sensitive: 0 },
        ],
        attachments: [{ name: 'capture.png' }],
      },
      {
        uuid: 'item-2',
        title: 'Carte perso',
        category: 'creditcard',
        favorite: 0,
        folders: [],
        note: '',
        fields: [
          {
            label: 'Card Number',
            type: 'cardnumber',
            value: '4242 4242 4242 4242',
            sensitive: 0,
          },
          {
            label: 'Card Holder',
            type: 'cardholder',
            value: 'Ada Lovelace',
            sensitive: 0,
          },
          { label: 'Expiry', type: 'expirydate', value: '12/28', sensitive: 0 },
          { label: 'CVV', type: 'cvv', value: '123', sensitive: 1 },
        ],
      },
      {
        uuid: 'item-3',
        title: 'Identité',
        category: 'identity',
        folders: [],
        fields: [
          { label: 'Full Name', type: 'fullname', value: 'Ada Lovelace', sensitive: 0 },
          { label: 'Email', type: 'email', value: 'ada@example.com', sensitive: 0 },
          { label: 'Phone', type: 'phone', value: '+33 6 12 34 56 78', sensitive: 0 },
          { label: 'Address', type: 'address', value: '1 rue de Paris', sensitive: 0 },
          { label: 'City', type: 'city', value: 'Paris', sensitive: 0 },
          { label: 'ZIP', type: 'zip', value: '75001', sensitive: 0 },
          { label: 'Country', type: 'country', value: 'France', sensitive: 0 },
        ],
      },
      {
        uuid: 'item-4',
        title: 'Note libre',
        category: 'note',
        note: 'Contenu de la note',
        folders: ['folder-work'],
        fields: [],
      },
      {
        uuid: 'item-5',
        title: 'Permis',
        category: 'license',
        note: '',
        folders: [],
        entries: [
          {
            title: 'Détails',
            fields: [
              { label: 'Numéro', type: 'text', value: 'AB-123', sensitive: 1 },
            ],
          },
        ],
      },
      {
        uuid: 'item-6',
        title: 'Corbeille',
        category: 'login',
        trashed: 1,
        fields: [],
      },
    ],
  }

  it('convertit les champs, dossiers et catégories Enpass', () => {
    const parsed = parseImport(JSON.stringify(enpassExport), VAULT_ID)

    expect(parsed.format).toBe('enpass-json')
    expect(parsed.source).toBe('enpass')
    expect(parsed.items).toHaveLength(5)

    expect(parsed.items[0]).toMatchObject({
      type: 'login',
      title: 'GitHub',
      username: 'studio26',
      password: 's3cret!',
      notes: 'Compte principal',
      favorite: true,
      tags: ['Travail / Développement'],
      urls: ['https://github.com', 'https://gist.github.com'],
    })
    expect(loginItem(parsed).totp).toMatch(/^otpauth:\/\/totp\//)
    expect(loginItem(parsed).totp).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(parsed.items[0].customFields).toEqual([
      expect.objectContaining({ label: 'Email', value: 'ada@example.com' }),
      expect.objectContaining({
        label: 'Clé API',
        value: 'abc-123',
        type: 'hidden',
      }),
    ])

    expect(parsed.items[1]).toMatchObject({
      type: 'card',
      title: 'Carte perso',
      number: '4242 4242 4242 4242',
      cardholder: 'Ada Lovelace',
      expiry: '12/28',
      cvc: '123',
    })
    expect(parsed.items[2]).toMatchObject({
      type: 'identity',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+33 6 12 34 56 78',
      address: '1 rue de Paris',
      city: 'Paris',
      postalCode: '75001',
      country: 'France',
    })
    expect(parsed.items[3]).toMatchObject({
      type: 'note',
      title: 'Note libre',
      notes: 'Contenu de la note',
      tags: ['Travail'],
    })
    expect(parsed.items[4]).toMatchObject({ type: 'note', title: 'Permis' })
    expect(parsed.items[4].customFields[0]).toMatchObject({
      label: 'Numéro',
      value: 'AB-123',
      type: 'hidden',
    })

    expect(parsed.warnings.join(' ')).toContain('1 élément en corbeille ignoré')
    expect(parsed.warnings.join(' ')).toContain('1 pièce jointe Enpass')
    expect(parsed.warnings.join(' ')).toContain('license')
  })

  it('accepte un export enveloppé dans « vault » et des listes sous forme d’objet', () => {
    const parsed = parseImport(
      JSON.stringify({
        vault: {
          folders: {
            f1: { uuid: 'f1', parent_uuid: '', title: 'Perso' },
          },
          items: {
            i1: {
              title: 'Site',
              category: 'login',
              folders: ['f1'],
              fields: [
                { label: 'Username', type: 'username', value: 'ada' },
                { label: 'URL', type: 'url', value: 'example.com' },
              ],
            },
          },
        },
      }),
      VAULT_ID,
    )

    expect(parsed.items[0]).toMatchObject({
      title: 'Site',
      username: 'ada',
      urls: ['example.com'],
      tags: ['Perso'],
    })
  })

  it('détecte Enpass avant Bitwarden', () => {
    expect(detectImportFormat(JSON.stringify(enpassExport))).toBe('enpass-json')
    expect(
      detectImportFormat(JSON.stringify({ encrypted: false, items: [] })),
    ).toBe('bitwarden-json')
  })

  it('refuse un JSON sans liste items', () => {
    expect(() =>
      parseImport(
        JSON.stringify({
          vault: { items: undefined },
          folders: [{ uuid: 'f1', title: 'Perso' }],
        }),
        VAULT_ID,
      ),
    ).toThrow(/export Enpass/)
  })
})

describe('dialectes CSV traditionnels', () => {
  it('lit un export LastPass', () => {
    const parsed = parseImport(
      [
        'url,username,password,extra,name,grouping,fav',
        'https://example.com,ada,s3cret!,Note,Example,Sites,1',
      ].join('\n'),
      VAULT_ID,
    )

    expect(parsed.source).toBe('lastpass')
    expect(importSourceLabel(parsed.source)).toBe('LastPass')
    expect(parsed.items[0]).toMatchObject({
      type: 'login',
      title: 'Example',
      username: 'ada',
      password: 's3cret!',
      notes: 'Note',
      tags: ['Sites'],
      favorite: true,
    })
  })

  it('déduit le titre du domaine pour Chrome et Firefox', () => {
    const chrome = parseImport(
      [
        'name,url,username,password,note',
        ',https://www.github.com,studio26,s3cret!,Note',
      ].join('\n'),
      VAULT_ID,
    )
    expect(chrome.source).toBe('chromium')
    expect(chrome.items[0]).toMatchObject({
      title: 'github.com',
      username: 'studio26',
      notes: 'Note',
    })

    const firefox = parseImport(
      [
        'url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged',
        'https://mail.example.com,ada,s3cret!,,,,,',
      ].join('\n'),
      VAULT_ID,
    )
    expect(firefox.source).toBe('firefox')
    expect(firefox.items[0]).toMatchObject({
      title: 'mail.example.com',
      username: 'ada',
      password: 's3cret!',
    })
  })

  it('lit Dashlane, convertit le TOTP et conserve les identifiants secondaires', () => {
    const parsed = parseImport(
      [
        'username,username2,username3,title,password,note,url,category,otpSecret',
        'ada,ada2,,Dashlane,s3cret!,Note,https://dashlane.com,Sites web,JBSWY3DPEHPK3PXP',
      ].join('\n'),
      VAULT_ID,
    )

    expect(parsed.source).toBe('dashlane')
    expect(parsed.items[0]).toMatchObject({
      type: 'login',
      title: 'Dashlane',
      username: 'ada',
      password: 's3cret!',
    })
    expect(loginItem(parsed).totp).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(parsed.items[0].customFields).toEqual([
      expect.objectContaining({ label: 'username2', value: 'ada2' }),
    ])
  })

  it('lit KeePass, KeePassXC et SafeInCloud sans confondre « Login » avec le titre', () => {
    const keepass = parseImport(
      [
        'Account,Login Name,Password,Web Site,Comments',
        'KeePass,ada,s3cret!,https://keepass.info,Note',
      ].join('\n'),
      VAULT_ID,
    )
    expect(keepass.source).toBe('keepass')
    expect(keepass.items[0]).toMatchObject({
      title: 'KeePass',
      username: 'ada',
      urls: ['https://keepass.info'],
    })

    const keepassxc = parseImport(
      [
        'Group,Title,Username,Password,URL,Notes,TOTP',
        'Travail,KeePassXC,ada,s3cret!,https://keepassxc.org,Note,JBSWY3DPEHPK3PXP',
      ].join('\n'),
      VAULT_ID,
    )
    expect(keepassxc.source).toBe('keepass')
    expect(keepassxc.items[0]).toMatchObject({
      title: 'KeePassXC',
      username: 'ada',
      tags: ['Travail'],
    })
    expect(loginItem(keepassxc).totp).toContain('secret=JBSWY3DPEHPK3PXP')

    const safeincloud = parseImport(
      [
        'Title,Login,Password,URL,Notes',
        'SafeInCloud,ada,s3cret!,https://safeincloud.com,Note',
      ].join('\n'),
      VAULT_ID,
    )
    expect(safeincloud.source).toBe('safeincloud')
    expect(safeincloud.items[0]).toMatchObject({
      title: 'SafeInCloud',
      username: 'ada',
    })
  })

  it('lit NordPass et Keeper, y compris les cartes', () => {
    const nordpass = parseImport(
      [
        'name,url,username,password,note,cardholdername,cardnumber,cvc,expirydate,zipcode,folder,full_name,phone_number,email,address,type',
        'Carte,,,,,Ada Lovelace,4242424242424242,123,12/28,75001,Perso,,,,,credit_card',
      ].join('\n'),
      VAULT_ID,
    )
    expect(nordpass.source).toBe('nordpass')
    expect(nordpass.items[0]).toMatchObject({
      type: 'card',
      title: 'Carte',
      cardholder: 'Ada Lovelace',
      number: '4242424242424242',
      cvc: '123',
      expiry: '12/28',
      tags: ['Perso'],
    })

    const keeper = parseImport(
      [
        'Folder,Title,Login,Password,Website,Notes',
        'Perso,Keeper,ada,s3cret!,https://keepersecurity.com,Note',
      ].join('\n'),
      VAULT_ID,
    )
    expect(keeper.source).toBe('keeper')
    expect(keeper.items[0]).toMatchObject({
      title: 'Keeper',
      username: 'ada',
      urls: ['https://keepersecurity.com'],
    })
  })

  it('marque les éléments archivés 1Password et lit Enpass CSV', () => {
    const onepassword = parseImport(
      [
        'Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes',
        'Ancien,https://old.example.com,ada,s3cret!,,false,true,ancien,Note',
      ].join('\n'),
      VAULT_ID,
    )
    expect(onepassword.source).toBe('1password')
    expect(onepassword.items[0].tags).toEqual(['ancien', 'Archivé'])

    const enpass = parseImport(
      [
        'Title,Username,Password,URL,Notes,Folder',
        'Enpass,ada,s3cret!,https://enpass.io,Note,Perso',
      ].join('\n'),
      VAULT_ID,
    )
    expect(enpass.items[0]).toMatchObject({
      title: 'Enpass',
      username: 'ada',
      tags: ['Perso'],
    })
  })

  it('traite une colonne « site » comme une URL', () => {
    const parsed = parseImport(
      ['site,username,password', 'https://example.com,ada,s3cret!'].join('\n'),
      VAULT_ID,
    )
    expect(parsed.items[0]).toMatchObject({
      title: 'example.com',
      username: 'ada',
      urls: ['https://example.com'],
    })
  })

  it('sépare un nom complet dans une identité CSV', () => {
    const parsed = parseImport(
      [
        'type,full_name,email,phone',
        'identity,Ada Lovelace,ada@example.com,+33 6 12 34 56 78',
      ].join('\n'),
      VAULT_ID,
    )

    expect(parsed.items[0]).toMatchObject({
      type: 'identity',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+33 6 12 34 56 78',
    })
  })
})

describe('import Dashlane JSON', () => {
  it('lit un export Dashlane réel anonymisé', () => {
    expect(detectImportFormat(dashlaneJson)).toBe('dashlane-json')

    const parsed = parseImport(dashlaneJson, VAULT_ID)
    expect(parsed).toMatchObject({ format: 'dashlane-json', source: 'dashlane' })
    expect(parsed.items).toHaveLength(14)
    expect(loginItem(parsed)).toMatchObject({
      title: 'https://news.ycombinator.com',
      username: 'ostqxi',
      password: "1)Btf2EI~Tfb7g2A!Sy',*Sj#",
      urls: ['https://news.ycombinator.com'],
    })
    expect(parsed.items.some((item) => item.title === 'empty password')).toBe(true)
  })

  it('conserve l’identifiant secondaire et signale les champs inconnus', () => {
    const parsed = parseImport(
      JSON.stringify({
        AUTHENTIFIANT: [
          {
            title: 'Banque',
            domain: 'https://banque.example',
            login: 'ada',
            secondaryLogin: 'ada2',
            password: 's3cret!',
            note: '',
            country: 'FR',
          },
        ],
      }),
      VAULT_ID,
    )

    expect(parsed.items[0].customFields).toEqual([
      expect.objectContaining({ label: 'Identifiant secondaire', value: 'ada2' }),
    ])
    expect(parsed.warnings.join(' ')).toContain('country')
  })
})

describe('import CSV KeePass', () => {
  it('lit un export KeePass 2.x réel anonymisé', () => {
    const parsed = parseImport(keepassCsv, VAULT_ID)
    expect(parsed.source).toBe('keepass')
    expect(parsed.items.length).toBeGreaterThan(0)
    expect(parsed.items[0]).toMatchObject({
      type: 'login',
      username: 'ostqxi',
      urls: ['https://mastodon.social/'],
    })
  })
})

describe('fixtures CSV anonymisées', () => {
  const fixtures: Array<[string, string, string]> = [
    ['1Password 8', onepasswordCsv, '1password'],
    ['Bitwarden', bitwardenCsv, 'bitwarden'],
    ['Chrome', chromeCsv, 'chromium'],
    ['Dashlane sans en-tête', dashlaneCsv, 'dashlane'],
    ['Firefox', firefoxCsv, 'firefox'],
    ['KeePass', keepassCsv, 'keepass'],
    ['Keeper sans en-tête', keeperCsv, 'keeper'],
    ['LastPass', lastpassCsv, 'lastpass'],
    ['NordPass', nordpassCsv, 'nordpass'],
    ['RoboForm', roboformCsv, 'roboform'],
    ['SafeInCloud', safeincloudCsv, 'safeincloud'],
  ]

  it.each(fixtures)('lit un export %s', (_label, text, source) => {
    const parsed = parseImport(text, VAULT_ID)
    expect(parsed.source).toBe(source)
    expect(parsed.items.length).toBeGreaterThan(0)
    expect(parsed.items[0].title.trim()).not.toBe('')
  })

  it('relit les exports sans en-tête et les champs Bitwarden', () => {
    const dashlane = parseImport(dashlaneCsv, VAULT_ID)
    expect(dashlane.items[1]).toMatchObject({
      type: 'login',
      title: 'mastodon.social',
      username: 'ostqxi',
      urls: ['https://mastodon.social/'],
    })

    const keeper = parseImport(keeperCsv, VAULT_ID)
    expect(keeper.items[0]).toMatchObject({
      type: 'login',
      title: 'aib',
      username: 'dpbx@fner.ws',
      tags: ['Bank'],
    })

    const bitwarden = parseImport(bitwardenCsv, VAULT_ID)
    expect(bitwarden.items[0].customFields).toEqual([
      expect.objectContaining({ label: 'pin', value: '462916', type: 'hidden' }),
      expect.objectContaining({ label: 'oldpin', value: '489019', type: 'hidden' }),
    ])
  })
})

describe('import XML KeePass', () => {
  it('lit un export XML KeePass 2.x réel', () => {
    expect(detectImportFormat(keepassXml)).toBe('keepass-xml')

    const parsed = parseImport(keepassXml, VAULT_ID)
    expect(parsed).toMatchObject({ format: 'keepass-xml', source: 'keepass' })
    expect(parsed.items).toHaveLength(4)

    expect(loginItem(parsed)).toMatchObject({
      title: 'Sample Entry 1',
      username: 'User Name',
      password: 'Password',
      notes: 'Notes',
    })
    expect(parsed.items[1]).toMatchObject({
      title: 'Sample Entry 2',
      username: 'notDEFUSERNAME',
      urls: ['http://www.keepassx.org/'],
    })
    expect(parsed.items[2]).toMatchObject({
      type: 'note',
      title: 'Subsub Entry',
      tags: ['Windows', 'Subsub'],
    })
    expect(parsed.warnings.join(' ')).toContain('historique')
  })

  it('refuse un XML qui n’est pas un export KeePass', () => {
    expect(() => parseImport('<root />', VAULT_ID)).toThrow(ImportError)
  })
})
