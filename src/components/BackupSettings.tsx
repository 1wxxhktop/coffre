import { useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  AlertTriangle,
  Check,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useVault } from '../state/VaultProvider'
import { useSettings } from '../state/SettingsProvider'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { isTauriRuntime } from '../lib/external'
import { formatBytes, formatDateTime } from '../lib/settings'
import { getTravelMode } from '../lib/travelMode'
import {
  BackupError,
  BACKUP_ALERT_TEXTS,
  backupAlert,
  backupList,
  backupRead,
  backupStatus,
  runScheduledBackup,
  type BackupFileInfo,
} from '../lib/backup'

export function BackupSettings() {
  const { settings, updateSettings } = useSettings()
  const { file, verifyBackup } = useVault()
  const { tt, intl } = useI18n()
  const { toast } = useToast()
  const desktop = isTauriRuntime()
  const travel = file ? getTravelMode(file.id)?.enabled === true : false

  const [folderMissing, setFolderMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [backups, setBackups] = useState<BackupFileInfo[]>([])
  const [restoreName, setRestoreName] = useState<string | null>(null)
  const [restoreContents, setRestoreContents] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const alert = useMemo(
    () =>
      backupAlert(
        settings,
        desktop ? 'desktop' : 'web',
        { folderMissing, travel },
      ),
    [settings, desktop, folderMissing, travel],
  )

  useEffect(() => {
    if (!desktop || !settings.backupFolder) return
    let active = true
    void backupStatus(settings.backupFolder)
      .then((status) => {
        if (active) setFolderMissing(!status.exists || !status.isDirectory)
      })
      .catch(() => {
        if (active) setFolderMissing(true)
      })
    return () => {
      active = false
    }
  }, [desktop, settings.backupFolder])

  useEffect(() => {
    if (!desktop || !settings.backupFolder) return
    let active = true
    void backupList(settings.backupFolder)
      .then((list) => {
        if (active) setBackups(list)
      })
      .catch(() => {
        if (active) setBackups([])
      })
    return () => {
      active = false
    }
  }, [desktop, settings.backupFolder, settings.backupLastSuccessAt])

  const chooseFolder = async () => {
    if (!desktop || busy) return
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: tt('Choisir un dossier de sauvegarde'),
      })
      if (typeof selected !== 'string') return
      setFolderMissing(false)
      setBackups([])
      updateSettings({ backupFolder: selected, backupLastError: null })
      toast(tt('Dossier de sauvegarde configuré.'), 'success')
    } catch {
      toast(tt('Impossible de choisir ce dossier.'), 'error')
    }
  }

  const backupNow = async () => {
    if (!desktop || busy) return
    setBusy(true)
    try {
      const result = await runScheduledBackup(settings, new Date(), {
        force: true,
        verify: file
          ? async (name) => {
              const contents = await backupRead(settings.backupFolder, name)
              await verifyBackup(contents)
            }
          : undefined,
      })
      const now = new Date().toISOString()
      updateSettings({
        backupLastRunAt: now,
        backupLastSuccessAt: now,
        backupLastError: null,
      })
      toast(
        result.written.length > 0
          ? tt('Sauvegarde effectuée.')
          : tt('Aucune sauvegarde nécessaire.'),
        'success',
      )
    } catch (error) {
      updateSettings({
        backupLastRunAt: new Date().toISOString(),
        backupLastError:
          error instanceof BackupError ? error.code : 'backup-failed',
      })
      toast(
        error instanceof BackupError && error.code === 'missing-folder'
          ? tt('Le dossier de sauvegarde est introuvable.')
          : tt('Sauvegarde impossible.'),
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  const verifyContents = async (contents: string, secret?: string) => {
    try {
      const result = await verifyBackup(contents, secret)
      setRestoreMessage(
        tt('Intégrité confirmée : {items} éléments (coffre courant : {current}).')
          .replace('{items}', String(result.items))
          .replace('{current}', String(result.currentItems)),
      )
      setRestoreError(null)
    } catch {
      setRestoreError(
        tt(
          'Vérification impossible. Saisissez le mot de passe de cette sauvegarde.',
        ),
      )
    }
  }

  const testRestore = async (name?: string) => {
    if (!desktop || !settings.backupFolder || busy) return
    const selected = name ?? backups[0]?.name
    if (!selected) {
      toast(tt('Aucune sauvegarde à tester.'), 'error')
      return
    }
    setBusy(true)
    setRestoreMessage(null)
    setRestoreError(null)
    setPassword('')
    try {
      const contents = await backupRead(settings.backupFolder, selected)
      setRestoreName(selected)
      setRestoreContents(contents)
      await verifyContents(contents)
    } catch {
      setRestoreError(tt('Sauvegarde illisible ou corrompue.'))
    } finally {
      setBusy(false)
    }
  }

  const retryWithPassword = async () => {
    if (!restoreContents || !password) return
    await verifyContents(restoreContents, password)
  }

  return (
    <section className="settings-section" aria-labelledby="settings-scheduled-backup">
      <div className="settings-section__head">
        <span className="settings-section__icon">
          <HardDrive size={18} />
        </span>
        <div>
          <h3 id="settings-scheduled-backup">
            {tt('Sauvegardes planifiées')}
          </h3>
          <p>
            {desktop
              ? tt(
                  'Copies chiffrées du fichier .coffre dans un dossier choisi, même quand le coffre est verrouillé.',
                )
              : tt(
                  'Sur le Web, Coffre ne peut pas écrire en arrière-plan : un rappel vous invite à exporter.',
                )}
          </p>
        </div>
      </div>

      {alert && (
        <p className="form-error" role="status">
          <AlertTriangle size={16} />
          {tt(BACKUP_ALERT_TEXTS[alert.code])}
        </p>
      )}

      {travel && (
        <p className="settings-copy">
          {tt(
            'Le mode voyage suspend les sauvegardes planifiées pour ne pas écrire un coffre réduit par-dessus la rétention.',
          )}
        </p>
      )}

      <label className="field">
        <span className="field__label">{tt('Fréquence')}</span>
        <select
          className="input"
          value={settings.backupFrequency}
          onChange={(event) =>
            updateSettings({
              backupFrequency: event.target.value as
                | 'off'
                | 'daily'
                | 'weekly',
              backupLastError: null,
            })
          }
        >
          <option value="off">{tt('Désactivé')}</option>
          <option value="daily">{tt('Quotidienne')}</option>
          <option value="weekly">{tt('Hebdomadaire')}</option>
        </select>
      </label>

      {desktop && (
        <>
          <div className="field">
            <span className="field__label">{tt('Dossier cible')}</span>
            <div className="settings-actions settings-actions--start">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void chooseFolder()}
                disabled={busy}
              >
                <FolderOpen size={16} />
                {settings.backupFolder
                  ? tt('Changer de dossier')
                  : tt('Choisir un dossier')}
              </button>
              {settings.backupFolder && (
                <code className="settings-copy">{settings.backupFolder}</code>
              )}
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span className="field__label">{tt('Quotidiennes conservées')}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={30}
                value={settings.backupRetentionDaily}
                onChange={(event) =>
                  updateSettings({
                    backupRetentionDaily: Math.max(
                      1,
                      Math.min(30, Number(event.target.value) || 1),
                    ),
                  })
                }
              />
            </label>
            <label className="field">
              <span className="field__label">{tt('Hebdomadaires conservées')}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={12}
                value={settings.backupRetentionWeekly}
                onChange={(event) =>
                  updateSettings({
                    backupRetentionWeekly: Math.max(
                      1,
                      Math.min(12, Number(event.target.value) || 1),
                    ),
                  })
                }
              />
            </label>
            <label className="field">
              <span className="field__label">{tt('Mensuelles conservées')}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={24}
                value={settings.backupRetentionMonthly}
                onChange={(event) =>
                  updateSettings({
                    backupRetentionMonthly: Math.max(
                      1,
                      Math.min(24, Number(event.target.value) || 1),
                    ),
                  })
                }
              />
            </label>
          </div>

          <p className="settings-copy">
            {settings.backupLastSuccessAt
              ? `${tt('Dernière sauvegarde :')} ${formatDateTime(
                  settings.backupLastSuccessAt,
                  intl,
                )}`
              : tt('Aucune sauvegarde réussie pour le moment.')}
          </p>

          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void backupNow()}
              disabled={busy || !settings.backupFolder}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              {tt('Sauvegarder maintenant')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void testRestore()}
              disabled={busy || backups.length === 0}
            >
              <ShieldCheck size={16} />
              {tt('Tester la restauration')}
            </button>
          </div>

          {backups.length > 0 && (
            <ul className="backup-list">
              {backups.slice(0, 6).map((backup) => (
                <li key={backup.name} className="backup-list__item">
                  <div>
                    <strong>{backup.name}</strong>
                    <span>
                      {formatDateTime(
                        new Date(backup.modifiedAt).toISOString(),
                        intl,
                      )}{' '}
                      · {formatBytes(backup.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => void testRestore(backup.name)}
                    disabled={busy}
                  >
                    {tt('Tester')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {restoreName && (
        <div className="settings-section">
          <p className="settings-copy">
            {tt('Test de restauration :')} <code>{restoreName}</code>
          </p>
          {restoreMessage && (
            <p className="form-success" role="status">
              <Check size={16} />
              {restoreMessage}
            </p>
          )}
          {restoreError && (
            <>
              <p className="form-error" role="alert">
                <AlertTriangle size={16} />
                {restoreError}
              </p>
              <div className="settings-actions settings-actions--start">
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={tt('Mot de passe de la sauvegarde')}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void retryWithPassword()}
                  disabled={!password}
                >
                  {tt('Vérifier')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
