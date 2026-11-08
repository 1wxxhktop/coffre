import { describe, expect, it } from 'vitest'
import { parseItemContent } from './vault'
import { emptyDraft, itemSubtitle, itemTypeLabel } from './types'

describe('élément clé SSH', () => {
  it('initialise les champs SSH', () => {
    const draft = emptyDraft('ssh-key', 'v1')
    expect(draft.type).toBe('ssh-key')
    if (draft.type !== 'ssh-key') throw new Error('type SSH attendu')
    expect(draft.privateKey).toBe('')
    expect(draft.publicKey).toBe('')
    expect(draft.fingerprint).toBe('')
    expect(draft.comment).toBe('')
  })

  it('valide un contenu SSH déchiffré', () => {
    const content = parseItemContent({
      type: 'ssh-key',
      title: 'Serveur',
      favorite: false,
      notes: '',
      tags: [],
      customFields: [],
      attachments: [],
      deletedAt: null,
      expiresAt: '',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n…',
      publicKey: 'ssh-ed25519 AAAA test',
      fingerprint: 'SHA256:abc',
      comment: 'prod',
    })
    expect(content.type).toBe('ssh-key')
    if (content.type !== 'ssh-key') throw new Error('type SSH attendu')
    expect(content.comment).toBe('prod')
    expect(itemSubtitle({ ...content, id: 'i', vaultId: 'v', createdAt: '', updatedAt: '' })).toBe(
      'prod',
    )
    expect(itemTypeLabel('ssh-key')).toBe('Clé SSH')
  })

  it('refuse un contenu SSH sans clé privée valide', () => {
    expect(() =>
      parseItemContent({
        type: 'ssh-key',
        title: 'Serveur',
        favorite: false,
        notes: '',
        tags: [],
        customFields: [],
        attachments: [],
        deletedAt: null,
        expiresAt: '',
        privateKey: 42,
        publicKey: '',
        fingerprint: '',
        comment: '',
      }),
    ).toThrow()
  })
})
