import { useEffect, useState } from 'react'
import { AlertTriangle, Clock, History, LoaderCircle, RotateCcw } from 'lucide-react'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { useVault } from '../state/VaultProvider'
import { useToast } from '../state/ToastProvider'
import { formatDateTime } from '../lib/settings'
import { itemTypeLabel, type VaultItem } from '../lib/types'
import type { ItemVersion } from '../lib/vault'

interface HistoryDialogProps {
  item: VaultItem
  onClose: () => void
  onRestored?: (item: VaultItem) => void
}

/**
 * Liste les versions précédentes d’un élément. Le contenu des versions est
 * déchiffré à la demande, uniquement à l’ouverture de ce dialogue.
 */
export function HistoryDialog({ item, onClose, onRestored }: HistoryDialogProps) {
  const { getItemVersions, restoreItemVersion } = useVault()
  const { toast } = useToast()

  const [versions, setVersions] = useState<ItemVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<ItemVersion | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await getItemVersions(item.id)
        if (!cancelled) setVersions(list)
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : 'Historique indisponible',
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [getItemVersions, item.id])

  const restore = async () => {
    if (!pending) return
    const updated = await restoreItemVersion(item.id, pending.id)
    toast('Version restaurée', 'success')
    onRestored?.(updated)
    setPending(null)
    onClose()
  }

  return (
    <>
      <Modal
        title="Historique"
        description={`Versions précédentes de « ${item.title} ». Les 20 dernières modifications sont conservées.`}
        size="md"
        onClose={onClose}
        footer={
          <button type="button" className="button button--ghost" onClick={onClose}>
            Fermer
          </button>
        }
      >
        {error ? (
          <p className="form-error" role="alert">
            <AlertTriangle size={16} />
            {error}
          </p>
        ) : versions === null ? (
          <div className="history-empty" role="status">
            <LoaderCircle size={22} className="spin" />
            <p>Déchiffrement de l’historique…</p>
          </div>
        ) : versions.length === 0 ? (
          <div className="history-empty">
            <History size={26} />
            <h3>Aucune version enregistrée</h3>
            <p>
              Une version est créée automatiquement à chaque modification des champs
              d’un élément. Les changements de favori, les pièces jointes et les passages
              par la corbeille ne créent pas d’entrée.
            </p>
          </div>
        ) : (
          <ul className="history-list">
            {versions.map((version) => (
              <li className="history-item" key={version.id}>
                <span className="history-item__icon">
                  <Clock size={16} />
                </span>
                <span className="history-item__body">
                  <span className="history-item__title">{version.content.title}</span>
                  <span className="history-item__meta">
                    {itemTypeLabel(version.content.type)} · remplacée le{' '}
                    {formatDateTime(version.createdAt)}
                  </span>
                  {version.content.notes.trim() && (
                    <span className="history-item__preview">
                      {version.content.notes.replace(/\s+/g, ' ').trim().slice(0, 120)}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="button button--secondary button--sm"
                  onClick={() => setPending(version)}
                >
                  <RotateCcw size={14} />
                  Restaurer
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {pending && (
        <ConfirmDialog
          title="Restaurer cette version ?"
          description={`Le contenu actuel de « ${item.title} » sera remplacé par la version du ${formatDateTime(
            pending.createdAt,
          )}. Le contenu actuel sera conservé dans l’historique.`}
          confirmLabel="Restaurer"
          tone="primary"
          onClose={() => setPending(null)}
          onConfirm={restore}
        />
      )}
    </>
  )
}
