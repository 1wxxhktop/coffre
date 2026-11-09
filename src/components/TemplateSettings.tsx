import { useState } from 'react'
import { Check, LayoutGrid, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import {
  emptyDraft as emptyItemDraft,
  ITEM_TYPES,
  itemTypeLabel,
  type ItemTemplate,
  type ItemType,
  type TemplateField,
  type TemplateFieldType,
} from '../lib/types'
import {
  COMMON_MODEL_FIELDS,
  ITEM_MODELS,
  type ItemModel,
} from '../lib/itemModels'
import { draftFromTemplate } from '../lib/templateDraft'

const FIELD_TYPES: Array<{ value: TemplateFieldType; label: string }> = [
  { value: 'text', label: 'Texte' },
  { value: 'secret', label: 'Secret' },
  { value: 'url', label: 'URL' },
  { value: 'date', label: 'Date' },
  { value: 'multiline', label: 'Texte long' },
]

interface Draft {
  id?: string
  name: string
  icon: string
  type: ItemType
  fields: TemplateField[]
}

function emptyDraft(): Draft {
  return {
    name: '',
    icon: '📦',
    type: 'note',
    fields: [{ id: `tf_${Date.now()}`, label: '', type: 'text' }],
  }
}

function draftFrom(template: ItemTemplate): Draft {
  return {
    id: template.id,
    name: template.name,
    icon: template.icon,
    type: template.type ?? 'note',
    fields: template.fields.map((field) => ({ ...field })),
  }
}

export function TemplateSettings() {
  const { templates, vaults, addItem, createTemplate, updateTemplate, deleteTemplate } =
    useVault()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startCreate = () => {
    setDraft(emptyDraft())
    setError(null)
  }

  const startEdit = (template: ItemTemplate) => {
    setDraft(draftFrom(template))
    setError(null)
  }

  const updateField = (index: number, patch: Partial<TemplateField>) => {
    if (!draft) return
    setDraft({
      ...draft,
      fields: draft.fields.map((field, position) =>
        position === index ? { ...field, ...patch } : field,
      ),
    })
  }

  const addField = () => {
    if (!draft || draft.fields.length >= 30) return
    setDraft({
      ...draft,
      fields: [
        ...draft.fields,
        { id: `tf_${Date.now()}_${draft.fields.length}`, label: '', type: 'text' },
      ],
    })
  }

  const removeField = (index: number) => {
    if (!draft || draft.fields.length <= 1) return
    setDraft({
      ...draft,
      fields: draft.fields.filter((_, position) => position !== index),
    })
  }

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const input = {
        name: draft.name,
        icon: draft.icon,
        type: draft.type,
        fields: draft.fields,
      }
      if (draft.id) {
        await updateTemplate(draft.id, input)
        toast(tt('Modèle mis à jour.'), 'success')
      } else {
        await createTemplate(input)
        toast(tt('Modèle créé.'), 'success')
      }
      setDraft(null)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : tt('Enregistrement impossible.'),
      )
    } finally {
      setBusy(false)
    }
  }

  const createFromTemplate = async (template: ItemTemplate) => {
    if ((template.type ?? 'note') === 'passkey') {
      setError(tt('Les passkeys se créent depuis un site via WebAuthn.'))
      return
    }
    const vaultId = vaults[0]?.id
    if (!vaultId) {
      setError(tt('Aucun coffre de destination disponible.'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addItem(draftFromTemplate(template, vaultId))
      toast(tt('Élément créé depuis le modèle.'), 'success')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : tt('Création impossible.'),
      )
    } finally {
      setBusy(false)
    }
  }

  const createFromModel = async (model: ItemModel) => {
    if (!model.creatable) {
      setError(tt('Les passkeys se créent depuis un site via WebAuthn.'))
      return
    }
    const vaultId = vaults[0]?.id
    if (!vaultId) {
      setError(tt('Aucun coffre de destination disponible.'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addItem({
        ...emptyItemDraft(model.type, vaultId),
        title: model.name,
      })
      toast(tt('Élément créé depuis le modèle intégré.'), 'success')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : tt('Création impossible.'),
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async (template: ItemTemplate) => {
    setBusy(true)
    setError(null)
    try {
      await deleteTemplate(template.id)
      if (draft?.id === template.id) setDraft(null)
      toast(tt('Modèle supprimé.'), 'success')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : tt('Suppression impossible.'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings__page" aria-labelledby="settings-templates">
      <div className="settings__page-head">
        <div>
          <h3 id="settings-templates">{tt('Modèles d’éléments')}</h3>
          <p>
            {tt(
              'Définissez vos propres types d’éléments. Les modèles sont chiffrés dans le coffre et synchronisés avec lui.',
            )}
          </p>
        </div>
      </div>

      <section className="settings-section">
        <div className="settings-section__head">
          <span className="settings-section__icon">
            <LayoutGrid size={18} />
          </span>
          <div>
            <h3>{tt('Modèles intégrés')}</h3>
            <p>{tt('Tous les types d’éléments du coffre, avec leurs champs.')}</p>
          </div>
        </div>

        <p className="model-grid__note">
          {tt('Tous les modèles incluent :')}{' '}
          {COMMON_MODEL_FIELDS.map((field) => tt(field.label)).join(', ')}.
        </p>

        <div className="model-grid">
          {ITEM_MODELS.map((model) => (
            <article className="model-card" key={model.type} data-model={model.type}>
              <div className="model-card__head">
                <span className="model-card__icon" aria-hidden="true">
                  {model.icon}
                </span>
                <div>
                  <strong>{tt(model.name)}</strong>
                  {itemTypeLabel(model.type) !== model.name && (
                    <span>{itemTypeLabel(model.type)}</span>
                  )}
                </div>
              </div>
              <p>{tt(model.description)}</p>
              <ul className="model-card__fields">
                {model.fields.map((field) => (
                  <li key={field.label}>{tt(field.label)}</li>
                ))}
              </ul>
              <button
                type="button"
                className="button button--secondary button--sm"
                onClick={() => void createFromModel(model)}
                disabled={busy || !model.creatable}
              >
                {model.creatable && <Plus size={14} />}
                {model.creatable ? tt('Créer un élément') : tt('Créé via WebAuthn')}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section__head">
          <span className="settings-section__icon">
            <Plus size={18} />
          </span>
          <div>
            <h3>{draft?.id ? tt('Modifier le modèle') : tt('Nouveau modèle')}</h3>
            <p>{tt('Jusqu’à 30 champs par modèle.')}</p>
          </div>
        </div>

        {!draft ? (
          <div className="settings-actions settings-actions--start">
            <button type="button" className="button button--primary" onClick={startCreate}>
              <Plus size={16} />
              {tt('Créer un modèle')}
            </button>
          </div>
        ) : (
          <div className="form">
            <div className="form-grid">
              <label className="field">
                <span className="field__label">{tt('Nom du modèle')}</span>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  maxLength={80}
                  autoFocus
                />
              </label>
              <label className="field">
                <span className="field__label">{tt('Icône')}</span>
                <input
                  className="input"
                  value={draft.icon}
                  onChange={(event) => setDraft({ ...draft, icon: event.target.value })}
                  maxLength={16}
                />
              </label>
              <label className="field">
                <span className="field__label">{tt('Type d’élément')}</span>
                <select
                  className="input"
                  value={draft.type}
                  onChange={(event) =>
                    setDraft({ ...draft, type: event.target.value as ItemType })
                  }
                >
                  {ITEM_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {itemTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="template-fields">
              {draft.fields.map((field, index) => (
                <div key={field.id} className="template-field">
                  <input
                    className="input"
                    value={field.label}
                    onChange={(event) => updateField(index, { label: event.target.value })}
                    placeholder={tt('Libellé du champ')}
                    maxLength={80}
                    aria-label={tt('Libellé du champ')}
                  />
                  <select
                    className="input"
                    value={field.type}
                    onChange={(event) =>
                      updateField(index, { type: event.target.value as TemplateFieldType })
                    }
                    aria-label={tt('Type du champ')}
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {tt(type.label)}
                      </option>
                    ))}
                  </select>
                  <label className="checkbox template-field__flag">
                    <input
                      type="checkbox"
                      checked={field.fillable === true}
                      onChange={(event) =>
                        updateField(index, { fillable: event.target.checked })
                      }
                    />
                    <span>{tt('Remplissable')}</span>
                  </label>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => removeField(index)}
                    disabled={draft.fields.length <= 1}
                    aria-label={tt('Supprimer le champ')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="settings-actions settings-actions--start">
              <button type="button" className="button button--secondary" onClick={addField}>
                <Plus size={16} />
                {tt('Ajouter un champ')}
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void save()}
                disabled={busy || !draft.name.trim()}
              >
                {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
                {tt('Enregistrer le modèle')}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setDraft(null)}
              >
                {tt('Annuler')}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {templates.length > 0 && (
        <section className="settings-section">
          <div className="settings-section__head">
            <span className="settings-section__icon">
              <Pencil size={18} />
            </span>
            <div>
              <h3>{tt('Modèles enregistrés')}</h3>
              <p>
                {templates.length} {tt('modèle(s)')}
              </p>
            </div>
          </div>
          <ul className="template-list">
            {templates.map((template) => (
              <li key={template.id} className="template-list__item">
                <span className="template-list__icon">{template.icon}</span>
                <div className="template-list__text">
                  <strong>{template.name}</strong>
                  <span>
                    {itemTypeLabel(template.type ?? 'note')} · {template.fields.length}{' '}
                    {tt('champ(s)')}
                  </span>
                </div>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void createFromTemplate(template)}
                  disabled={busy}
                  aria-label={tt('Créer un élément depuis {name}').replace(
                    '{name}',
                    template.name,
                  )}
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => startEdit(template)}
                  aria-label={tt('Modifier {name}').replace('{name}', template.name)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void remove(template)}
                  aria-label={tt('Supprimer {name}').replace('{name}', template.name)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
