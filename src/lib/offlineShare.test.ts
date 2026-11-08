import { describe, expect, it } from 'vitest'
import {
  OfflineShareError,
  OfflineShareExpiredError,
  createOfflineShare,
  openOfflineShare,
  parseShareKey,
} from './offlineShare'
import type { LoginItem } from './types'

const NOW = '2026-11-08T10:00:00.000Z'

function login(overrides: Partial<LoginItem> = {}): LoginItem {
  return {
    id: 'i_login',
    vaultId: 'v1',
    type: 'login',
    title: 'GitHub',
    favorite: true,
    notes: 'Compte principal',
    tags: ['dev'],
    customFields: [
      { id: 'f1', label: 'Clé API', value: 'abc-123', type: 'hidden' },
    ],
    attachments: [
      {
        id: 'a1',
        name: 'note.txt',
        mime: 'text/plain',
        size: 12,
        createdAt: NOW,
      },
    ],
    deletedAt: null,
    expiresAt: '',
    createdAt: NOW,
    updatedAt: NOW,
    username: 'studio26',
    password: 's3cret!',
    urls: ['https://github.com'],
    totp: 'otpauth://totp/GitHub?secret=JBSWY3DPEHPK3PXP',
    ...overrides,
  }
}

describe('partage hors ligne', () => {
  it('chiffre puis rouvre un élément avec les mots de clé', async () => {
    const share = await createOfflineShare(login())
    expect(share.filename).toMatch(/^partage-[0-9a-f]{8}\.coffre-share$/)
    expect(share.keyWords.split(' ').length).toBeGreaterThan(15)
    expect(share.keyPayload.startsWith('coffre-key:v1:')).toBe(true)
    expect(share.content).not.toContain('s3cret!')
    expect(share.content).not.toContain('GitHub')

    const opened = await openOfflineShare(share.content, share.keyWords)
    expect(opened.content).toMatchObject({
      type: 'login',
      title: 'GitHub',
      username: 'studio26',
      password: 's3cret!',
      urls: ['https://github.com'],
      favorite: false,
      attachments: [],
      deletedAt: null,
    })
    expect(opened.content.customFields[0]).toMatchObject({
      label: 'Clé API',
      value: 'abc-123',
      type: 'hidden',
    })
  })

  it('accepte la clé sous forme de payload de QR code', async () => {
    const share = await createOfflineShare(login())
    const opened = await openOfflineShare(share.content, share.keyPayload)
    expect(opened.content.title).toBe('GitHub')
  })

  it('refuse une clé incorrecte', async () => {
    const share = await createOfflineShare(login())
    const other = await createOfflineShare(login({ title: 'Autre' }))
    await expect(openOfflineShare(share.content, other.keyWords)).rejects.toThrow(
      /Clé incorrecte/i,
    )
  })

  it('refuse un fichier altéré', async () => {
    const share = await createOfflineShare(login())
    const parsed = JSON.parse(share.content) as {
      cipher: { c: string }
    }
    parsed.cipher.c = `${parsed.cipher.c.slice(0, -4)}AAAA`
    await expect(
      openOfflineShare(JSON.stringify(parsed), share.keyWords),
    ).rejects.toThrow(OfflineShareError)
  })

  it('respecte la date d’expiration', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const share = await createOfflineShare(login(), expiresAt)
    const opened = await openOfflineShare(share.content, share.keyWords)
    expect(opened.expiresAt).toBe(expiresAt)

    await expect(
      openOfflineShare(share.content, share.keyWords, Date.parse(expiresAt) + 1),
    ).rejects.toThrow(OfflineShareExpiredError)
  })

  it('refuse une date d’expiration passée à la création', async () => {
    await expect(
      createOfflineShare(login(), new Date(Date.now() - 1000).toISOString()),
    ).rejects.toThrow(/dans le futur/i)
  })

  it('refuse un format de fichier inconnu', async () => {
    await expect(openOfflineShare('{"format":"autre"}', 'abacus')).rejects.toThrow(
      /pas un partage/i,
    )
    await expect(openOfflineShare('pas du json', 'abacus')).rejects.toThrow(
      /JSON valide/i,
    )
  })

  it('valide la taille et la somme de contrôle de la clé', async () => {
    const share = await createOfflineShare(login())
    await expect(
      parseShareKey(share.keyWords.split(' ').slice(0, 3).join(' ')),
    ).rejects.toThrow(OfflineShareError)
    await expect(parseShareKey('coffre-key:v1:AAAA')).rejects.toThrow(OfflineShareError)

    const envelope = await parseShareKey(share.keyPayload)
    expect(envelope).toHaveLength(32)
  })
})
