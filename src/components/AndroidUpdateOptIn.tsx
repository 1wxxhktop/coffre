import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { isAndroidRuntime } from '../lib/platform'
import { useI18n } from '../state/I18nProvider'
import { useSettings } from '../state/SettingsProvider'
import { useUpdates } from '../state/UpdateProvider'

const STORAGE_KEY = 'coffre:android-update-opt-in:v1'

function alreadyAsked(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    // Sans stockage local, ne pas harceler l’utilisateur à chaque lancement.
    return true
  }
}

function remember(value: string) {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Le réglage reste disponible dans Réglages → Mises à jour.
  }
}

/**
 * Proposition unique, après le premier déverrouillage, d’activer la recherche
 * de mises à jour au démarrage. La recherche reste désactivée par défaut et
 * aucune requête n’est faite avant un accord explicite.
 */
export function AndroidUpdateOptIn() {
  const android = isAndroidRuntime()
  const { tt } = useI18n()
  const { settings, updateSettings } = useSettings()
  const { supported, info, status, check } = useUpdates()
  const [dismissed, setDismissed] = useState(alreadyAsked)

  const visible =
    android &&
    supported &&
    info?.configured === true &&
    settings.updateCheck === 'off' &&
    status === 'idle' &&
    !dismissed

  if (!visible) return null

  const later = () => {
    remember('later')
    setDismissed(true)
  }

  const enable = () => {
    remember('enabled')
    setDismissed(true)
    updateSettings({ updateCheck: 'launch' })
    void check()
  }

  return (
    <aside className="update-notice" role="status" aria-live="polite">
      <div className="update-notice__head">
        <Download size={16} />
        <strong>{tt('Mises à jour Android')}</strong>
        <button
          type="button"
          className="icon-button"
          onClick={later}
          aria-label={tt('Plus tard')}
        >
          <X size={14} />
        </button>
      </div>
      <p className="update-notice__copy">
        {tt(
          'Coffre peut vérifier au démarrage si une nouvelle version est publiée sur GitHub. Aucune donnée du coffre n’est envoyée.',
        )}
      </p>
      <div className="update-notice__actions">
        <button
          type="button"
          className="button button--primary button--sm"
          onClick={enable}
        >
          {tt('Vérifier au démarrage')}
        </button>
        <button type="button" className="button button--sm" onClick={later}>
          {tt('Plus tard')}
        </button>
      </div>
    </aside>
  )
}
