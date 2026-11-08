import { describe, expect, it } from 'vitest'
import { parseItemContent } from './vault'
import { emptyDraft, itemSubtitle, itemTypeLabel } from './types'

describe('élément document', () => {
  it('initialise les champs', () => {
    const draft = emptyDraft('document', 'v1')
    expect(draft.type).toBe('document')
    if (draft.type !== 'document') throw new Error('type document attendu')
    expect(draft.documentKind).toBe('other')
    expect(draft.issuer).toBe('')
    expect(draft.documentNumber).toBe('')
    expect(draft.issuedAt).toBe('')
  })

  it('valide un contenu déchiffré', () => {
    const content = parseItemContent({
      type: 'document',
      title: 'Passeport',
      favorite: false,
      notes: '',
      tags: [],
      customFields: [],
      attachments: [],
      deletedAt: null,
      expiresAt: '',
      documentKind: 'identity',
      issuer: 'République française',
      documentNumber: '12AB34567',
      issuedAt: '2024-05-01',
    })
    expect(content.type).toBe('document')
    if (content.type !== 'document') throw new Error('type document attendu')
    expect(content.documentNumber).toBe('12AB34567')
    expect(itemSubtitle({ ...content, id: 'i', vaultId: 'v', createdAt: '', updatedAt: '' })).toBe(
      'République française',
    )
    expect(itemTypeLabel('document')).toBe('Document')
  })

  it('refuse un type de document inconnu', () => {
    expect(() =>
      parseItemContent({
        type: 'document',
        title: 'Document',
        favorite: false,
        notes: '',
        tags: [],
        customFields: [],
        attachments: [],
        deletedAt: null,
        expiresAt: '',
        documentKind: 'inconnu',
        issuer: '',
        documentNumber: '',
        issuedAt: '',
      }),
    ).toThrow()
  })
})
