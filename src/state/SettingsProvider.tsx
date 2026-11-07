import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'
import type { AppSettings } from '../lib/types'
import { loadSettings, saveSettings } from '../lib/settings'

interface SettingsContextValue {
  settings: AppSettings
  updateSettings: (partial: Partial<AppSettings>) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...partial }
      saveSettings(next)
      return next
    })
  }, [])

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
