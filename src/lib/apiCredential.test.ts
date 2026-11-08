import { describe, expect, it } from 'vitest'
import { parseItemContent } from './vault'
import { emptyDraft, itemSubtitle, itemTypeLabel } from './types'

describe('élément identifiant d’API', () => {
  it('initialise les champs', () => {
    const draft = emptyDraft('api-credential', 'v1')
    expect(draft.type).toBe('api-credential')
    if (draft.type !== 'api-credential') throw new Error('type API attendu')
    expect(draft.keyId).toBe('')
    expect(draft.secret).toBe('')
    expect(draft.environment).toBe('')
    expect(draft.endpoint).toBe('')
  })

  it('valide un contenu déchiffré', () => {
    const content = parseItemContent({
      type: 'api-credential',
      title: 'Service de paiement',
      favorite: false,
      notes: '',
      tags: [],
      customFields: [],
      attachments: [],
      deletedAt: null,
      expiresAt: '',
      keyId: 'pk_live_123',
      secret: 'sk_live_secret',
      environment: 'Production',
      endpoint: 'https://api.exemple.fr',
    })
    expect(content.type).toBe('api-credential')
    if (content.type !== 'api-credential') throw new Error('type API attendu')
    expect(content.keyId).toBe('pk_live_123')
    expect(itemSubtitle({ ...content, id: 'i', vaultId: 'v', createdAt: '', updatedAt: '' })).toBe(
      'pk_live_123',
    )
    expect(itemTypeLabel('api-credential')).toBe('Identifiant d’API')
  })

  it('refuse un secret non textuel', () => {
    expect(() =>
      parseItemContent({
        type: 'api-credential',
        title: 'Service',
        favorite: false,
        notes: '',
        tags: [],
        customFields: [],
        attachments: [],
        deletedAt: null,
        expiresAt: '',
        keyId: 'pk',
        secret: 42,
        environment: '',
        endpoint: '',
      }),
    ).toThrow()
  })
})
