import { describe, expect, it } from 'vitest'
import {
  CUSTOM_FIELD_PRESET_GROUPS,
  CUSTOM_FIELD_PRESETS,
  customFieldPresetForLabel,
  UNIQUE_CUSTOM_FIELD_PRESETS,
} from './customFieldPresets'
import { CUSTOM_FIELD_TYPES } from './types'

describe('catalogue de champs prédéfinis', () => {
  it('décrit chaque champ avec un libellé, un groupe et un type valide', () => {
    expect(CUSTOM_FIELD_PRESETS.length).toBeGreaterThan(30)
    for (const preset of CUSTOM_FIELD_PRESETS) {
      expect(preset.label.trim()).not.toBe('')
      expect(preset.group.trim()).not.toBe('')
      expect(CUSTOM_FIELD_TYPES).toContain(preset.type)
    }
  })

  it('ne propose pas deux fois le même libellé', () => {
    const labels = UNIQUE_CUSTOM_FIELD_PRESETS.map((preset) =>
      preset.label.toLocaleLowerCase('fr'),
    )
    expect(new Set(labels).size).toBe(labels.length)
    expect(
      CUSTOM_FIELD_PRESET_GROUPS.flatMap((group) => group.presets),
    ).toHaveLength(UNIQUE_CUSTOM_FIELD_PRESETS.length)
  })

  it('associe les champs bancaires à leurs types dédiés', () => {
    expect(customFieldPresetForLabel('IBAN')?.type).toBe('iban')
    expect(customFieldPresetForLabel('bic / swift')?.type).toBe('bic')
    expect(customFieldPresetForLabel('Numéro de carte')?.type).toBe('card')
    expect(customFieldPresetForLabel('Devise')?.type).toBe('currency')
    expect(customFieldPresetForLabel('Champ libre')).toBeUndefined()
  })
})
