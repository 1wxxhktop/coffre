/**
 * Crée un brouillon d’élément à partir d’un modèle personnalisé (F16).
 * Les champs secrets deviennent des champs masqués, les URL et textes longs
 * conservent leur nature ; les valeurs restent vides à la création.
 */

import { randomId } from './crypto'
import { emptyDraft, type ItemDraft, type ItemTemplate, type CustomFieldType } from './types'

function fieldType(type: ItemTemplate['fields'][number]['type']): CustomFieldType {
  if (type === 'secret') return 'hidden'
  if (type === 'url') return 'url'
  if (type === 'multiline') return 'multiline'
  return 'text'
}

export function draftFromTemplate(
  template: ItemTemplate,
  vaultId: string,
): ItemDraft {
  return {
    ...emptyDraft('note', vaultId),
    title: template.name,
    templateId: template.id,
    customFields: template.fields.map((field) => ({
      id: randomId('f'),
      label: field.label,
      value: '',
      type: fieldType(field.type),
    })),
    type: 'note',
  }
}
