import { useState, type FormEvent } from 'react'
import { FolderPlus, LoaderCircle, Pencil } from 'lucide-react'
import { Modal } from './Modal'
import { useVault } from '../state/VaultProvider'
import { useToast } from '../state/ToastProvider'
import type { VaultSummary } from '../lib/types'

interface VaultFormDialogProps {
  mode: 'create' | 'rename'
  vault?: VaultSummary
  onClose: () => void
}

export function VaultFormDialog({ mode, vault, onClose }: VaultFormDialogProps) {
  const { addVault, renameVault } = useVault()
  const { toast } = useToast()
  const [name, setName] = useState(vault?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) {
      setError('Le nom du coffre est obligatoire.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      if (mode === 'create') {
        await addVault(cleanName)
        toast('Coffre créé', 'success')
      } else if (vault) {
        await renameVault(vault.id, cleanName)
        toast('Coffre renommé', 'success')
      }
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Opération impossible')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'create' ? 'Nouveau coffre' : 'Renommer le coffre'}
      description={
        mode === 'create'
          ? 'Un coffre permet de séparer vos éléments (perso, travail, famille…).'
          : 'Le nouveau nom sera chiffré et enregistré localement.'
      }
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button
            type="submit"
            form="vault-form"
            className="button button--primary"
            disabled={busy || !name.trim()}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : mode === 'create' ? (
              <FolderPlus size={16} />
            ) : (
              <Pencil size={16} />
            )}
            {mode === 'create' ? 'Créer' : 'Renommer'}
          </button>
        </>
      }
    >
      <form id="vault-form" className="stack" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span className="field__label">Nom du coffre</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex. Travail"
            maxLength={80}
            autoFocus
            data-autofocus
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
