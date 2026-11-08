import { useState } from 'react'
import { AlertTriangle, Download, LoaderCircle, ShieldCheck } from 'lucide-react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { writeKdbx } from '../lib/kdbx'
import { downloadBytes } from '../lib/settings'
import type { VaultItem, VaultSummary } from '../lib/types'

interface KdbxExportDialogProps {
  items: VaultItem[]
  vaults: VaultSummary[]
  onClose: () => void
}

/**
 * Export KeePass KDBX 4 avec un mot de passe dédié. Le fichier produit est
 * lisible par KeePassXC/KeePass 2.x et ne contient pas les pièces jointes ni
 * l’historique Coffre.
 */
export function KdbxExportDialog({ items, vaults, onClose }: KdbxExportDialogProps) {
  const { tt } = useI18n()
  const { toast } = useToast()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = items.filter((item) => !item.deletedAt)
  const canExport =
    active.length > 0 &&
    password.length >= 8 &&
    password === confirmPassword &&
    !busy

  const exportFile = async () => {
    if (!canExport) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await writeKdbx({
        password,
        items: active,
        vaultNames: new Map(vaults.map((vault) => [vault.id, vault.name])),
        databaseName: 'Coffre',
      })
      downloadBytes(bytes, 'coffre.kdbx', 'application/octet-stream')
      toast(tt('Base KDBX exportée'), 'success')
      onClose()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : tt('Export KDBX impossible'),
      )
      setBusy(false)
    }
  }

  return (
    <Modal
      title={tt('Exporter en KDBX')}
      description={tt('Une base KeePass 4 chiffrée avec un mot de passe dédié.')}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            {tt('Annuler')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void exportFile()}
            disabled={!canExport}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Download size={16} />
            )}
            {busy ? tt('Export en cours…') : tt('Exporter')}
          </button>
        </>
      }
    >
      <div className="form">
        <p className="settings-copy">
          <ShieldCheck size={15} />{' '}
          {tt(
            'Le fichier .kdbx contient tous les éléments actifs. Les pièces jointes et l’historique ne sont pas inclus.',
          )}
        </p>

        <label className="field field--full">
          <span className="field__label">{tt('Mot de passe KDBX')}</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder={tt('8 caractères minimum')}
            autoFocus
            data-autofocus
          />
          {password.length !== 0 && password.length < 8 && (
            <span className="field__hint field__hint--error">
              {tt('Mot de passe trop court (8 caractères minimum).')}
            </span>
          )}
        </label>

        <label className="field field--full">
          <span className="field__label">{tt('Confirmer le mot de passe')}</span>
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            placeholder={tt('Répétez le mot de passe')}
          />
          {confirmPassword.length > 0 && password !== confirmPassword && (
            <span className="field__hint field__hint--error">
              {tt('Les mots de passe ne correspondent pas.')}
            </span>
          )}
        </label>

        {error && (
          <p className="form-error" role="alert">
            <AlertTriangle size={16} />
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
