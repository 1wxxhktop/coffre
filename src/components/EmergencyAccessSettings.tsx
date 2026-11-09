import { useState } from 'react'
import { LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react'
import { formatDateTime } from '../lib/settings'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { useVault } from '../state/VaultProvider'

export function EmergencyAccessSettings() {
  const {
    getEmergencyAccess,
    createEmergencyAccess,
    removeEmergencyAccess,
  } = useVault()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [record, setRecord] = useState(() => getEmergencyAccess())
  const [contactText, setContactText] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!contactText.trim() || busy) return
    setBusy(true)
    try {
      await createEmergencyAccess(contactText)
      setRecord(getEmergencyAccess())
      setContactText('')
      toast(tt('Accès d’urgence configuré'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : tt('Configuration impossible'),
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      await removeEmergencyAccess()
      setRecord(null)
      toast(tt('Accès d’urgence supprimé'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : tt('Suppression impossible'),
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section__head">
        <span className="settings-section__icon">
          <ShieldCheck size={18} />
        </span>
        <div>
          <h3>{tt('Accès d’urgence')}</h3>
          <p>{tt('Enveloppe la clé maîtresse pour un contact de confiance.')}</p>
        </div>
      </div>

      {record ? (
        <>
          <p className="settings-copy">
            {tt('Contact configuré le')} {formatDateTime(record.createdAt)}
          </p>
          <p className="settings-copy mono">{record.contact.fingerprint}</p>
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--danger-text"
              onClick={() => void remove()}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Trash2 size={16} />
              )}
              {tt('Supprimer l’accès d’urgence')}
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="field field--full">
            <span className="field__label">{tt('Identité du contact')}</span>
            <textarea
              className="input input--mono"
              rows={4}
              value={contactText}
              onChange={(event) => setContactText(event.target.value)}
              placeholder={tt('Collez l’identité publique JSON du contact')}
              spellCheck={false}
            />
          </label>
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void create()}
              disabled={busy || !contactText.trim()}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <ShieldCheck size={16} />
              )}
              {tt('Configurer l’accès d’urgence')}
            </button>
          </div>
        </>
      )}

      <p className="settings-copy">
        {tt(
          'Sans serveur, aucun délai ne peut être imposé : le contact qui possède le fichier et sa clé privée peut ouvrir l’enveloppe immédiatement. Le partage Shamir 2/3 reste à venir.',
        )}
      </p>
    </section>
  )
}
