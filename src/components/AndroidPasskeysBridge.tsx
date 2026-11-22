import { useEffect } from 'react'
import { useVault } from '../state/VaultProvider'
import { useSettings } from '../state/SettingsProvider'
import {
  androidPasskeysSupported,
  clearAndroidPasskeys,
  passkeyTtlSeconds,
  publishAndroidPasskeys,
  toAndroidPasskeyEntries,
  touchAndroidPasskeys,
} from '../lib/androidPasskeys'

/**
 * Maintient le cache de passkeys du fournisseur Android.
 *
 * Rien n’est publié quand le réglage est désactivé ou le coffre verrouillé.
 * Le cache expire avec le verrouillage automatique ; l’activité récente le
 * rafraîchit, et le passage en arrière-plan le prolonge une dernière fois.
 */
export function AndroidPasskeysBridge() {
  const { status, items } = useVault()
  const { settings } = useSettings()

  useEffect(() => {
    return () => {
      void clearAndroidPasskeys().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (!androidPasskeysSupported()) return
    if (!settings.androidPasskeys || status !== 'unlocked') {
      void clearAndroidPasskeys().catch(() => undefined)
      return
    }

    const entries = toAndroidPasskeyEntries(items)
    const ttlSeconds = passkeyTtlSeconds(settings.autoLockMinutes)
    let active = true

    const publish = () => {
      if (!active) return
      void publishAndroidPasskeys(entries, ttlSeconds).catch(() => undefined)
    }

    publish()

    let lastTouch = 0
    const refreshValidity = (force = false) => {
      const now = Date.now()
      if (!force && now - lastTouch < 10_000) return
      lastTouch = now
      void touchAndroidPasskeys(ttlSeconds)
        .then((valid) => {
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
  }, [status, items, settings.androidPasskeys, settings.autoLockMinutes])

  return null
}
