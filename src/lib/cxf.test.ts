import { describe, expect, it } from 'vitest'
import { exportCxf, parseCxf } from './cxf'
import { createPasskey, toBase64Url } from './passkeys'
import type {
  CardItem,
  IdentityItem,
  LoginItem,
  NoteItem,
  PasskeyItem,
  VaultItem,
} from './types'

const NOW = '2026-11-08T10:00:00.000Z'

function base(overrides: Partial<VaultItem>): VaultItem {
  return {
    id: 'i1',
    vaultId: 'v1',
    type: 'login',
    title: 'Élément',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as VaultItem
}

function login(): LoginItem {
  return base({
    type: 'login',
    title: 'GitHub',
    username: 'ada',
    password: 's3cret!',
    urls: ['https://github.com', 'https://gist.github.com'],
    totp: 'otpauth://totp/GitHub:ada?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30',
    notes: 'Compte principal',
    tags: ['dev'],
    favorite: true,
    customFields: [
      { id: 'f1', label: 'Clé API', value: 'abc-123', type: 'hidden' },
    ],
    expiresAt: '2027-01-31',
  }) as LoginItem
}

function note(): NoteItem {
  return base({ type: 'note', title: 'Note interne', notes: 'Contenu de la note' }) as NoteItem
}

function card(): CardItem {
  return base({
    type: 'card',
    title: 'Carte perso',
    cardholder: 'Ada Lovelace',
    number: '4242424242424242',
    expiry: '12/28',
    cvc: '123',
    pin: '',
    brand: 'Visa',
  }) as CardItem
}

function identity(): IdentityItem {
  return base({
    type: 'identity',
    title: 'Identité',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+33 6 12 34 56 78',
    address: '1 rue de Paris',
    city: 'Paris',
    postalCode: '75001',
    country: 'FR',
    birthDate: '1815-12-10',
    passportExpiry: '',
    idCardExpiry: '',
    licenseExpiry: '',
  }) as IdentityItem
}

async function passkey(signCount = 0): Promise<PasskeyItem> {
  const created = await createPasskey({
    rpId: 'example.com',
    origin: 'https://example.com',
    challenge: toBase64Url(new Uint8Array(32)),
    userName: 'ada@example.com',
  })
  return base({
    type: 'passkey',
    title: 'Passkey example.com',
    rpId: 'example.com',
    userName: 'ada@example.com',
    userHandle: created.userHandle,
    credentialId: created.credentialId,
    privateKey: created.privateKey,
    publicKeyCose: created.publicKeyCose,
    signCount,
  }) as PasskeyItem
}

describe('export CXF 1.0', () => {
  it('convertit les cinq types et conserve les champs importants', async () => {
    const items = [login(), note(), card(), identity(), await passkey()]
    const result = exportCxf(items, { timestamp: 1_700_000_000, email: 'ada@example.com' })

    expect(result.document.version).toEqual({ major: 1, minor: 0 })
    expect(result.document.timestamp).toBe(1_700_000_000)
    expect(result.document.accounts[0].email).toBe('ada@example.com')
    expect(result.document.accounts[0].items).toHaveLength(5)

    const github = result.document.accounts[0].items[0]
    expect(github.scope?.urls).toEqual([
      'https://github.com',
      'https://gist.github.com',
    ])
    expect(github.favorite).toBe(true)
    expect(github.tags).toEqual(['dev'])
    const basic = github.credentials.find((entry) => entry.type === 'basic-auth')
    expect(basic).toMatchObject({
      username: expect.objectContaining({ value: 'ada' }),
      password: expect.objectContaining({
        value: 's3cret!',
        fieldType: 'concealed-string',
      }),
    })
    const totp = github.credentials.find((entry) => entry.type === 'totp')
    expect(totp).toMatchObject({
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'sha1',
      digits: 6,
      period: 30,
    })

    const cardItem = result.document.accounts[0].items[2]
    const credit = cardItem.credentials.find((entry) => entry.type === 'credit-card')
    expect(credit).toMatchObject({
      number: expect.objectContaining({ value: '4242424242424242' }),
      expiryDate: expect.objectContaining({ value: '2028-12' }),
    })

    const identityItem = result.document.accounts[0].items[3]
    const address = identityItem.credentials.find((entry) => entry.type === 'address')
    expect(address).toMatchObject({
      streetAddress: expect.objectContaining({ value: '1 rue de Paris' }),
      country: expect.objectContaining({ value: 'FR', fieldType: 'country-code' }),
    })

    const passkeyItem = result.document.accounts[0].items[4]
    const passkeyCredential = passkeyItem.credentials[0]
    expect(passkeyCredential).toMatchObject({
      type: 'passkey',
      rpId: 'example.com',
      username: 'ada@example.com',
      userDisplayName: 'ada@example.com',
    })
    expect(typeof passkeyCredential.key).toBe('string')
  })

  it('exclut les passkeys à compteur non nul et signale les pièces jointes', async () => {
    const item = await passkey(3)
    const withAttachment: VaultItem = {
      ...login(),
      attachments: [
        { id: 'a1', name: 'capture.png', mime: 'image/png', size: 10, createdAt: NOW },
      ],
    }
    const result = exportCxf([item, withAttachment])

    expect(result.document.accounts[0].items).toHaveLength(1)
    expect(result.warnings.join(' ')).toContain('compteur de signature non nul')
    expect(result.warnings.join(' ')).toContain('pièce jointe')
  })
})

describe('import CXF 1.0', () => {
  it('relit un export Coffre, y compris les passkeys', async () => {
    const originalPasskey = await passkey()
    const exported = exportCxf([
      login(),
      note(),
      card(),
      identity(),
      originalPasskey,
    ])
    const parsed = await parseCxf(exported.json, 'v_import')

    expect(parsed).toMatchObject({ format: 'cxf', source: 'cxf' })
    expect(parsed.items).toHaveLength(5)

    const importedLogin = parsed.items.find((item) => item.type === 'login')
    expect(importedLogin).toMatchObject({
      title: 'GitHub',
      username: 'ada',
      password: 's3cret!',
      urls: ['https://github.com', 'https://gist.github.com'],
      tags: ['dev'],
      favorite: true,
      notes: 'Compte principal',
    })
    expect(importedLogin?.type === 'login' ? importedLogin.totp : '').toContain(
      'secret=JBSWY3DPEHPK3PXP',
    )
    expect(importedLogin?.customFields[0]).toMatchObject({
      label: 'Clé API',
      value: 'abc-123',
      type: 'hidden',
    })

    const importedCard = parsed.items.find((item) => item.type === 'card')
    expect(importedCard).toMatchObject({
      title: 'Carte perso',
      number: '4242424242424242',
      expiry: '12/28',
      cvc: '123',
      brand: 'Visa',
    })

    const importedIdentity = parsed.items.find((item) => item.type === 'identity')
    expect(importedIdentity).toMatchObject({
      title: 'Identité',
      firstName: 'Ada',
      lastName: 'Lovelace',
      address: '1 rue de Paris',
      postalCode: '75001',
      city: 'Paris',
      country: 'FR',
      phone: '+33 6 12 34 56 78',
    })

    const importedPasskey = parsed.items.find((item) => item.type === 'passkey')
    expect(importedPasskey).toMatchObject({
      title: 'Passkey example.com',
      rpId: 'example.com',
      userName: 'ada@example.com',
      credentialId: originalPasskey.credentialId,
      signCount: 0,
    })
    expect(importedPasskey?.type === 'passkey' ? importedPasskey.publicKeyCose : '').toBe(
      originalPasskey.publicKeyCose,
    )
    expect(importedPasskey?.type === 'passkey' ? importedPasskey.privateKey : '').toBe(
      originalPasskey.privateKey,
    )
  })

  it('signale les justificatifs inconnus et les versions majeures refusées', async () => {
    const parsed = await parseCxf(
      JSON.stringify({
        version: { major: 1, minor: 0 },
        exporterRpId: 'example.com',
        exporterDisplayName: 'Test',
        timestamp: 1,
        accounts: [
          {
            id: 'a',
            username: '',
            email: '',
            collections: [],
            items: [
              {
                id: 'i',
                title: 'Inconnu',
                credentials: [{ type: 'ssh-key', privateKey: 'x' }],
              },
            ],
          },
        ],
      }),
      'v1',
    )
    expect(parsed.items).toHaveLength(0)
    expect(parsed.warnings.join(' ')).toContain('ssh-key')

    await expect(
      parseCxf(
        JSON.stringify({
          version: { major: 2, minor: 0 },
          exporterRpId: 'example.com',
          accounts: [],
        }),
        'v1',
      ),
    ).rejects.toThrow(/CXF 1/)
  })
})
