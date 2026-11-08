import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from 'react'
import {
  intlLocale,
  translate,
  type Locale,
  type MessageKey,
  type Translate,
} from '../lib/i18n'
import { translateText } from '../lib/i18n-text'
import { useSettings } from './SettingsProvider'

interface I18nContextValue {
  locale: Locale
  intl: string
  t: Translate
  /** Traduction par texte source, pour les écrans en cours de migration. */
  tt: (text: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

/** Fournit la langue courante et le traducteur à toute l’application. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const locale = settings.language

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const t = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  )

  const tt = useCallback((text: string) => translateText(locale, text), [locale])

  return (
    <I18nContext.Provider value={{ locale, intl: intlLocale(locale), t, tt }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n doit être utilisé dans I18nProvider')
  return context
}
