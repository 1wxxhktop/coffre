import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useI18n } from '../state/I18nProvider'
import { currentWindowChrome } from '../lib/windowChrome'

/** API fenêtre indisponible dans certains environnements de test simulés. */
function currentWindowOrNull(): ReturnType<typeof getCurrentWindow> | null {
  try {
    return getCurrentWindow()
  } catch {
    return null
  }
}

/**
 * Barre de titre intégrée pour Windows.
 *
 * La fenêtre Tauri est sans décoration sur Windows : cette barre fournit la
 * zone de déplacement et les commandes réduire/agrandir/fermer. Sur macOS, les
 * feux de circulation natifs restent utilisés ; la barre n’est pas rendue.
 */
export function WindowTitlebar() {
  const { t } = useI18n()
  const windows = currentWindowChrome() === 'windows'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!windows) return
    const current = currentWindowOrNull()
    if (!current) return
    let active = true
    const sync = () => {
      void current
        .isMaximized()
        .then((value) => {
          if (active) setMaximized(value)
        })
        .catch(() => undefined)
    }
    sync()
    const unlisten = current.onResized(sync)
    return () => {
      active = false
      void unlisten.then((stop) => stop()).catch(() => undefined)
    }
  }, [windows])

  if (!windows) return null

  const run = (
    action: (window: ReturnType<typeof getCurrentWindow>) => Promise<void>,
  ) => {
    const current = currentWindowOrNull()
    if (!current) return
    void action(current).catch(() => undefined)
  }

  return (
    <div className="window-titlebar">
      <div
        className="window-titlebar__drag"
        data-tauri-drag-region
        onDoubleClick={() => run((window) => window.toggleMaximize())}
      />
      <div className="window-titlebar__controls">
        <button
          type="button"
          className="window-titlebar__button"
          aria-label={t('window.minimize')}
          title={t('window.minimize')}
          onClick={() => run((window) => window.minimize())}
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          className="window-titlebar__button"
          aria-label={maximized ? t('window.restore') : t('window.maximize')}
          title={maximized ? t('window.restore') : t('window.maximize')}
          onClick={() => run((window) => window.toggleMaximize())}
        >
          {maximized ? <Copy size={13} /> : <Square size={13} />}
        </button>
        <button
          type="button"
          className="window-titlebar__button window-titlebar__button--close"
          aria-label={t('window.close')}
          title={t('window.close')}
          onClick={() => run((window) => window.close())}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
