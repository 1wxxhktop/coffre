import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import {
  androidAutofillStatus,
  clearAndroidAutofill,
  openAndroidAutofillSettings,
  type AndroidAutofillStatus,
} from '../lib/androidAutofill'
import { useI18n } from '../state/I18nProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'
import { useVault } from '../state/VaultProvider'

/**
 * Réglages du remplissage Android.
 *
 * Le remplissage exige deux choses distinctes : l’autorisation dans Coffre
 * (ce réglage) et la sélection de Coffre comme service dans Android. Le
 * verrouillage à la sortie de l’application viderait le cache avant que le
 * navigateur puisse l’utiliser : l’écran l’explique et propose de le
 * désactiver explicitement, sans changer les autres réglages de sécurité.
 */
export function AndroidAutofillSettings() {
  const { settings, updateSettings } = useSettings()
  const { tt } = useI18n()
  const { status } = useVault()
  const { toast } = useToast()

  const [service, setService] = useState<AndroidAutofillStatus | null>(null)
  const [opening, setOpening] = useState(false)

  const refresh = useCallback(async () => {
    setService(await androidAutofillStatus())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Au retour de l’écran système, le service sélectionné a pu changer.
  useEffect(() => {
    const onFocus = () => {
      void refresh()
    }
    const onVisibility = () => {
      if (!document.hidden) void refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  const backgroundLock = settings.lockOnHide
  const enabled = settings.androidAutofill
  const minutes = settings.autoLockMinutes
  const supported = service?.supported !== false

  const setEnabled = async (next: boolean) => {
    updateSettings({ androidAutofill: next })
    if (!next) {
      await clearAndroidAutofill().catch(() => undefined)
      toast(tt('Remplissage Android désactivé.'), 'info')
    } else {
      toast(tt('Remplissage Android activé.'), 'success')
    }
    void refresh()
  }

  const openSettings = async () => {
    setOpening(true)
    const opened = await openAndroidAutofillSettings()
    setOpening(false)
    if (!opened) {
      toast(tt('Impossible d’ouvrir les réglages Android.'), 'error')
    }
  }

  const disableBackgroundLock = () => {
    updateSettings({ lockOnHide: false })
    toast(tt('Verrouillage en arrière-plan désactivé.'), 'success')
  }

  return (
    <section className="settings__page" aria-labelledby="settings-autofill">
      <div className="settings__page-head">
        <div>
          <h3 id="settings-autofill">{tt('Remplissage Android')}</h3>
          <p>
            {tt(
              'Propose les connexions du coffre dans les formulaires des autres applications et du navigateur.',
            )}
          </p>
        </div>
      </div>

      <section className="settings-section">
        <div className="settings-section__head">
          <span className="settings-section__icon">
            <Smartphone size={18} />
          </span>
          <div>
            <h3>{tt('Service de remplissage')}</h3>
            <p>
              {tt(
                'Coffre doit être choisi dans les réglages Android, puis le coffre doit rester déverrouillé.',
              )}
            </p>
          </div>
        </div>

        {service && !service.supported ? (
          <p className="settings-copy">
            <AlertTriangle size={15} />{' '}
            {tt('Le remplissage Android nécessite Android 8 ou une version plus récente.')}
          </p>
        ) : service?.serviceEnabled ? (
          <p className="settings-copy">
            <ShieldCheck size={15} />{' '}
            {tt('Coffre est le service de remplissage sélectionné.')}
          </p>
        ) : (
          <p className="settings-copy">
            <AlertTriangle size={15} />{' '}
            {tt('Coffre n’est pas encore le service de remplissage d’Android.')}
          </p>
        )}

        <div className="settings-actions settings-actions--start">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void openSettings()}
            disabled={opening || !supported}
          >
            {opening ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Smartphone size={16} />
            )}
            {tt('Choisir Coffre dans Android')}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
            {tt('Actualiser l’état')}
          </button>
        </div>
      </section>

      {backgroundLock && (
        <section className="settings-section">
          <div className="settings-section__head">
            <span className="settings-section__icon">
              <AlertTriangle size={18} />
            </span>
            <div>
              <h3>{tt('Verrouillage en arrière-plan')}</h3>
              <p>
                {tt(
                  'Le coffre se verrouille dès que vous quittez Coffre : le cache de remplissage est vidé avant que le navigateur puisse l’utiliser.',
                )}
              </p>
            </div>
          </div>
          <p className="settings-copy">
            {minutes > 0
              ? tt(
                  'Désactivez ce verrouillage pour permettre le remplissage. Le coffre restera protégé par le délai d’inactivité.',
                )
              : tt(
                  'Désactivez ce verrouillage pour permettre le remplissage. Le coffre ne sera alors verrouillé que manuellement.',
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
              'Sans cette modification, le remplissage ne peut pas fonctionner : le cache est effacé dès la sortie de Coffre.',
            )}
          </p>
        </section>
      )}

      <section className="settings-section">
        <div className="settings-section__head">
          <span className="settings-section__icon">
            <Check size={18} />
          </span>
          <div>
            <h3>{tt('Autoriser le remplissage')}</h3>
            <p>
              {tt(
                'Les connexions restent en mémoire uniquement et ne sont jamais écrites sur le disque.',
              )}
            </p>
          </div>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            disabled={backgroundLock || !supported}
            onChange={(event) => void setEnabled(event.target.checked)}
          />
          <span>
            {tt('Proposer les connexions de Coffre dans les formulaires')}
          </span>
        </label>

        {status === 'unlocked' && enabled && (
          <p className="settings-copy">
            {tt(
              'Le coffre est déverrouillé : les connexions sont disponibles pour le remplissage.',
            )}
          </p>
        )}

        <details className="settings-help">
          <summary>{tt('En savoir plus')}</summary>
          <p>
            {tt(
              'Seules les connexions dont l’adresse correspond exactement au domaine du formulaire sont proposées. Les applications natives sans domaine web ne reçoivent rien pour l’instant. Coffre ne propose jamais d’enregistrer un mot de passe saisi dans une autre application.',
            )}
          </p>
          {minutes > 0 ? (
            <p>
              {tt(
                'Le cache expire après le délai de verrouillage automatique, même si Android met Coffre en veille.',
              )}{' '}
              ({minutes} min)
            </p>
          ) : (
            <p>
              {tt(
                'Le verrouillage automatique est désactivé : le cache reste disponible jusqu’au verrouillage manuel de Coffre.',
              )}
            </p>
          )}
        </details>

        {enabled && !backgroundLock && service && !service.serviceEnabled && (
          <p className="field__hint">
            {tt(
              'Choisissez Coffre dans Android pour que le remplissage apparaisse dans les autres applications.',
            )}
          </p>
        )}
      </section>
    </section>
  )
}
