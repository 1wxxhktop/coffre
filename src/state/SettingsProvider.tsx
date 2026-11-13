import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { AppSettings } from '../lib/types'
import { loadSettings, saveSettings } from '../lib/settings'
import { isDesktopRuntime } from '../lib/platform'
import { setTrayKeepOnClose, setTrayLanguage } from '../lib/systemIntegration'

interface SettingsContextValue {
  settings: AppSettings
  updateSettings: (partial: Partial<AppSettings>) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const apply = () => {
      const theme =
        settings.theme === 'system'
          ? media?.matches === false
            ? 'light'
            : 'dark'
          : settings.theme
      root.dataset.theme = theme
      root.style.colorScheme = theme
    }
    apply()
    if (settings.theme !== 'system' || !media) return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...partial }
      saveSettings(next)
      return next
    })
  }, [])

  useEffect(() => {
    if (!isDesktopRuntime()) return
    void setTrayLanguage(settings.language).catch(() => undefined)
  }, [settings.language])

  useEffect(() => {
    if (!isDesktopRuntime()) return
    void setTrayKeepOnClose(settings.trayKeepOnClose).catch(() => undefined)
  }, [settings.trayKeepOnClose])

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings doit être utilisé dans SettingsProvider')
  return context
}
