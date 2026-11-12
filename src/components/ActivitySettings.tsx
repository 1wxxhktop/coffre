import { useState } from 'react'
import { Download, History } from 'lucide-react'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { downloadFile, formatDateTime } from '../lib/settings'
import type { ActivityKind } from '../lib/types'

const LABELS: Record<ActivityKind, string> = {
  unlock: 'Déverrouillage',
  'unlock-failed': 'Échec de déverrouillage',
  lock: 'Verrouillage',
  export: 'Export',
  'password-change': 'Changement de mot de passe',
  'recovery-change': 'Changement de récupération',
  pairing: 'Appairage',
  share: 'Partage',
  'extension-fill': 'Remplissage par l’extension',
  'phishing-warning': 'Avertissement anti-hameçonnage',
  autotype: 'Saisie automatique',
  'ssh-agent': 'Agent SSH',
}

export function ActivitySettings() {
  const { activity, confirmMasterPassword } = useVault()
  const { tt, intl } = useI18n()
  const { toast } = useToast()
  const [masterPassword, setMasterPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const exportJson = async () => {
    if (!masterPassword || busy) return
    setBusy(true)
    try {
      if (!(await confirmMasterPassword(masterPassword))) {
        toast(tt('Mot de passe maître incorrect'), 'error')
        return
      }
      setMasterPassword('')
      downloadFile(
        JSON.stringify(
          activity.map((event) => ({
            ...event,
            kind: LABELS[event.kind] ?? event.kind,
          })),
          null,
          2,
        ),
        'coffre-journal-activite.json',
        'application/json',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings__page" aria-labelledby="settings-activity">
      <div className="settings__page-head">
        <div>
          <h3 id="settings-activity">{tt('Journal d’activité')}</h3>
          <p>
            {tt(
              'Événements sensibles conservés chiffrés dans le coffre. Utile pour repérer un usage inattendu.',
            )}
          </p>
        </div>
      </div>

      <section className="settings-section">
        <div className="settings-section__head">
          <span className="settings-section__icon">
            <History size={18} />
          </span>
          <div>
            <h3>{tt('Événements récents')}</h3>
            <p>
              {activity.length} {tt('événement(s)')}
            </p>
          </div>
        </div>

        {activity.length === 0 ? (
          <p className="field__hint">{tt('Aucun événement enregistré.')}</p>
        ) : (
          <ul className="activity-list">
            {activity.map((event) => (
              <li key={event.id} className="activity-item">
                <span className={`activity-item__kind activity-item__kind--${event.kind}`}>
                  {tt(LABELS[event.kind] ?? event.kind)}
                </span>
                <div className="activity-item__text">
                  <strong>{event.detail || LABELS[event.kind]}</strong>
                  <span>
                    {formatDateTime(event.at, intl)}
                    {event.host ? ` · ${event.host}` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="settings-actions settings-actions--start">
          <label className="field">
            <span className="field__label">{tt('Mot de passe maître')}</span>
            <input
              className="input"
              type="password"
              value={masterPassword}
              onChange={(event) => setMasterPassword(event.target.value)}
              autoComplete="current-password"
              placeholder={tt('Ressaisissez votre mot de passe maître')}
            />
          </label>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void exportJson()}
            disabled={activity.length === 0 || !masterPassword || busy}
          >
            <Download size={16} />
            {tt('Exporter le journal')}
          </button>
        </div>
      </section>
    </section>
  )
}
