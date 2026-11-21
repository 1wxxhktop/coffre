import { useState } from 'react'
import {
  AlertTriangle,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import { openAndroidPasskeysSettings } from '../lib/androidPasskeys'
import { useI18n } from '../state/I18nProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'
import { useVault } from '../state/VaultProvider'

/**
 * Réglages des passkeys Android.
 *
 * Le fournisseur système doit être choisi dans Android, et le coffre doit
 * rester déverrouillé en arrière-plan pour que le cache soit disponible. La
 * création depuis Android n’est pas encore proposée : seules les passkeys
 * existantes sont signées.
 */
export function AndroidPasskeysSettings() {
  const { settings, updateSettings } = useSettings()
  const { tt } = useI18n()
  const { status } = useVault()
  const { toast } = useToast()
  const [opening, setOpening] = useState(false)

  const backgroundLock = settings.lockOnHide
  const enabled = settings.androidPasskeys

  const openSettings = async () => {
    setOpening(true)
    const opened = await openAndroidPasskeysSettings()
    setOpening(false)
    if (!opened) toast(tt('Impossible d’ouvrir les réglages Android.'), 'error')
  }

  const disableBackgroundLock = () => {
    updateSettings({ lockOnHide: false })
    toast(tt('Verrouillage en arrière-plan désactivé.'), 'success')
  }

  return (
    <section className="settings-section">
      <div className="settings-section__head">
        <span className="settings-section__icon">
          <KeyRound size={18} />
        </span>
        <div>
          <h3>{tt('Passkeys Android')}</h3>
          <p>
            {tt(
              'Signe avec les passkeys du coffre dans les navigateurs compatibles (Android 14+).',
            )}
          </p>
        </div>
      </div>

      {backgroundLock && (
        <>
          <p className="settings-copy">
            <AlertTriangle size={15} />{' '}
            {tt(
              'Le coffre se verrouille dès que vous quittez Coffre : le cache des passkeys est vidé avant que le navigateur puisse l’utiliser.',
            )}
          </p>
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--secondary"
              onClick={disableBackgroundLock}
            >
              <ShieldCheck size={16} />
              {tt('Désactiver le verrouillage en arrière-plan')}
            </button>
          </div>
          <p className="field__hint">
            {tt(
              'Sans cette modification, les passkeys ne peuvent pas être proposées hors de Coffre.',
            )}
          </p>
        </>
      )}

      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={backgroundLock}
          onChange={(event) =>
            updateSettings({ androidPasskeys: event.target.checked })
          }
        />
        <span>{tt('Proposer les passkeys de Coffre dans Android')}</span>
      </label>

      <div className="settings-actions settings-actions--start">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void openSettings()}
          disabled={opening}
        >
          {opening ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Smartphone size={16} />
          )}
          {tt('Choisir Coffre dans Android')}
        </button>
      </div>

      {status === 'unlocked' && enabled && !backgroundLock && (
        <p className="settings-copy">
          {tt(
            'Le coffre est déverrouillé : les passkeys peuvent être proposées par le navigateur.',
          )}
        </p>
      )}

      <details className="settings-help">
        <summary>{tt('En savoir plus')}</summary>
        <p>
          {tt(
            'Coffre doit être choisi comme fournisseur de passkeys dans Android. Seuls les navigateurs de la liste de confiance peuvent présenter une origine ; les applications natives sans Digital Asset Links ne sont pas prises en charge.',
          )}
        </p>
        <p>
          {tt(
            'La création d’une passkey depuis Android n’est pas encore disponible : créez-la depuis le site avec l’extension Coffre, puis elle apparaîtra ici.',
          )}
        </p>
        <p>
          {tt(
            'Le cache expire après le délai de verrouillage automatique, même si Android met Coffre en veille.',
          )}
        </p>
      </details>
    </section>
  )
}
