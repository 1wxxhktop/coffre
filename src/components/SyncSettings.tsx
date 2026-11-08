import { useCallback, useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  AlertTriangle,
  Check,
  Cloud,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { isTauriRuntime } from '../lib/external'
import { formatDateTime } from '../lib/settings'
import {
  getSyncConfig,
  syncDeviceFileName,
  type SyncConfig,
} from '../lib/syncConfig'
import { SyncEpochRequiredError } from '../lib/syncService'
import {
  pickWebSyncDirectory,
  webSyncAvailable,
} from '../lib/syncWebStorage'
import { ConfirmDialog } from './ConfirmDialog'

export function SyncSettings() {
  const {
    file,
    syncPending,
    syncRevision,
    configureSync,
    configureWebSync,
    disableSync,
    syncNow,
  } = useVault()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [config, setConfig] = useState<SyncConfig | null>(
    file ? getSyncConfig(file.id) : null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [showDisable, setShowDisable] = useState(false)

  const reload = useCallback(() => {
    setConfig(file ? getSyncConfig(file.id) : null)
  }, [file])

  useEffect(() => {
    reload()
  }, [reload, syncRevision])

  const chooseFolder = async () => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    try {
      if (isTauriRuntime()) {
        const selected = await open({
          directory: true,
          multiple: false,
          title: 'Choisir un dossier de synchronisation',
        })
        if (typeof selected !== 'string') return
        await configureSync(selected)
      } else if (webSyncAvailable()) {
        const handle = await pickWebSyncDirectory()
        await configureWebSync(handle)
      } else {
        throw new Error(
          'Ce navigateur ne permet pas de choisir un dossier. Utilisez l’export et l’import manuels.',
        )
      }
      reload()
      toast(tt('Dossier de synchronisation configuré.'), 'success')
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Impossible de configurer la synchronisation.',
      )
    } finally {
      setBusy(false)
    }
  }

  const runSync = async (newPassword?: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await syncNow(newPassword)
      setNeedsPassword(false)
      setPassword('')
      reload()
      if (result.conflicts > 0) {
        toast(
          `Synchronisation terminée avec ${result.conflicts} conflit${
            result.conflicts > 1 ? 's' : ''
          } archivé${result.conflicts > 1 ? 's' : ''}.`,
          'info',
        )
      } else {
        toast(tt('Synchronisation terminée.'), 'success')
      }
      if (result.warnings.length > 0) {
        toast(result.warnings.slice(0, 3).join(' '), 'info')
      }
    } catch (caught) {
      if (caught instanceof SyncEpochRequiredError) {
        setNeedsPassword(true)
        setError(caught.message)
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : 'La synchronisation a échoué.',
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setShowDisable(false)
    setBusy(true)
    try {
      await disableSync()
      reload()
      setNeedsPassword(false)
      setError(null)
      toast(tt('Synchronisation désactivée pour ce coffre.'), 'info')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Désactivation impossible.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings__page" aria-labelledby="settings-sync">
      <div className="settings__page-head">
        <div>
          <h3 id="settings-sync">{tt('Synchronisation')}</h3>
          <p>
            Un dossier que vous contrôlez déjà (iCloud Drive, Dropbox, Syncthing,
            clé USB). Aucun serveur Coffre n’intervient.
          </p>
        </div>
      </div>

      <section className="settings-section">
        <div className="settings-section__head">
          <span className="settings-section__icon">
            <Cloud size={18} />
          </span>
          <div>
            <h3>{tt('Dossier partagé')}</h3>
            <p>
              Chaque appareil écrit un fichier chiffré distinct et lit les autres
              pour les fusionner.
            </p>
          </div>
        </div>

        {!isTauriRuntime() && !webSyncAvailable() ? (
          <p className="field__hint">
            Ce navigateur ne propose pas de sélection de dossier local. Utilisez
            l’export et l’import manuels, ou ouvrez Coffre dans l’application
            desktop.
          </p>
        ) : !config ? (
          <>
            <p className="field__hint">
              Choisissez un dossier déjà synchronisé entre vos appareils. Coffre y
              créera un sous-dossier <span className="mono">Coffre/&lt;id&gt;/</span>.
              {!isTauriRuntime() &&
                ' Le navigateur demandera l’autorisation de lire et écrire ce dossier.'}
            </p>
            <div className="settings-actions settings-actions--start">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void chooseFolder()}
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <FolderOpen size={16} />
                )}
                Choisir un dossier
              </button>
            </div>
          </>
        ) : (
          <>
            <dl className="field__hint" style={{ display: 'grid', gap: '6px' }}>
              <div>
                <strong>{tt('Dossier :')}</strong>{' '}
                <span className="mono">{config.dir}</span>
              </div>
              <div>
                <strong>{tt('Fichier de cet appareil :')}</strong>{' '}
                <span className="mono">{syncDeviceFileName(config)}</span>
              </div>
              <div>
                <strong>{tt('Dernière synchronisation :')}</strong>{' '}
                {config.lastSyncAt ? formatDateTime(config.lastSyncAt) : 'jamais'}
              </div>
              {typeof config.lastConflicts === 'number' && config.lastConflicts > 0 && (
                <div>
                  <strong>{tt('Conflits archivés :')}</strong>{' '}
                  {config.lastConflicts}
                </div>
              )}
            </dl>

            {syncPending && (
              <p className="form-success" role="status">
                <RefreshCw size={16} />
                Des fichiers ont changé dans le dossier. Synchronisez pour les
                fusionner.
              </p>
            )}
            {config.lastWarning && (
              <p className="field__hint field__hint--error">
                <AlertTriangle size={14} /> {config.lastWarning}
              </p>
            )}
            {error && <p className="form-error">{error}</p>}

            {needsPassword && (
              <div className="form-grid">
                <label className="field field--full">
                  <span className="field__label">
                    Nouveau mot de passe maître (changé sur un autre appareil)
                  </span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && password) {
                        void runSync(password)
                      }
                    }}
                  />
                </label>
                <div className="settings-actions settings-actions--start">
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => void runSync(password)}
                    disabled={busy || !password}
                  >
                    {busy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Check size={16} />
                    )}
                    Synchroniser avec ce mot de passe
                  </button>
                </div>
              </div>
            )}

            {!needsPassword && (
              <div className="settings-actions settings-actions--start">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void runSync()}
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  Synchroniser maintenant
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void chooseFolder()}
                  disabled={busy}
                >
                  <FolderOpen size={16} />
                  Changer de dossier
                </button>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => setShowDisable(true)}
                  disabled={busy}
                >
                  Désactiver
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {showDisable && (
        <ConfirmDialog
          title={tt('Désactiver la synchronisation ?')}
          description={tt(
            'Le fichier de cet appareil reste dans le dossier, mais Coffre ne le lira ni ne l’écrira plus.',
          )}
          confirmLabel={tt('Désactiver')}
          onClose={() => setShowDisable(false)}
          onConfirm={() => void remove()}
        />
      )}
    </section>
  )
}
