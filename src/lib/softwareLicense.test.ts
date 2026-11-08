import { describe, expect, it } from 'vitest'
import { parseItemContent } from './vault'
import { emptyDraft, itemSubtitle, itemTypeLabel } from './types'

describe('élément licence logicielle', () => {
  it('initialise les champs', () => {
    const draft = emptyDraft('software-license', 'v1')
    expect(draft.type).toBe('software-license')
    if (draft.type !== 'software-license') throw new Error('type licence attendu')
    expect(draft.licenseKey).toBe('')
    expect(draft.licensedTo).toBe('')
    expect(draft.version).toBe('')
    expect(draft.website).toBe('')
    expect(draft.purchaseDate).toBe('')
  })

  it('valide un contenu déchiffré', () => {
    const content = parseItemContent({
      type: 'software-license',
      title: 'Éditeur',
      favorite: false,
      notes: '',
      tags: [],
      customFields: [],
      attachments: [],
      deletedAt: null,
      expiresAt: '',
      licenseKey: 'AAAA-BBBB-CCCC-DDDD',
      licensedTo: 'Studio 26',
      version: '2026',
      website: 'https://exemple.fr',
      purchaseDate: '2026-01-15',
    })
    expect(content.type).toBe('software-license')
    if (content.type !== 'software-license') throw new Error('type licence attendu')
    expect(content.licensedTo).toBe('Studio 26')
    expect(itemSubtitle({ ...content, id: 'i', vaultId: 'v', createdAt: '', updatedAt: '' })).toBe(
      'Studio 26',
    )
    expect(itemTypeLabel('software-license')).toBe('Licence logicielle')
  })

  it('refuse une clé non textuelle', () => {
    expect(() =>
      parseItemContent({
        type: 'software-license',
        title: 'Éditeur',
        favorite: false,
        notes: '',
        tags: [],
        customFields: [],
        attachments: [],
        deletedAt: null,
        expiresAt: '',
        licenseKey: 42,
        licensedTo: '',
        version: '',
        website: '',
        purchaseDate: '',
      }),
    ).toThrow()
  })
})
