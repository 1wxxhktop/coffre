import { useState } from 'react'
import { AlertTriangle, Download, ShieldAlert } from 'lucide-react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { exportCxf } from '../lib/cxf'
import { downloadFile } from '../lib/settings'
import type { VaultItem } from '../lib/types'

interface CxfExportDialogProps {
  items: VaultItem[]
  onClose: () => void
}

/**
 * Export CXF 1.0 (FIDO Alliance) en JSON. Le fichier n’est pas chiffré : il
 * contient les mots de passe et les clés privées des passkeys en clair.
 */
export function CxfExportDialog({ items, onClose }: CxfExportDialogProps) {
  const { tt } = useI18n()
  const { toast } = useToast()
  const [acknowledged, setAcknowledged] = useState(false)

  const active = items.filter((item) => !item.deletedAt)
  const passkeys = active.filter((item) => item.type === 'passkey').length

  const exportFile = () => {
    const result = exportCxf(active)
    downloadFile(result.json, 'coffre.cxf.json', 'application/json')
    toast(tt('Export CXF téléchargé'), 'success')
    for (const warning of result.warnings.slice(0, 3)) toast(warning, 'info')
    onClose()
  }

  return (
    <Modal
      title={tt('Exporter en CXF')}
      description={tt('Format de portabilité FIDO pour les mots de passe et les passkeys.')}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            {tt('Annuler')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={exportFile}
            disabled={!acknowledged || active.length === 0}
          >
            <Download size={16} />
            {tt('Exporter le fichier CXF')}
          </button>
        </>
      }
    >
      <div className="form">
        <p className="settings-copy">
          <ShieldAlert size={15} />{' '}
          {tt(
            'Le fichier CXF n’est pas chiffré : il contient vos mots de passe et les clés privées de vos passkeys en clair.',
          )}
        </p>
        <p className="settings-copy">
          <AlertTriangle size={15} />{' '}
          {tt(
            'Transférez-le uniquement vers un gestionnaire de confiance, puis supprimez-le. Les pièces jointes ne sont pas incluses.',
          )}
        </p>
        <p className="field__hint">
          {tt('{count} élément(s) actif(s), dont {passkeys} passkey(s).')
            .replace('{count}', String(active.length))
            .replace('{passkeys}', String(passkeys))}
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            {tt(
              'Je comprends que ce fichier contient des secrets en clair et je le stocke en conséquence.',
            )}
          </span>
        </label>
      </div>
    </Modal>
  )
}
