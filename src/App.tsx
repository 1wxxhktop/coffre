import { useEffect, useState } from 'react'
import { AlertTriangle, LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { AuthScreen } from './components/AuthScreen'
import { VaultApp } from './components/VaultApp'
import { Brand } from './components/Brand'
import { ConfirmDialog } from './components/ConfirmDialog'
import { NativeBridge } from './components/NativeBridge'
import { BackupScheduler } from './components/BackupScheduler'
import { VaultProvider, useVault } from './state/VaultProvider'
import { I18nProvider, useI18n } from './state/I18nProvider'
import { SettingsProvider } from './state/SettingsProvider'
import { ToastProvider } from './state/ToastProvider'
import { listLocalBackups, type LocalBackupInfo } from './lib/storage'
import { pluralKey } from './lib/i18n'
import { formatDateTime } from './lib/settings'

export default function App() {
  return (
    <SettingsProvider>
      <I18nProvider>
        <ToastProvider>
          <VaultProvider>
            <div
              className="window-drag-strip"
              data-tauri-drag-region
              aria-hidden="true"
            />
            <NativeBridge />
            <BackupScheduler />
            <Root />
          </VaultProvider>
        </ToastProvider>
      </I18nProvider>
    </SettingsProvider>
  )
}

function Root() {
  const { status } = useVault()

  if (status === 'loading') return <Splash />
  if (status === 'error') return <ErrorScreen />
  if (status === 'empty' || status === 'locked') return <AuthScreen />
  return <VaultApp />
}

function Splash() {
  const { t } = useI18n()
  return (
    <div className="splash">
      <Brand />
      <div className="splash__loader">
        <LoaderCircle size={18} className="spin" />
        {t('app.splash.opening')}
      </div>
    </div>
  )
}

function ErrorScreen() {
  const { t, intl } = useI18n()
  const { error, restoreFromBackup, reset } = useVault()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showReset, setShowReset] = useState(false)
  const [backups, setBackups] = useState<LocalBackupInfo[]>([])
  const [generation, setGeneration] = useState(1)

  useEffect(() => {
    let cancelled = false
    void listLocalBackups()
      .then((list) => {
        if (!cancelled) setBackups(list)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const restore = async () => {
    if (!password) return
    setBusy(true)
    setMessage(null)
    try {
      await restoreFromBackup(password, generation)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : t('app.error.restoreFailed'))
      setBusy(false)
    }
  }

  return (
    <div className="auth auth--error">
      <div className="auth__glow auth__glow--one" aria-hidden="true" />
      <header className="auth__header" data-tauri-drag-region>
        <Brand subtitle="local-first" />
        <span className="pill pill--danger">
          <AlertTriangle size={13} />
          {t('app.error.storageUnavailable')}
        </span>
      </header>

      <main className="error-card">
        <span className="error-card__icon">
          <AlertTriangle size={28} />
        </span>
        <h1>{t('app.error.title')}</h1>
        <p>{error ?? t('app.error.default')}</p>

        <div className="error-card__block">
          <h2>{t('app.error.restoreTitle')}</h2>
          <p>{t('app.error.restoreCopy')}</p>
          {backups.length > 1 && (
            <label className="field">
              <span className="field__label">{t('app.error.backup')}</span>
              <select
                className="input"
                value={generation}
                onChange={(event) => setGeneration(Number(event.target.value))}
              >
                {backups.map((backup) => (
                  <option key={backup.generation} value={backup.generation}>
                    {formatDateTime(backup.updatedAt, intl)} ·{' '}
                    {t(
                      pluralKey(
                        backup.items,
                        'app.error.items.one',
                        'app.error.items.other',
                      ),
                      { count: backup.items },
                    )}
                    {backup.generation === 1 ? ` (${t('app.error.mostRecent')})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="error-card__row">
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('auth.field.masterPassword')}
              autoComplete="off"
            />
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void restore()}
              disabled={!password || busy}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
              {t('app.error.restore')}
            </button>
          </div>
          {backups.length === 0 && (
            <p className="field__hint">{t('app.error.noBackup')}</p>
          )}
          {message && <p className="form-error">{message}</p>}
        </div>

        <div className="error-card__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={16} />
            {t('app.error.reload')}
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => setShowReset(true)}
          >
            <Trash2 size={16} />
            {t('app.error.erase')}
          </button>
        </div>

        <p className="error-card__hint">
          <ShieldCheck size={14} />
          {t('app.error.privacy')}
        </p>
      </main>

      {showReset && (
        <ConfirmDialog
          title={t('app.error.eraseTitle')}
          description={t('app.error.eraseDescription')}
          confirmLabel={t('app.error.eraseConfirm')}
          requireText={t('app.error.eraseRequire')}
          onClose={() => setShowReset(false)}
          onConfirm={async () => {
            await reset()
            setShowReset(false)
          }}
        />
      )}
    </div>
  )
}
