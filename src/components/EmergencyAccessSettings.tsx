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
    createShamirEmergencyAccess,
    removeEmergencyAccess,
  } = useVault()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [record, setRecord] = useState(() => getEmergencyAccess())
  const [mode, setMode] = useState<'immediate' | 'shamir'>('immediate')
  const [contactText, setContactText] = useState('')
  const [shamirText, setShamirText] = useState('')
  const [threshold, setThreshold] = useState(2)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (busy) return
    if (mode === 'immediate' && !contactText.trim()) return
    if (mode === 'shamir' && !shamirText.trim()) return
    setBusy(true)
    try {
      if (mode === 'immediate') {
        await createEmergencyAccess(contactText)
      } else {
        await createShamirEmergencyAccess(shamirText.split('\n'), threshold)
      }
      setRecord(getEmergencyAccess())
      setContactText('')
      setShamirText('')
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
          {record.mode === 'immediate' ? (
            <p className="settings-copy mono">{record.contact.fingerprint}</p>
          ) : (
            <>
              <p className="settings-copy">
                {record.threshold}/{record.total}{' '}
                {tt('contacts requis pour ouvrir l’accès d’urgence')}
              </p>
              <div className="detail-list">
                {record.shares.map((share) => (
                  <div className="detail-row" key={share.contact.fingerprint}>
                    <span className="detail-row__label">
                      <span className="mono">{share.contact.fingerprint}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
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
            <span className="field__label">{tt('Mode d’accès d’urgence')}</span>
            <select
              className="input"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value === 'shamir' ? 'shamir' : 'immediate')
              }
            >
              <option value="immediate">{tt('Contact unique (immédiat)')}</option>
              <option value="shamir">{tt('Shamir 2/3')}</option>
            </select>
          </label>
          {mode === 'immediate' ? (
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
          ) : (
            <>
              <label className="field field--full">
                <span className="field__label">
                  {tt('Identités des contacts (une par ligne)')}
                </span>
                <textarea
                  className="input input--mono"
                  rows={4}
                  value={shamirText}
                  onChange={(event) => setShamirText(event.target.value)}
                  placeholder={tt('Collez une identité publique JSON par ligne')}
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span className="field__label">{tt('Contacts requis')}</span>
                <select
                  className="input"
                  value={threshold}
                  onChange={(event) => setThreshold(Number(event.target.value))}
                >
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
            </>
          )}
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void create()}
              disabled={
                busy ||
                (mode === 'immediate' ? !contactText.trim() : !shamirText.trim())
              }
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
          'Sans serveur, aucun délai ne peut être imposé : un accès immédiat s’ouvre dès que le contact possède le fichier et sa clé privée. En mode Shamir, le nombre de contacts configuré est requis.',
        )}
      </p>
    </section>
  )
}
