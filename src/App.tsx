import { useEffect, useState } from 'react'
import { AlertTriangle, LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { AuthScreen } from './components/AuthScreen'
import { VaultApp } from './components/VaultApp'
import { Brand } from './components/Brand'
import { ConfirmDialog } from './components/ConfirmDialog'
import { VaultProvider, useVault } from './state/VaultProvider'
import { SettingsProvider } from './state/SettingsProvider'
import { ToastProvider } from './state/ToastProvider'
import { listLocalBackups, type LocalBackupInfo } from './lib/storage'
import { formatDateTime } from './lib/settings'

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <VaultProvider>
          <div
            className="window-drag-strip"
            data-tauri-drag-region
            aria-hidden="true"
          />
          <Root />
        </VaultProvider>
      </ToastProvider>
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
  return (
    <div className="splash">
      <Brand />
      <div className="splash__loader">
        <LoaderCircle size={18} className="spin" />
        Ouverture du coffre local…
      </div>
    </div>
  )
}

function ErrorScreen() {
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
      setMessage(caught instanceof Error ? caught.message : 'Restauration impossible')
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
          Stockage indisponible
        </span>
      </header>

      <main className="error-card">
        <span className="error-card__icon">
          <AlertTriangle size={28} />
        </span>
        <h1>Impossible d’ouvrir le coffre local</h1>
        <p>{error ?? 'Le stockage local est inaccessible dans ce navigateur.'}</p>

        <div className="error-card__block">
          <h2>Restaurer une sauvegarde locale</h2>
          <p>
            Coffre conserve les trois dernières versions du fichier chiffré. Choisissez une
            sauvegarde et saisissez son mot de passe maître.
          </p>
          {backups.length > 1 && (
            <label className="field">
              <span className="field__label">Sauvegarde</span>
              <select
                className="input"
                value={generation}
                onChange={(event) => setGeneration(Number(event.target.value))}
              >
                {backups.map((backup) => (
                  <option key={backup.generation} value={backup.generation}>
                    {formatDateTime(backup.updatedAt)} · {backup.items} élément
                    {backup.items > 1 ? 's' : ''}
                    {backup.generation === 1 ? ' (la plus récente)' : ''}
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
              placeholder="Mot de passe maître"
              autoComplete="off"
            />
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void restore()}
              disabled={!password || busy}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
              Restaurer
            </button>
          </div>
          {backups.length === 0 && (
            <p className="field__hint">Aucune sauvegarde locale n’est disponible.</p>
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
            Recharger la page
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => setShowReset(true)}
          >
            <Trash2 size={16} />
            Effacer et recommencer
          </button>
        </div>

        <p className="error-card__hint">
          <ShieldCheck size={14} />
          Aucune donnée n’est envoyée à un serveur, même en cas d’erreur.
        </p>
      </main>

      {showReset && (
        <ConfirmDialog
          title="Effacer les données locales ?"
          description="Le coffre et sa sauvegarde stockés dans ce navigateur seront supprimés définitivement."
          confirmLabel="Effacer définitivement"
          requireText="SUPPRIMER"
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
