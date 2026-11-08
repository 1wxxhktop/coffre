import { describe, expect, it } from 'vitest'
import { draftFromTemplate } from './templateDraft'
import type { ItemTemplate } from './types'

const template: ItemTemplate = {
  id: 'tpl1',
  name: 'Serveur',
  icon: '🖥️',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  fields: [
    { id: 'f1', label: 'Hôte', type: 'text', required: true },
    { id: 'f2', label: 'Clé', type: 'secret' },
    { id: 'f3', label: 'URL', type: 'url' },
    { id: 'f4', label: 'Notes', type: 'multiline' },
    { id: 'f5', label: 'Date', type: 'date' },
  ],
}

describe('brouillon depuis un modèle', () => {
  it('conserve la référence et convertit les types de champs', () => {
    const draft = draftFromTemplate(template, 'v1')
    expect(draft).toMatchObject({
      type: 'note',
      vaultId: 'v1',
      title: 'Serveur',
      templateId: 'tpl1',
    })
    expect(draft.customFields.map((field) => [field.label, field.type])).toEqual([
      ['Hôte', 'text'],
      ['Clé', 'hidden'],
      ['URL', 'url'],
      ['Notes', 'multiline'],
      ['Date', 'text'],
    ])
  })
})
