import { Download, History } from 'lucide-react'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
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
  const { activity } = useVault()
  const { tt, intl } = useI18n()

  const exportJson = () => {
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
          <button
            type="button"
            className="button button--secondary"
            onClick={exportJson}
            disabled={activity.length === 0}
          >
            <Download size={16} />
            {tt('Exporter le journal')}
          </button>
        </div>
      </section>
    </section>
  )
}
