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
    // Empêche un `touch` tardif de republier après le verrouillage.
    let active = true

    const publish = () => {
      if (!active) return
      void publishAndroidAutofill(entries, ttlSeconds).catch(() => undefined)
    }

    publish()

    // La validité native suit l’activité réelle, comme le verrouillage
    // automatique. Sans cela, le dernier battement pourrait dater de 60 s et
    // expirer aussitôt après le passage en arrière-plan.
    let lastTouch = 0
    const refreshValidity = (force = false) => {
      const now = Date.now()
      if (!force && now - lastTouch < 10_000) return
      lastTouch = now
      void touchAndroidAutofill(ttlSeconds)
        .then((valid) => {
          // Le cache a expiré pendant une veille ou une longue suspension :
          // republier les entrées encore présentes dans la WebView.
          if (active && !valid) publish()
        })
        .catch(() => undefined)
    }

    const interval = window.setInterval(() => {
      if (!document.hidden) refreshValidity()
    }, 60_000)

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'touchstart',
    ]
    const onActivity = () => refreshValidity()
    for (const event of activityEvents) {
      window.addEventListener(event, onActivity, { passive: true })
    }

    const onVisibility = () => {
      if (document.hidden) {
        refreshValidity(true)
      } else {
        publish()
        refreshValidity(true)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      active = false
      window.clearInterval(interval)
      for (const event of activityEvents) {
        window.removeEventListener(event, onActivity)
      }
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [status, items, settings.androidAutofill, settings.autoLockMinutes])

  return null
}
