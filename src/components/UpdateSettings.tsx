import { AlertTriangle, Download, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react'
import { useSettings } from '../state/SettingsProvider'
import { useI18n } from '../state/I18nProvider'
import { useUpdates } from '../state/UpdateProvider'
import { formatDateTime } from '../lib/settings'
import { isPrerelease, progressPercent, UPDATE_ERROR_TEXTS } from '../lib/updates'
import { automaticUpdatePreset, isFullyAutomaticUpdate } from '../lib/extensionInstall'

export function UpdateSettings() {
  const { settings, updateSettings } = useSettings()
  const { tt, intl } = useI18n()
  const {
    supported,
    info,
    status,
    update,
    progress,
    error,
    check,
    download,
    install,
    skip,
    changeChannel,
  } = useUpdates()

  const header = (
    <div className="settings-section__head">
      <span className="settings-section__icon">
        <Download size={18} />
      </span>
      <div>
        <h3 id="settings-updates">{tt('Mises à jour')}</h3>
        <p>
          {supported
            ? tt(
                'Nouvelles versions publiées sur GitHub, signées et vérifiées avant installation.',
              )
            : tt(
                'La version Web se met à jour automatiquement à chaque visite, sans action de votre part.',
              )}
        </p>
      </div>
    </div>
  )

  if (!supported) {
    return (
      <section className="settings-section" aria-labelledby="settings-updates">
        {header}
        <p className="settings-copy">
          {tt('Version installée :')} {__APP_VERSION__}
        </p>
      </section>
    )
  }

  const configured = info?.configured === true
  const busy = status === 'checking' || status === 'downloading' || status === 'installing'
  const percent = progressPercent(progress)

  return (
    <section className="settings-section" aria-labelledby="settings-updates">
      {header}

      {info && !configured && (
        <p className="form-error" role="status">
          <AlertTriangle size={16} />
          {tt(UPDATE_ERROR_TEXTS['not-configured'])}
        </p>
      )}

      <dl className="update-facts">
        <div>
          <dt>{tt('Version installée')}</dt>
          <dd>{info?.currentVersion || __APP_VERSION__}</dd>
        </div>
        <div>
          <dt>{tt('Dernière vérification')}</dt>
          <dd>
            {settings.updateLastCheckAt
              ? formatDateTime(settings.updateLastCheckAt, intl)
              : tt('Jamais')}
          </dd>
        </div>
      </dl>

      <div className="settings-actions settings-actions--start">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void check()}
          disabled={!configured || busy}
        >
          {status === 'checking' ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          {status === 'checking' ? tt('Recherche…') : tt('Rechercher maintenant')}
        </button>
        <span className="settings-copy" role="status">
          {status === 'up-to-date' && tt('Coffre est à jour.')}
          {status === 'error' && error && tt(UPDATE_ERROR_TEXTS[error] ?? UPDATE_ERROR_TEXTS['check-failed'])}
        </span>
      </div>

      {update && (
        <div className="update-card" aria-live="polite">
          <div className="update-card__head">
            <strong>
              {tt('Version {version} disponible').replace('{version}', update.version)}
            </strong>
            {isPrerelease(update.version) && (
              <span className="update-card__badge">{tt('Préversion')}</span>
            )}
            {update.date && (
              <span className="settings-copy">{formatDateTime(update.date, intl)}</span>
            )}
          </div>
          {update.notes && (
            <details className="update-card__notes">
              <summary>{tt('Notes de version')}</summary>
              <p>{update.notes}</p>
            </details>
          )}
          {status === 'downloading' && (
            <div className="update-progress">
              <progress
                max={100}
                value={percent ?? undefined}
                aria-label={tt('Téléchargement de la mise à jour')}
              />
              <span className="settings-copy">
                {percent === null ? tt('Téléchargement…') : `${percent} %`}
              </span>
            </div>
          )}
          <div className="settings-actions settings-actions--start">
            {(status === 'available' || (status === 'error' && error === 'download-failed')) && (
              <button
                type="button"
                className="button button--primary"
                onClick={() => void download()}
              >
                <Download size={16} />
                {tt('Télécharger')}
              </button>
            )}
            {status === 'ready' && (
              <button
                type="button"
                className="button button--primary"
                onClick={() => void install()}
              >
                <RotateCcw size={16} />
                {tt('Installer et redémarrer')}
              </button>
            )}
            {status === 'installing' && (
              <span className="settings-copy">
                <LoaderCircle size={16} className="spin" />
                {tt('Installation… Coffre va redémarrer.')}
              </span>
            )}
            {status !== 'installing' && (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void skip()}
                disabled={busy}
              >
                {tt('Ignorer cette version')}
              </button>
            )}
          </div>
          {status === 'ready' && settings.updateInstallMode === 'on-quit' && (
            <p className="settings-copy">
              {tt('La mise à jour sera installée à la fermeture de Coffre.')}
            </p>
          )}
        </div>
      )}

      <label className="checkbox update-auto">
        <input
          type="checkbox"
          checked={isFullyAutomaticUpdate(settings)}
          onChange={(event) =>
            updateSettings(automaticUpdatePreset(event.target.checked, settings))
          }
          disabled={!configured}
        />
        <span>
          <strong>{tt('Mettre à jour automatiquement')}</strong>
          <small>
            {tt(
              'Coffre cherche les nouvelles versions, les télécharge en arrière-plan et les installe à sa fermeture. Les réglages ci-dessous permettent d’ajuster chaque étape.',
            )}
          </small>
        </span>
      </label>

      <div className="form-grid">
        <label className="field">
          <span className="field__label">{tt('Recherche automatique')}</span>
          <select
            className="input"
            value={settings.updateCheck}
            onChange={(event) =>
              updateSettings({
                updateCheck: event.target.value as typeof settings.updateCheck,
              })
            }
            disabled={!configured}
          >
            <option value="off">{tt('Désactivée')}</option>
            <option value="launch">{tt('À chaque démarrage')}</option>
            <option value="daily">{tt('Chaque jour')}</option>
            <option value="weekly">{tt('Chaque semaine')}</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">{tt('Canal')}</span>
          <select
            className="input"
            value={settings.updateChannel}
            onChange={(event) =>
              changeChannel(event.target.value === 'beta' ? 'beta' : 'stable')
            }
            disabled={!configured || busy}
          >
            <option value="stable">{tt('Stable')}</option>
            <option value="beta">{tt('Bêta (préversions)')}</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">{tt('Installation')}</span>
          <select
            className="input"
            value={settings.updateInstallMode}
            onChange={(event) =>
              updateSettings({
                updateInstallMode: event.target.value === 'on-quit' ? 'on-quit' : 'ask',
              })
            }
            disabled={!configured}
          >
            <option value="ask">{tt('Me demander')}</option>
            <option value="on-quit">{tt('À la fermeture de Coffre')}</option>
          </select>
        </label>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.updateAutoDownload}
          onChange={(event) =>
            updateSettings({ updateAutoDownload: event.target.checked })
          }
          disabled={!configured}
        />
        <span>{tt('Télécharger automatiquement en arrière-plan')}</span>
      </label>

      {settings.updateChannel === 'beta' && (
        <p className="settings-copy">
          {tt(
            'Les préversions apportent les nouveautés plus tôt mais peuvent contenir des défauts. Gardez des sauvegardes à jour.',
          )}
        </p>
      )}

      {settings.updateSkippedVersion && (
        <div className="settings-actions settings-actions--start">
          <span className="settings-copy">
            {tt('Version ignorée : {version}').replace(
              '{version}',
              settings.updateSkippedVersion,
            )}
          </span>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => updateSettings({ updateSkippedVersion: null })}
          >
            {tt('Ne plus ignorer')}
          </button>
        </div>
      )}

      <p className="settings-copy">
        {tt(
          'La recherche contacte github.com : GitHub voit votre adresse IP et la version de Coffre. Aucune donnée du coffre n’est envoyée. Chaque paquet est signé et sa signature vérifiée avant installation ; le coffre est verrouillé avant le redémarrage.',
        )}
      </p>
    </section>
  )
}
