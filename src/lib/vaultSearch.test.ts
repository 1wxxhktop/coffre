import { describe, expect, it } from 'vitest'
import { buildSearchIndex, normalizeSearchText, searchableText } from './vaultSearch'
import type { LoginItem, NoteItem } from './types'

function login(overrides: Partial<LoginItem> = {}): LoginItem {
  return {
    id: 'login-1',
    vaultId: 'vault-1',
    type: 'login',
    title: 'Café GitHub',
    favorite: false,
    notes: '',
    tags: ['Travail'],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    username: 'Ada@Example.com',
    password: 'secret-à-ne-pas-indexer',
    urls: ['https://github.com/ada'],
    totp: '',
    ...overrides,
  }
}

describe('index de recherche du coffre', () => {
  it('normalise la casse et les accents', () => {
    expect(normalizeSearchText('Café ÉLAN')).toBe('cafe elan')
  })

  it('trouve un titre accentué avec une requête sans accent', () => {
    const item = login()
    const index = buildSearchIndex([item])
    expect(index.get(item.id)).toContain('cafe github')
    expect(index.get(item.id)).toContain('travail')
    expect(index.get(item.id)).toContain('ada@example.com')
  })

  it('n’indexe jamais les valeurs secrètes', () => {
    const item = login({
      customFields: [
        {
          id: 'field-1',
          label: 'Code de secours',
          type: 'password',
          value: 'code-très-secret',
        },
        {
          id: 'field-2',
          label: 'Environnement',
          type: 'text',
          value: 'production',
        },
      ],
    })
    const text = searchableText(item)
    expect(text).not.toContain('secret-à-ne-pas-indexer')
    expect(text).not.toContain('code-très-secret')
    expect(text).toContain('code de secours')
    expect(text).toContain('production')
  })

  it('ajoute les champs spécifiques au type', () => {
    const note: NoteItem = {
      id: 'note-1',
      vaultId: 'vault-1',
      type: 'note',
      title: 'Wi-Fi maison',
      favorite: false,
      notes: 'Box au salon',
      tags: [],
      customFields: [],
      attachments: [],
      deletedAt: null,
      expiresAt: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(searchableText(note)).toContain('wi-fi maison')
    expect(searchableText(note)).toContain('box au salon')
  })
})
