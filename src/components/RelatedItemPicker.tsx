import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { Modal } from './Modal'
import { ItemIcon } from './ItemIcon'
import { useI18n } from '../state/I18nProvider'
import { buildSearchIndex, normalizeSearchText } from '../lib/vaultSearch'
import { itemSubtitle, type VaultItem } from '../lib/types'

interface RelatedItemPickerProps {
  items: VaultItem[]
  selectedIds: string[]
  /** Élément en cours d’édition : jamais proposé dans sa propre liste. */
  excludeId?: string
  onToggle: (itemId: string) => void
  onClose: () => void
}

/**
 * Sélecteur d’éléments à associer. Les liens sont stockés sur l’élément
 * édité ; la fiche affiche aussi les liens créés depuis les autres éléments.
 */
export function RelatedItemPicker({
  items,
  selectedIds,
  excludeId,
  onToggle,
  onClose,
}: RelatedItemPickerProps) {
  const { tt } = useI18n()
  const [query, setQuery] = useState('')
  const searchIndex = useMemo(() => buildSearchIndex(items), [items])
  const candidates = useMemo(
    () =>
      items
        .filter((item) => item.id !== excludeId && !item.deletedAt)
        .sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })),
    [items, excludeId],
  )
  const normalized = normalizeSearchText(query.trim())
  const results = useMemo(() => {
    const filtered = normalized
      ? candidates.filter((item) =>
          (searchIndex.get(item.id) ?? '').includes(normalized),
        )
      : candidates
    return filtered.slice(0, 30)
  }, [candidates, normalized, searchIndex])
  const selected = new Set(selectedIds)

  return (
    <Modal
      title={tt('Associer un élément')}
      description={tt(
        'Les associations apparaissent sur les deux fiches. Les liens créés depuis un autre élément sont visibles ici en lecture seule.',
      )}
      size="md"
      onClose={onClose}
      footer={
        <button type="button" className="button button--primary" onClick={onClose}>
          {tt('Terminer')}
        </button>
      }
    >
      <div className="related-picker">
        <label className="field related-picker__search">
          <span className="field__label">{tt('Rechercher un élément à associer')}</span>
          <input
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tt('Titre, identifiant, adresse…')}
            autoFocus
          />
        </label>
        {results.length === 0 ? (
          <p className="field__hint">{tt('Aucun élément à associer.')}</p>
        ) : (
          <div className="related-picker__list" role="group" aria-label={tt('Éléments disponibles')}>
            {results.map((item) => {
              const checked = selected.has(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`related-picker__row ${checked ? 'is-selected' : ''}`}
                  aria-pressed={checked}
                  onClick={() => onToggle(item.id)}
                >
                  <span className={`item-icon item-icon--${item.type}`}>
                    <ItemIcon type={item.type} item={item} size={16} />
                  </span>
                  <span className="related-picker__content">
                    <span className="related-picker__title">{item.title}</span>
                    <span className="related-picker__subtitle">
                      {itemSubtitle(item)}
                    </span>
                  </span>
                  {checked && <Check size={16} className="related-picker__check" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
