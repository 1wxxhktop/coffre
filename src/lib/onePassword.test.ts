import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { ImportError } from './import'
import { parse1pux } from './onePassword'
import type { LoginItem } from './types'

function archive(data: unknown, version = 3): Uint8Array {
  return zipSync({
    'export.attributes': strToU8(JSON.stringify({ version, description: '1Password Unencrypted Export' })),
    'export.data': strToU8(JSON.stringify(data)),
  })
}

function sampleData() {
  return {
    accounts: [
      {
        attrs: { name: 'Compte' },
        vaults: [
          {
            attrs: { name: 'Privé' },
            items: [
              {
                uuid: 'login',
                favIndex: 2,
                state: 'active',
                categoryUuid: '001',
                overview: {
                  title: 'GitHub',
                  url: 'https://github.com',
                  urls: [{ url: 'https://gist.github.com' }],
                  tags: ['travail'],
                },
                details: {
                  loginFields: [
                    { value: 'studio26', designation: 'username', name: 'username' },
                    { value: 's3cret!', designation: 'password', name: 'password' },
                  ],
                  notesPlain: 'Compte principal',
                  sections: [
                    {
                      title: 'Sécurité',
                      fields: [
                        { title: 'one-time password', value: 'JBSWY3DPEHPK3PXP' },
                        { title: 'Clé API', value: { concealed: 'abc-123' } },
                      ],
                    },
                  ],
                  passwordHistory: [{ value: 'ancien', time: 1 }],
                },
              },
              {
                uuid: 'card',
                favIndex: 0,
                state: 'active',
                categoryUuid: '002',
                overview: { title: 'Carte perso' },
                details: {
                  notesPlain: '',
                  sections: [
                    {
                      title: 'Carte',
                      fields: [
                        { title: 'cardholder name', value: 'Ada Lovelace' },
                        { title: 'number', value: '4242 4242 4242 4242' },
                        { title: 'expiry date', value: '12/28' },
                        { title: 'verification number', value: '123' },
                        { title: 'PIN', value: '4567' },
                        { title: 'type', value: 'Visa' },
                      ],
                    },
                  ],
                },
              },
              {
                uuid: 'note',
                favIndex: 0,
                state: 'active',
                categoryUuid: '003',
                overview: { title: 'Note interne' },
                details: { notesPlain: 'Contenu de la note' },
              },
              {
                uuid: 'identity',
                favIndex: 0,
                state: 'active',
                categoryUuid: '004',
                overview: { title: 'Identité' },
                details: {
                  sections: [
                    {
                      title: 'Identité',
                      fields: [
                        { title: 'first name', value: 'Ada' },
                        { title: 'last name', value: 'Lovelace' },
                        { title: 'email', value: 'ada@example.com' },
                        { title: 'address', value: '1 rue de Paris' },
                        { title: 'city', value: 'Paris' },
                        { title: 'postal code', value: '75001' },
                        { title: 'country', value: 'France' },
                        { title: 'birth date', value: '1815-12-10' },
                      ],
                    },
                  ],
                },
              },
              {
                uuid: 'archived',
                favIndex: 0,
                state: 'archived',
                categoryUuid: '001',
                overview: { title: 'Ancien compte', url: 'https://old.example.com' },
                details: {
                  loginFields: [
                    { value: 'ada', designation: 'username' },
                    { value: 'old-secret', designation: 'password' },
                  ],
                },
              },
              {
                uuid: 'trash',
                favIndex: 0,
                state: 'deleted',
                categoryUuid: '001',
                overview: { title: 'Supprimé' },
                details: {},
              },
              {
                uuid: 'document',
                favIndex: 0,
                state: 'active',
                categoryUuid: '006',
                overview: { title: 'Document' },
                details: {
                  notesPlain: 'Document important',
                  documentAttributes: { fileName: 'passeport.png', decryptedSize: 1200 },
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('import 1PUX', () => {
  it('convertit les connexions, cartes, notes et identités', async () => {
    const parsed = await parse1pux(archive(sampleData()), 'v_test')

    expect(parsed.format).toBe('1pux')
    expect(parsed.source).toBe('1password')
    expect(parsed.items).toHaveLength(6)

    expect(parsed.items[0]).toMatchObject({
      type: 'login',
      title: 'GitHub',
      username: 'studio26',
      password: 's3cret!',
      favorite: true,
      notes: 'Compte principal',
      urls: ['https://github.com', 'https://gist.github.com'],
    })
    expect((parsed.items[0] as LoginItem).totp).toContain('otpauth://totp/GitHub')
    expect(parsed.items[0].tags).toEqual(expect.arrayContaining(['travail', 'Privé']))
    expect(parsed.items[0].customFields).toEqual([
      expect.objectContaining({
        label: 'Clé API',
        value: 'abc-123',
        type: 'hidden',
      }),
    ])

    expect(parsed.items[1]).toMatchObject({
      type: 'card',
      title: 'Carte perso',
      cardholder: 'Ada Lovelace',
      number: '4242 4242 4242 4242',
      expiry: '12/28',
      cvc: '123',
      pin: '4567',
      brand: 'Visa',
    })

    expect(parsed.items[2]).toMatchObject({
      type: 'note',
      title: 'Note interne',
      notes: 'Contenu de la note',
    })

    expect(parsed.items[3]).toMatchObject({
      type: 'identity',
      title: 'Identité',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      postalCode: '75001',
      country: 'France',
    })

    expect(parsed.items[4].tags).toContain('Archivé')
    expect(parsed.items[5]).toMatchObject({ type: 'note', title: 'Document' })
    expect(parsed.warnings.join(' ')).toMatch(/pièce jointe/)
    expect(parsed.warnings.join(' ')).toMatch(/historique 1Password/)
  })

  it('refuse une archive invalide', async () => {
    await expect(parse1pux(new Uint8Array([1, 2, 3]), 'v_test')).rejects.toBeInstanceOf(
      ImportError,
    )
  })

  it('refuse une version 1PUX future', async () => {
    const data = sampleData()
    await expect(parse1pux(archive(data, 4), 'v_test')).rejects.toThrow(
      /Version 1PUX 4/,
    )
  })
})
