import { describe, expect, it } from 'vitest'
import { exportCxf, parseCxf } from './cxf'
import { createPasskey, toBase64Url } from './passkeys'
import { toBase64 } from './crypto'
import type {
  ApiCredentialItem,
  CardItem,
  DocumentItem,
  IdentityItem,
  LoginItem,
  NoteItem,
  PasskeyItem,
  RecoveryCodesItem,
  SoftwareLicenseItem,
  SshKeyItem,
  VaultItem,
  WifiItem,
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

function recoveryCodes(): RecoveryCodesItem {
  return base({
    type: 'recovery-codes',
    title: 'Codes GitHub',
    codes: [
      { id: 'rc_1', code: 'AAAA-BBBB', usedAt: null },
      { id: 'rc_2', code: 'CCCC-DDDD', usedAt: '2026-11-09T10:00:00.000Z' },
    ],
  }) as RecoveryCodesItem
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

function wifi(): WifiItem {
  return base({
    type: 'wifi',
    title: 'Wi-Fi maison',
    ssid: 'Studio26',
    password: 'mot-de-passe-wifi',
    security: 'WPA',
    hidden: true,
  }) as WifiItem
}

function apiCredential(): ApiCredentialItem {
  return base({
    type: 'api-credential',
    title: 'API paiement',
    keyId: 'pk_live_123',
    secret: 'sk_live_secret',
    environment: 'production',
    endpoint: 'https://api.example.com/v1',
    expiresAt: '2027-06-30',
  }) as ApiCredentialItem
}

async function sshKey(): Promise<SshKeyItem> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const der = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', pair.privateKey),
  )
  const base64 = toBase64(der)
  const pem = `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`
  return base({
    type: 'ssh-key',
    title: 'Clé de déploiement',
    privateKey: pem,
    publicKey: 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY',
    fingerprint: 'SHA256:abc123',
    comment: 'deploy@example.com',
  }) as SshKeyItem
}

function softwareLicense(): SoftwareLicenseItem {
  return base({
    type: 'software-license',
    title: 'Licence outil',
    licenseKey: 'XXXX-YYYY-ZZZZ',
    licensedTo: 'Studio 26',
    version: '2.4',
    website: 'https://example.com/achat',
    purchaseDate: '2026-01-15',
  }) as SoftwareLicenseItem
}

function documentItem(): DocumentItem {
  return base({
    type: 'document',
    title: 'Passeport',
    documentKind: 'identity',
    issuer: 'Préfecture de Paris',
    documentNumber: 'FR1234567',
    issuedAt: '2021-03-01',
    expiresAt: '2031-03-01',
  }) as DocumentItem
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

    const noteItem = result.document.accounts[0].items[1]
    expect(noteItem.credentials).toHaveLength(1)
    expect(noteItem.credentials[0]).toMatchObject({
      type: 'note',
      content: { value: 'Contenu de la note', fieldType: 'string' },
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

  it('exporte les codes de secours comme note et les restaure', async () => {
    const item = recoveryCodes()
    item.notes = 'Note de secours'
    const result = exportCxf([item])
    const credentials = result.document.accounts[0].items[0].credentials
    expect(credentials[0]).toMatchObject({
      type: 'note',
      content: expect.objectContaining({
        value: expect.stringContaining('AAAA-BBBB'),
      }),
    })
    expect(
      (credentials[0].content as { value: string }).value,
    ).toContain('CCCC-DDDD')
    expect(result.document.accounts[0].items[0].extensions).toEqual([
      { name: 'coffre.local/item-type', itemType: 'recovery-codes' },
    ])

    const parsed = await parseCxf(result.json, 'v_codes')
    expect(parsed.items[0]).toMatchObject({
      type: 'recovery-codes',
      notes: 'Note de secours',
    })
    const imported = parsed.items[0]
    expect(imported.type === 'recovery-codes' ? imported.codes : []).toEqual([
      { id: expect.any(String), code: 'AAAA-BBBB', usedAt: null },
      {
        id: expect.any(String),
        code: 'CCCC-DDDD',
        usedAt: '2026-11-09T10:00:00.000Z',
      },
    ])
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
                credentials: [{ type: 'quantum-key' }],
              },
            ],
          },
        ],
      }),
      'v1',
    )
    expect(parsed.items).toHaveLength(0)
    expect(parsed.warnings.join(' ')).toContain('quantum-key')

    const invalidSsh = await parseCxf(
      JSON.stringify({
        version: { major: 1, minor: 0 },
        exporterRpId: 'example.com',
        accounts: [
          {
            id: 'a',
            username: '',
            email: '',
            collections: [],
            items: [
              {
                id: 'i',
                title: 'SSH invalide',
                credentials: [
                  {
                    type: 'ssh-key',
                    keyType: 'ssh-ed25519',
                    privateKey: 'AAAA',
                  },
                ],
              },
            ],
          },
        ],
      }),
      'v1',
    )
    expect(invalidSsh.items).toHaveLength(0)
    expect(invalidSsh.warnings.join(' ')).toContain('clé SSH CXF invalide')

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

