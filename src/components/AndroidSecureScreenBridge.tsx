import { useEffect } from 'react'
import { useSettings } from '../state/SettingsProvider'
import {
  androidSecureScreenSupported,
  setAndroidSecureScreen,
} from '../lib/androidSecureScreen'

/**
 * Applique le réglage de blocage des captures à la fenêtre Android. Le pont
 * est monté hors de l’écran de coffre pour couvrir aussi le déverrouillage.
 */
export function AndroidSecureScreenBridge() {
  const { settings } = useSettings()

  useEffect(() => {
    if (!androidSecureScreenSupported()) return
    void setAndroidSecureScreen(settings.androidSecureScreen).catch(() => undefined)
  }, [settings.androidSecureScreen])

  return null
}
