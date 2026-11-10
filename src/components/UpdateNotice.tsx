import { Download, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { useI18n } from '../state/I18nProvider'
import { useUpdates } from '../state/UpdateProvider'
import { useSettings } from '../state/SettingsProvider'
import { progressPercent } from '../lib/updates'

/**
 * Carte discrète en bas de la fenêtre quand une mise à jour est trouvée par
 * la recherche automatique. Les détails et toutes les options restent dans
 * Réglages → Mises à jour.
 */
export function UpdateNotice() {
  const { tt } = useI18n()
  const { settings } = useSettings()
  const { supported, status, update, progress, noticeDismissed, download, install, later, skip } =
    useUpdates()

  if (!supported || !update || noticeDismissed) return null
  if (!['available', 'downloading', 'ready', 'installing'].includes(status)) return null

  const percent = progressPercent(progress)

  return (
    <aside className="update-notice" role="status" aria-live="polite">
      <div className="update-notice__head">
        <Download size={16} />
        <strong>
          {tt('Coffre {version} est disponible').replace('{version}', update.version)}
        </strong>
        {status !== 'installing' && (
          <button
            type="button"
            className="icon-button"
            onClick={later}
            aria-label={tt('Plus tard')}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {status === 'downloading' && (
        <p className="update-notice__copy">
          {percent === null
            ? tt('Téléchargement…')
            : tt('Téléchargement… {percent} %').replace('{percent}', String(percent))}
        </p>
      )}
      {status === 'ready' && settings.updateInstallMode === 'on-quit' && (
        <p className="update-notice__copy">
          {tt('Prête : elle sera installée à la fermeture de Coffre.')}
        </p>
      )}
      {status === 'installing' && (
        <p className="update-notice__copy">
          <LoaderCircle size={14} className="spin" />
          {tt('Installation… Coffre va redémarrer.')}
        </p>
      )}

      {(status === 'available' || status === 'ready') && (
        <div className="update-notice__actions">
          {status === 'available' && (
            <button
              type="button"
              className="button button--primary button--sm"
              onClick={() => void download()}
            >
              {tt('Télécharger')}
            </button>
          )}
          {status === 'ready' && (
            <button
              type="button"
              className="button button--primary button--sm"
              onClick={() => void install()}
            >
              <RotateCcw size={14} />
              {tt('Installer et redémarrer')}
            </button>
          )}
          <button type="button" className="button button--sm" onClick={later}>
            {tt('Plus tard')}
          </button>
          <button type="button" className="button button--sm" onClick={() => void skip()}>
            {tt('Ignorer cette version')}
          </button>
        </div>
      )}
    </aside>
  )
}
