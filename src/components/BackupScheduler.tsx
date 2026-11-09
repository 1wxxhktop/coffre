import { useCallback, useEffect, useRef } from 'react'
import { useSettings } from '../state/SettingsProvider'
import { useVault } from '../state/VaultProvider'
import { isTauriRuntime } from '../lib/external'
import { getTravelMode } from '../lib/travelMode'
import {
  BackupError,
  backupCurrentFileId,
  backupRead,
  backupStatus,
  isBackupDue,
  runScheduledBackup,
} from '../lib/backup'

const CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * Planificateur local : vérifie au démarrage puis toutes les heures. Il ne
 * dépend pas du déverrouillage pour copier un fichier déjà chiffré ; le mode
 * voyage suspend les écritures.
 */
export function BackupScheduler() {
  const { settings, updateSettings } = useSettings()
  const { file, verifyBackup } = useVault()
  const settingsRef = useRef(settings)
  const fileRef = useRef(file)
  const verifyRef = useRef(verifyBackup)
  const running = useRef(false)
  // Le fichier change lorsque le mode voyage est activé ou désactivé : cet
  // état dérivé réveille le planificateur sans attendre le prochain passage.
  const travelEnabled = file ? getTravelMode(file.id)?.enabled === true : false

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    fileRef.current = file
  }, [file])

  useEffect(() => {
    verifyRef.current = verifyBackup
  }, [verifyBackup])

  const check = useCallback(async () => {
    if (!isTauriRuntime() || running.current) return
    const current = settingsRef.current
    if (current.backupFrequency === 'off' || !current.backupFolder) return
    running.current = true
    try {
      const fileId =
        fileRef.current?.id ??
        (await backupCurrentFileId().catch(() => null))
      if (fileId && getTravelMode(fileId)?.enabled) {
        if (current.backupLastError !== 'travel') {
          updateSettings({ backupLastError: 'travel' })
        }
        return
      }
      if (current.backupLastError === 'travel') {
        updateSettings({ backupLastError: null })
      }
      const status = await backupStatus(current.backupFolder).catch(() => null)
      if (!status?.exists || !status.isDirectory) {
        if (current.backupLastError !== 'missing-folder') {
          updateSettings({ backupLastError: 'missing-folder' })
        }
        return
      }
      if (current.backupLastError === 'missing-folder') {
        updateSettings({ backupLastError: null })
      }
      if (!isBackupDue(current)) return
      // Quand le coffre est déverrouillé, la copie est immédiatement relue et
      // son MAC vérifié avant d’appliquer la rétention. Verrouillé, le SHA-256
      // de la copie et le test de restauration restent les contrôles disponibles.
      const verify = fileRef.current
        ? async (name: string) => {
            try {
              const contents = await backupRead(current.backupFolder, name)
              await verifyRef.current(contents)
            } catch (error) {
              // Le coffre a pu être verrouillé entre la copie et la relecture :
              // la copie reste valide, le test de restauration la vérifiera.
              if (
                !(error instanceof Error) ||
                error.message !== 'Coffre verrouillé'
              ) {
                throw error
              }
            }
          }
        : undefined
      await runScheduledBackup(current, new Date(), { verify })
      const now = new Date().toISOString()
      updateSettings({
        backupLastRunAt: now,
        backupLastSuccessAt: now,
        backupLastError: null,
      })
    } catch (error) {
      updateSettings({
        backupLastRunAt: new Date().toISOString(),
        backupLastError:
          error instanceof BackupError ? error.code : 'backup-failed',
      })
    } finally {
      running.current = false
    }
  }, [updateSettings])

  useEffect(() => {
    void check()
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [check])

  useEffect(() => {
    void check()
  }, [check, settings.backupFolder, settings.backupFrequency, travelEnabled])

  return null
}
