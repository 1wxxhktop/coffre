import { useEffect } from 'react'
import { useVault } from '../state/VaultProvider'
import { useSettings } from '../state/SettingsProvider'
import {
  androidAutofillSupported,
  autofillTtlSeconds,
  clearAndroidAutofill,
  publishAndroidAutofill,
  toAutofillEntries,
  touchAndroidAutofill,
} from '../lib/androidAutofill'

/**
 * Maintient le cache de remplissage Android synchronisé avec l’état du
 * coffre. Rien n’est publié tant que le réglage est désactivé ou le coffre
 * verrouillé ; le cache est alors vidé immédiatement.
 *
 * La durée de validité native suit le verrouillage automatique. Le passage en
 * arrière-plan la prolonge une dernière fois, puis Android peut endormir les
 * minuteurs de la WebView sans laisser le cache vivant indéfiniment.
 */
export function AndroidAutofillBridge() {
  const { status, items } = useVault()
  const { settings } = useSettings()

  useEffect(() => {
    return () => {
      void clearAndroidAutofill().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (!androidAutofillSupported()) return
    if (!settings.androidAutofill || status !== 'unlocked') {
      void clearAndroidAutofill().catch(() => undefined)
      return
    }

    const entries = toAutofillEntries(items)
    const ttlSeconds = autofillTtlSeconds(settings.autoLockMinutes)

    const publish = () => {
      void publishAndroidAutofill(entries, ttlSeconds).catch(() => undefined)
    }

    publish()

    // Battement de sécurité : la validité native reste alignée sur le délai
    // de verrouillage même pendant une longue session au premier plan.
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        void touchAndroidAutofill(ttlSeconds).catch(() => undefined)
      }
    }, 60_000)

    const onVisibility = () => {
      if (document.hidden) {
        void touchAndroidAutofill(ttlSeconds).catch(() => undefined)
      } else {
        publish()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [status, items, settings.androidAutofill, settings.autoLockMinutes])

  return null
}