describe('CXF — types étendus', () => {
  it('ajoute le tableau androidApps requis au scope', () => {
    const result = exportCxf([login()])
    expect(result.document.accounts[0].items[0].scope).toEqual({
      urls: ['https://github.com', 'https://gist.github.com'],
      androidApps: [],
    })
  })

  it('exporte et relit Wi-Fi, API, SSH, licence et document', async () => {
    const key = await sshKey()
    const exported = exportCxf([
      wifi(),
      apiCredential(),
      key,
      softwareLicense(),
      documentItem(),
    ])
    const items = exported.document.accounts[0].items
    expect(items).toHaveLength(5)

    expect(
      items[0].credentials.find((entry) => entry.type === 'wifi'),
    ).toMatchObject({
      ssid: { value: 'Studio26' },
      networkSecurityType: { value: 'wpa2-personal' },
      passphrase: { value: 'mot-de-passe-wifi', fieldType: 'concealed-string' },
      hidden: { value: 'true', fieldType: 'boolean' },
    })
    expect(
      items[1].credentials.find((entry) => entry.type === 'api-key'),
    ).toMatchObject({
      key: { value: 'sk_live_secret', fieldType: 'concealed-string' },
      username: { value: 'pk_live_123' },
      url: { value: 'https://api.example.com/v1' },
      expiryDate: { value: '2027-06-30' },
    })
    expect(
      items[2].credentials.find((entry) => entry.type === 'ssh-key'),
    ).toMatchObject({ keyType: 'ecdsa-sha2-nistp256' })
    expect(String(
      items[2].credentials.find((entry) => entry.type === 'ssh-key')?.privateKey,
    )).not.toContain('BEGIN')
    expect(items[3].extensions).toEqual([
      { name: 'coffre.local/item-type', itemType: 'software-license' },
    ])
    expect(items[4].extensions).toEqual([
      { name: 'coffre.local/item-type', itemType: 'document' },
    ])

    const parsed = await parseCxf(exported.json, 'v_extended')
    expect(parsed.items.map((item) => item.type)).toEqual([
      'wifi',
      'api-credential',
      'ssh-key',
      'software-license',
      'document',
    ])

    expect(parsed.items[0]).toMatchObject({
      type: 'wifi',
      ssid: 'Studio26',
      password: 'mot-de-passe-wifi',
      security: 'WPA',
      hidden: true,
    })
    expect(parsed.items[1]).toMatchObject({
      type: 'api-credential',
      keyId: 'pk_live_123',
      secret: 'sk_live_secret',
      environment: 'production',
      endpoint: 'https://api.example.com/v1',
      expiresAt: '2027-06-30',
    })
    const importedSsh = parsed.items[2]
    expect(importedSsh).toMatchObject({
      type: 'ssh-key',
      publicKey: key.publicKey,
      fingerprint: 'SHA256:abc123',
      comment: 'deploy@example.com',
    })
    expect(
      importedSsh.type === 'ssh-key' ? importedSsh.privateKey : '',
    ).toContain('-----BEGIN PRIVATE KEY-----')
    expect(parsed.items[3]).toMatchObject({
      type: 'software-license',
      licenseKey: 'XXXX-YYYY-ZZZZ',
      licensedTo: 'Studio 26',
      version: '2.4',
      website: 'https://example.com/achat',
      purchaseDate: '2026-01-15',
    })
    expect(parsed.items[4]).toMatchObject({
      type: 'document',
      documentKind: 'identity',
      issuer: 'Préfecture de Paris',
      documentNumber: 'FR1234567',
      issuedAt: '2021-03-01',
      expiresAt: '2031-03-01',
    })
  })

  it('exporte et relit une clé OpenSSH en champs personnalisés', async () => {
    const key = base({
      type: 'ssh-key',
      title: 'Clé OpenSSH',
      privateKey:
        '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----',
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest',
      fingerprint: 'SHA256:def456',
      comment: 'open ssh',
    }) as SshKeyItem
    const result = exportCxf([key])
    const credentials = result.document.accounts[0].items[0].credentials
    expect(result.warnings.join(' ')).toContain('PKCS#8')
    expect(credentials.find((entry) => entry.type === 'ssh-key')).toBeUndefined()
    expect(
      credentials
        .find((entry) => entry.type === 'custom-fields')
        ?.fields,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Clé privée SSH' }),
        expect.objectContaining({ label: 'Clé publique SSH' }),
      ]),
    )

    const parsed = await parseCxf(result.json, 'v_ssh')
    expect(parsed.items[0]).toMatchObject({
      type: 'ssh-key',
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest',
      fingerprint: 'SHA256:def456',
      comment: 'open ssh',
    })
    expect(
      parsed.items[0].type === 'ssh-key' ? parsed.items[0].privateKey : '',
    ).toContain('BEGIN OPENSSH PRIVATE KEY')
  })

  it('relit un document sans équivalent CXF natif', async () => {
    const document = base({
      type: 'document',
      title: 'Contrat de service',
      documentKind: 'contract',
      issuer: 'ACME',
      documentNumber: 'CTR-42',
      issuedAt: '2025-01-10',
    }) as DocumentItem
    const parsed = await parseCxf(exportCxf([document]).json, 'v_document')
    expect(parsed.items[0]).toMatchObject({
      type: 'document',
      documentKind: 'contract',
      issuer: 'ACME',
      documentNumber: 'CTR-42',
      issuedAt: '2025-01-10',
    })
  })

  it('exporte et relit les expirations de documents d’identité', async () => {
    const identityItem = identity()
    identityItem.passportExpiry = '2030-01-01'
    identityItem.licenseExpiry = '2029-06-30'
    identityItem.idCardExpiry = '2028-12-31'

    const exported = exportCxf([identityItem])
    const credentials = exported.document.accounts[0].items[0].credentials
    expect(credentials.find((entry) => entry.type === 'passport')).toMatchObject({
      fullName: { value: 'Ada Lovelace' },
      expiryDate: { value: '2030-01-01' },
    })
    expect(
      credentials.find((entry) => entry.type === 'drivers-license'),
    ).toMatchObject({ expiryDate: { value: '2029-06-30' } })
    expect(
      credentials.find((entry) => entry.type === 'identity-document'),
    ).toMatchObject({
      birthDate: { value: '1815-12-10' },
      expiryDate: { value: '2028-12-31' },
    })

    const parsed = await parseCxf(exported.json, 'v_identity')
    expect(parsed.items[0]).toMatchObject({
      type: 'identity',
      passportExpiry: '2030-01-01',
      licenseExpiry: '2029-06-30',
      idCardExpiry: '2028-12-31',
      birthDate: '1815-12-10',
    })
  })
})
