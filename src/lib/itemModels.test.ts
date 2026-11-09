import { describe, expect, it } from 'vitest'
import { ITEM_MODELS, itemModel } from './itemModels'
import { ITEM_TYPES } from './types'

describe('modèles intégrés', () => {
  it('couvre tous les types d’éléments du coffre', () => {
    expect(ITEM_MODELS.map((model) => model.type).sort()).toEqual([...ITEM_TYPES].sort())
  })

  it('décrit au moins un champ pour chaque modèle', () => {
    for (const model of ITEM_MODELS) {
      expect(model.fields.length, model.name).toBeGreaterThan(0)
    }
  })

  it('laisse les passkeys hors de la création manuelle', () => {
    expect(itemModel('passkey').creatable).toBe(false)
    expect(itemModel('login').creatable).toBe(true)
  })
})
