import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  FileKey2,
  FileSpreadsheet,
  Fingerprint,
  HardDrive,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { PasswordStrength } from './PasswordStrength'
import { RecoveryDialog } from './RecoveryDialog'
import { useVault } from '../state/VaultProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'
import { estimateEntropy } from '../lib/crypto'
import { keychainAvailable } from '../lib/keychain'
import { biometricAvailable } from '../lib/biometrics'
import { isTauriRuntime } from '../lib/external'
import {
  dedupeImport,
  importSourceLabel,
  parseImport,
  type ParsedImport,
} from '../lib/import'
import { parse1pux } from '../lib/onePassword'
import { downloadFile, formatBytes, formatDateTime, pluralize } from '../lib/settings'
import { exportCsv, type CsvExportFormat } from '../lib/export'
import {
  getPersistentStorageStatus,
  getStorageEstimate,
  requestPersistentStorage,
  type StorageEstimate,
} from '../lib/storage'
import { itemTypeLabel, type ThemePreference } from '../lib/types'
import type { VaultIntegrityReport } from '../lib/vault'

interface SettingsDialogProps {
  onClose: () => void
  onImported?: () => void
}

export function SettingsDialog({ onClose, onImported }: SettingsDialogProps) {
  const { settings, updateSettings } = useSettings()
  const {
    file,
    vaults,
    items,
    changePassword,
    exportVault,
    importVault,
    importItems,
    verify,
    reset,
    resetBiometricKey,
    lock,
    emptyTrash,
    confirmMasterPassword,
  } = useVault()
  const { toast } = useToast()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordDone, setPasswordDone] = useState(false)

  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPassword, setImportPassword] = useState('')
  const [importAcknowledged, setImportAcknowledged] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourceText, setSourceText] = useState('')
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null)
  const [sourceItems, setSourceItems] = useState<ParsedImport | null>(null)
  const [sourceVaultId, setSourceVaultId] = useState(vaults[0]?.id ?? '')
  const [sourceBusy, setSourceBusy] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [sourceReport, setSourceReport] = useState<{
    imported: number
    duplicates: number
    warnings: string[]
  } | null>(null)

  const [showReset, setShowReset] = useState(false)
  const [showLockConfirm, setShowLockConfirm] = useState(false)
  const [showEmptyTrash, setShowEmptyTrash] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)

  const [biometricsReady, setBiometricsReady] = useState(false)
  const [biometricBusy, setBiometricBusy] = useState(false)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [persistBusy, setPersistBusy] = useState(false)
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate | null>(null)
  const [csvFormat, setCsvFormat] = useState<CsvExportFormat>('apple')
  const [csvPassword, setCsvPassword] = useState('')
  const [csvBusy, setCsvBusy] = useState(false)

  const [verifyBusy, setVerifyBusy] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifyReport, setVerifyReport] = useState<VaultIntegrityReport | null>(null)

  const entropy = useMemo(() => estimateEntropy(newPassword), [newPassword])
  const newPasswordValid = newPassword.length >= 12 && entropy >= 50
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword

  const sourcePreview = useMemo(
    () =>
      sourceItems
        ? dedupeImport(sourceItems.items, items)
        : { items: [], duplicates: [] },
    [sourceItems, items],
  )
  const sourceImportCount = skipDuplicates
    ? sourcePreview.items.length
    : (sourceItems?.items.length ?? 0)

  useEffect(() => {
    let cancelled = false
    void biometricAvailable().then((available) => {
      if (!cancelled) setBiometricsReady(available)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [status, estimate] = await Promise.all([
        getPersistentStorageStatus(),
        getStorageEstimate(),
      ])
      if (cancelled) return
      setPersisted(status)
      setStorageEstimate(estimate)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const enablePersistence = async () => {
    setPersistBusy(true)
    try {
      const granted = await requestPersistentStorage()
      setPersisted(granted)
      toast(
        granted
          ? 'Stockage persistant activé : le navigateur ne doit plus effacer le coffre.'
          : 'Le navigateur a refusé le stockage persistant.',
        granted ? 'success' : 'error',
      )
    } finally {
      setPersistBusy(false)
    }
  }

  const exportCsvFile = async () => {
    if (!csvPassword) return
    setCsvBusy(true)
    try {
      // Un export en clair de tout le coffre exige de ressaisir le mot de
      // passe maître : une session laissée ouverte ne suffit pas.
      if (!(await confirmMasterPassword(csvPassword))) {
        toast('Mot de passe maître incorrect', 'error')
        return
      }
      setCsvPassword('')
      const result = exportCsv(items, vaults, csvFormat)
      downloadFile(result.content, result.filename, 'text/csv;charset=utf-8')
      const label =
        result.exported === 1 ? '1 élément exporté' : `${result.exported} éléments exportés`
      toast(
        `${label} en CSV.${result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : ''}`,
        result.warnings.length > 0 ? 'info' : 'success',
      )
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Export CSV impossible', 'error')
    } finally {
      setCsvBusy(false)
    }
  }

  const runVerify = async () => {
    setVerifyBusy(true)
    setVerifyError(null)
    setVerifyReport(null)
    try {
      const report = await verify()
      setVerifyReport(report)
      toast('Intégrité du coffre vérifiée', 'success')
    } catch (caught) {
      setVerifyError(
        caught instanceof Error ? caught.message : 'Vérification impossible',
      )
    } finally {
      setVerifyBusy(false)
    }
  }

  const change = async () => {
    setPasswordError(null)
    setPasswordDone(false)
    if (!currentPassword) {
      setPasswordError('Saisissez votre mot de passe actuel.')
      return
    }
    if (!newPasswordValid) {
      setPasswordError('Le nouveau mot de passe doit faire au moins 12 caractères et être solide.')
      return
    }
    if (!passwordsMatch) {
      setPasswordError('Les nouveaux mots de passe ne correspondent pas.')
      return
    }

    setPasswordBusy(true)
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordDone(true)
      toast('Mot de passe maître modifié', 'success')
    } catch (caught) {
      setPasswordError(caught instanceof Error ? caught.message : 'Modification impossible')
    } finally {
      setPasswordBusy(false)
    }
  }

  const importVaultFile = async () => {
    if (!importFile || !importPassword || !importAcknowledged) return
    if (importFile.size > 100_000_000) {
      setImportError('Fichier trop volumineux (100 Mo maximum).')
      return
    }
    setImportBusy(true)
    setImportError(null)
    try {
      const text = await importFile.text()
      await importVault(text, importPassword)
      toast('Coffre importé et déverrouillé', 'success')
      onImported?.()
      onClose()
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : 'Import impossible')
      setImportBusy(false)
    }
  }

  const selectSourceFile = async (selected: File | null) => {
    setSourceFile(selected)
    setSourceText('')
    setSourceBytes(null)
    setSourceItems(null)
    setSourceError(null)
    setSourceReport(null)
    setSkipDuplicates(true)
    if (!selected) return

    const isP1ux = selected.name.toLowerCase().endsWith('.1pux')
    const limit = isP1ux ? 50_000_000 : 20_000_000
    if (selected.size > limit) {
      setSourceError(
        `Fichier trop volumineux (${isP1ux ? '50' : '20'} Mo maximum pour un import).`,
      )
      return
    }

    const target = sourceVaultId || vaults[0]?.id || ''
    if (!target) {
      setSourceError('Aucun coffre de destination disponible.')
      return
    }

    try {
      if (isP1ux) {
        const bytes = new Uint8Array(await selected.arrayBuffer())
        const parsed = await parse1pux(bytes, target)
        setSourceBytes(bytes)
        setSourceItems(parsed)
      } else {
        const text = await selected.text()
        const parsed = parseImport(text, target)
        setSourceText(text)
        setSourceItems(parsed)
      }
      setSourceVaultId(target)
    } catch (caught) {
      setSourceError(
        caught instanceof Error ? caught.message : 'Lecture du fichier impossible',
      )
    }
  }

  const changeSourceVault = async (vaultId: string) => {
    setSourceVaultId(vaultId)
    setSourceReport(null)
    if (!sourceText && !sourceBytes) return
    try {
      const parsed =
        sourceBytes !== null
          ? await parse1pux(sourceBytes, vaultId)
          : parseImport(sourceText, vaultId)
      setSourceItems(parsed)
      setSourceError(null)
    } catch (caught) {
      setSourceItems(null)
      setSourceError(
        caught instanceof Error ? caught.message : 'Lecture du fichier impossible',
      )
    }
  }

  const runSourceImport = async () => {
    if (!sourceItems || sourceImportCount === 0) return
    const drafts = skipDuplicates ? sourcePreview.items : sourceItems.items
    setSourceBusy(true)
    setSourceError(null)
    try {
      const report = await importItems(drafts)
      setSourceReport({
        ...report,
        duplicates: skipDuplicates ? sourcePreview.duplicates.length : 0,
      })
      toast(
        report.imported > 0
          ? `${report.imported} élément${report.imported > 1 ? 's' : ''} importé${
              report.imported > 1 ? 's' : ''
            }`
          : 'Aucun élément importé',
        report.imported > 0 ? 'success' : 'error',
      )
      if (report.imported > 0) {
        setSourceItems(null)
        setSourceFile(null)
        setSourceText('')
        setSourceBytes(null)
        setSkipDuplicates(true)
      }
    } catch (caught) {
      setSourceError(caught instanceof Error ? caught.message : 'Import impossible')
    } finally {
      setSourceBusy(false)
    }
  }

  const resetBiometric = async () => {
    setBiometricBusy(true)
    try {
      await resetBiometricKey()
      toast('Clé Touch ID réinitialisée', 'success')
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : 'Réinitialisation Touch ID impossible',
        'error',
      )
    } finally {
      setBiometricBusy(false)
    }
  }

  const resetVault = async () => {
    await reset()
    setShowReset(false)
  }

  const activeItems = items.filter((item) => !item.deletedAt)
  const trashedItems = items.filter((item) => item.deletedAt)
  const counts = {
    login: activeItems.filter((item) => item.type === 'login').length,
    card: activeItems.filter((item) => item.type === 'card').length,
    note: activeItems.filter((item) => item.type === 'note').length,
    identity: activeItems.filter((item) => item.type === 'identity').length,
  }

  return (
    <>
      <Modal
        title="Réglages"
        description="Préférences locales, sécurité et sauvegardes."
        size="lg"
        onClose={onClose}
      >
        <div className="settings">
          <section className="settings-section">
            <div className="settings-section__head">
              <span className="settings-section__icon">
                <HardDrive size={18} />
              </span>
              <div>
                <h3>Général</h3>
                <p>Ces préférences restent dans ce navigateur.</p>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span className="field__label">Verrouillage automatique</span>
                <select
                  className="input"
                  value={settings.autoLockMinutes}
                  onChange={(event) =>
                    updateSettings({ autoLockMinutes: Number(event.target.value) })
                  }
                >
                  <option value={0}>Jamais</option>
                  <option value={1}>Après 1 minute</option>
                  <option value={5}>Après 5 minutes</option>
                  <option value={15}>Après 15 minutes</option>
                  <option value={30}>Après 30 minutes</option>
                  <option value={60}>Après 1 heure</option>
                </select>
              </label>

              <label className="field">
                <span className="field__label">Effacement du presse-papiers</span>
                <select
                  className="input"
                  value={settings.clipboardClearSeconds}
                  onChange={(event) =>
                    updateSettings({ clipboardClearSeconds: Number(event.target.value) })
                  }
                >
                  <option value={0}>Jamais</option>
                  <option value={15}>Après 15 secondes</option>
                  <option value={30}>Après 30 secondes</option>
                  <option value={60}>Après 1 minute</option>
                  <option value={120}>Après 2 minutes</option>
                </select>
              </label>

              <label className="field field--full">
                <span className="field__label">Conservation de la corbeille</span>
                <select
                  className="input"
                  value={settings.trashRetentionDays}
                  onChange={(event) =>
                    updateSettings({ trashRetentionDays: Number(event.target.value) })
                  }
                >
                  <option value={0}>Jamais purger automatiquement</option>
                  <option value={7}>Après 7 jours</option>
                  <option value={30}>Après 30 jours</option>
                  <option value={90}>Après 90 jours</option>
                  <option value={365}>Après 1 an</option>
                </select>
                <span className="field__hint">
                  La purge s’applique à l’ouverture du coffre et après un import.
                </span>
              </label>
            </div>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.lockOnHide}
                onChange={(event) =>
                  updateSettings({ lockOnHide: event.target.checked })
                }
              />
              <span>Verrouiller lorsque l’onglet passe en arrière-plan</span>
            </label>
            <p className="settings-copy">
              Recommandé : dès que Coffre n’est plus visible, les clés sont effacées de la
              mémoire. Ce verrouillage s’applique même si le délai d’inactivité est désactivé.
              L’extension navigateur a besoin d’un onglet Coffre déverrouillé : avec cette
              option, ouvrez Coffre dans une fenêtre séparée qui reste visible.
            </p>

            {isTauriRuntime() && (
              <>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={settings.lockOnFocusLoss}
                    onChange={(event) =>
                      updateSettings({ lockOnFocusLoss: event.target.checked })
                    }
                  />
                  <span>Verrouiller lorsque la fenêtre perd le focus</span>
                </label>
                <p className="settings-copy">
                  Utile sur desktop : cliquer dans une autre application verrouille le coffre.
                  Laissez désactivé si vous utilisez souvent des dialogues système.
                </p>
              </>
            )}

            <div className="settings-divider" />

            <label className="field field--full">
              <span className="field__label">Apparence</span>
              <select
                className="input"
                value={settings.theme}
                onChange={(event) =>
                  updateSettings({ theme: event.target.value as ThemePreference })
                }
              >
                <option value="dark">Sombre</option>
                <option value="light">Clair</option>
                <option value="system">Suivre le système</option>
              </select>
            </label>

            <div className="settings-divider" />

            {isTauriRuntime() ? (
              <>
                <h4 className="settings-subtitle">Stockage natif</h4>
                <p className="settings-copy">
                  Le coffre chiffré est enregistré dans le dossier de données de
                  l’application, avec trois sauvegardes tournantes, des écritures
                  atomiques et des permissions réservées à votre compte. Aucune donnée
                  n’est envoyée sur Internet.
                </p>
              </>
            ) : (
              <>
                <h4 className="settings-subtitle">Stockage du navigateur</h4>
                <p className="settings-copy">
                  {persisted === true
                    ? 'Stockage persistant activé : le navigateur s’engage à conserver le coffre.'
                    : persisted === false
                      ? 'Stockage non persistant : le navigateur peut effacer le coffre en cas de manque d’espace. Exportez régulièrement une sauvegarde.'
                      : 'Ce navigateur ne permet pas de connaître le statut du stockage persistant. Exportez régulièrement une sauvegarde.'}
                  {storageEstimate && storageEstimate.quota > 0
                    ? ` Espace utilisé : ${formatBytes(storageEstimate.usage)} sur ${formatBytes(storageEstimate.quota)}.`
                    : ''}
                </p>

                <div className="settings-actions settings-actions--start">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => void enablePersistence()}
                    disabled={persistBusy || persisted === true}
                  >
                    {persistBusy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <HardDrive size={16} />
                    )}
                    {persisted === true
                      ? 'Stockage persistant activé'
                      : persistBusy
                        ? 'Demande en cours…'
                        : 'Rendre le stockage persistant'}
                  </button>
                </div>
              </>
            )}

            <div className="settings-actions">
              <button type="button" className="button button--secondary" onClick={() => setShowLockConfirm(true)}>
                <LockKeyhole size={16} />
                Verrouiller maintenant
              </button>
            </div>
          </section>

          {keychainAvailable() && (
            <section className="settings-section">
              <div className="settings-section__head">
                <span className="settings-section__icon">
                  <Fingerprint size={18} />
                </span>
                <div>
                  <h3>Trousseau du système</h3>
                  <p>Déverrouillage rapide par le trousseau de l’appareil.</p>
                </div>
              </div>

              {biometricsReady && (
                <>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={settings.biometricUnlock}
                      onChange={(event) => {
                        const enabled = event.target.checked
                        updateSettings({
                          biometricUnlock: enabled,
                          ...(enabled ? { keychainUnlock: false } : {}),
                        })
                      }}
                    />
                    <span>Déverrouiller avec Touch ID (empreinte)</span>
                  </label>
                  <p className="settings-copy">
                    La clé maîtresse est rangée dans une entrée séparée du trousseau de
                    session ; Coffre ne la relit qu’après une empreinte reconnue. Il
                    s’agit d’une protection de l’application, pas du système : un
                    programme qui obtient l’accès à votre trousseau (avec le mot de passe
                    de session) peut la lire sans empreinte. Le dialogue Touch ID s’ouvre
                    automatiquement lorsque la fenêtre Coffre est activée. La clé reste en
                    place pendant le verrouillage, puis elle est supprimée si l’option est
                    désactivée ou le coffre réinitialisé.
                  </p>
                  {settings.biometricUnlock && (
                    <div className="settings-actions settings-actions--start">
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => void resetBiometric()}
                        disabled={biometricBusy}
                      >
                        {biometricBusy ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <Fingerprint size={16} />
                        )}
                        {biometricBusy ? 'Réinitialisation…' : 'Réinitialiser Touch ID'}
                      </button>
                    </div>
                  )}
                  <div className="settings-divider" />
                </>
              )}

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={settings.keychainUnlock}
                  disabled={settings.biometricUnlock}
                  onChange={(event) =>
                    updateSettings({ keychainUnlock: event.target.checked })
                  }
                />
                <span>
                  Mémoriser la clé maîtresse dans le trousseau du système
                  {settings.biometricUnlock ? ' (remplacé par Touch ID)' : ''}
                </span>
              </label>
              <p className="settings-copy">
                La clé est conservée hors du coffre, protégée par votre session
                système (macOS, Windows ou Linux). Elle est supprimée dès que le
                coffre est verrouillé (bouton, inactivité ou arrière-plan). Si vous
                quittez Coffre sans le verrouiller, il se rouvrira sans mot de passe
                au prochain lancement : toute personne ayant accès à votre session
                pourra alors l’ouvrir.
              </p>
            </section>
          )}

          <section className="settings-section">
            <div className="settings-section__head">
              <span className="settings-section__icon">
                <KeyRound size={18} />
              </span>
              <div>
                <h3>Mot de passe maître</h3>
                <p>
                  Le changer régénère toutes les clés et rechiffre le contenu : l’ancien
                  mot de passe ne pourra plus lire ce qui sera enregistré ensuite.
                </p>
              </div>
            </div>

            <div className="form-grid">
              <label className="field field--full">
                <span className="field__label">Mot de passe actuel</span>
                <input
                  className="input"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <label className="field">
                <span className="field__label">Nouveau mot de passe</span>
                <input
                  className="input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="12 caractères minimum"
                />
                {newPassword && (
                  <PasswordStrength entropy={entropy} showEntropy />
                )}
              </label>
              <label className="field">
                <span className="field__label">Confirmer</span>
                <input
                  className="input"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                />
                {confirmPassword && !passwordsMatch && (
                  <span className="field__hint field__hint--error">
                    Les mots de passe ne correspondent pas.
                  </span>
                )}
              </label>
            </div>

            {passwordError && (
              <p className="form-error" role="alert">
                <AlertTriangle size={16} />
                {passwordError}
              </p>
            )}
            {passwordDone && (
              <p className="form-success" role="status">
                <Check size={16} />
                Mot de passe modifié. Il sera demandé au prochain déverrouillage.
              </p>
            )}

            <div className="settings-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void change()}
                disabled={passwordBusy}
              >
                {passwordBusy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <KeyRound size={16} />
                )}
                {passwordBusy ? 'Modification…' : 'Modifier le mot de passe'}
              </button>
            </div>

            {file && (
              <div className="kdf-info">
                <span>
                  <strong>Argon2id</strong> · {Math.round(file.kdf.memoryKiB / 1024)} Mio ·{' '}
                  {file.kdf.iterations} itérations · {file.kdf.parallelism} threads
                </span>
                <small>Sel unique par coffre, clé AES de 256 bits.</small>
              </div>
            )}
          </section>

          <section className="settings-section">
            <div className="settings-section__head">
              <span className="settings-section__icon">
                <FileKey2 size={18} />
              </span>
              <div>
                <h3>Sauvegarde</h3>
                <p>Le fichier exporté est chiffré avec votre mot de passe maître.</p>
              </div>
            </div>

            <div className="settings-actions settings-actions--start">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  try {
                    exportVault()
                    toast('Coffre exporté', 'success')
                  } catch (caught) {
                    toast(caught instanceof Error ? caught.message : 'Export impossible', 'error')
                  }
                }}
              >
                <Download size={16} />
                Exporter le coffre
              </button>
            </div>

            <div className="settings-divider" />

            <h4 className="settings-subtitle">Exporter en CSV</h4>
            <p className="settings-copy">
              Le CSV est un fichier <strong>en clair</strong> : importez-le immédiatement,
              puis supprimez-le. Le format Mots de passe ne contient que les connexions
              actives ; le format complet inclut tous les éléments, sans les pièces
              jointes. N’ouvrez pas ce fichier dans un tableur : une valeur commençant
              par « = » pourrait y être interprétée comme une formule.
            </p>

            <label className="field field--full">
              <span className="field__label">Format CSV</span>
              <select
                className="input"
                value={csvFormat}
                onChange={(event) => setCsvFormat(event.target.value as CsvExportFormat)}
              >
                <option value="apple">Mots de passe (Apple) — connexions</option>
                <option value="coffre">Coffre complet — tous les éléments</option>
              </select>
            </label>

            <label className="field field--full">
              <span className="field__label">Mot de passe maître</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={csvPassword}
                onChange={(event) => setCsvPassword(event.target.value)}
                aria-label="Mot de passe maître pour l’export CSV"
              />
            </label>

            <div className="settings-actions settings-actions--start">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void exportCsvFile()}
                disabled={!csvPassword || csvBusy}
              >
                {csvBusy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
                Exporter en CSV
              </button>
            </div>

            <div className="settings-divider" />

            <h4 className="settings-subtitle">Vérifier l’intégrité</h4>
            <p className="settings-copy">
              Déchiffre chaque coffre, chaque élément, chaque version et chaque pièce jointe
              pour détecter une altération locale. Aucune donnée ne quitte l’appareil.
            </p>

            <div className="settings-actions settings-actions--start">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void runVerify()}
                disabled={verifyBusy}
              >
                {verifyBusy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <ShieldCheck size={16} />
                )}
                {verifyBusy ? 'Vérification…' : 'Vérifier le coffre'}
              </button>
            </div>

            {verifyError && (
              <p className="form-error" role="alert">
                <AlertTriangle size={16} />
                {verifyError}
              </p>
            )}
            {verifyReport && (
              <p className="form-success" role="status">
                <Check size={16} />
                Intégrité confirmée : {pluralize(verifyReport.vaults, 'coffre')} ·{' '}
                {pluralize(verifyReport.items, 'élément')} ·{' '}
                {pluralize(verifyReport.attachments, 'pièce jointe', 'pièces jointes')} ·{' '}
                {pluralize(verifyReport.versions, 'version')}.
                {verifyReport.attachments > 0
                  ? ` ${formatBytes(verifyReport.attachmentBytes)} de pièces jointes déchiffrées.`
                  : ''}
              </p>
            )}

            <div className="settings-divider" />

            <h4 className="settings-subtitle">Importer un coffre</h4>
            <p className="settings-copy">
              Le fichier importé remplace le coffre actuellement stocké dans ce navigateur.
              Exportez d’abord une sauvegarde si nécessaire.
            </p>

            <div className="form-grid">
              <label className="file-drop field--full">
                <input
                  type="file"
                  accept=".coffre,.json,application/json"
                  onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                />
                <Upload size={20} />
                <span>{importFile ? importFile.name : 'Choisir un fichier .coffre'}</span>
                <small>
                  {importFile
                    ? `${Math.ceil(importFile.size / 1024)} Ko`
                    : 'Le fichier reste sur cet appareil'}
                </small>
              </label>

              <label className="field field--full">
                <span className="field__label">Mot de passe du fichier</span>
                <input
                  className="input"
                  type="password"
                  value={importPassword}
                  onChange={(event) => setImportPassword(event.target.value)}
                  autoComplete="off"
                />
              </label>
            </div>

            <label className="checkbox checkbox--warning">
              <input
                type="checkbox"
                checked={importAcknowledged}
                onChange={(event) => setImportAcknowledged(event.target.checked)}
              />
              <span>Je comprends que le coffre local actuel sera remplacé.</span>
            </label>

            {importError && (
              <p className="form-error" role="alert">
                <AlertTriangle size={16} />
                {importError}
              </p>
            )}

            <div className="settings-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void importVaultFile()}
                disabled={!importFile || !importPassword || !importAcknowledged || importBusy}
              >
                {importBusy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}
                {importBusy ? 'Importation…' : 'Remplacer par ce coffre'}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__head">
              <span className="settings-section__icon">
                <KeyRound size={18} />
              </span>
              <div>
                <h3>Phrase de récupération</h3>
                <p>
                  Une seconde clé optionnelle pour rouvrir le coffre sans le mot de passe
                  maître. La phrase n’est stockée nulle part.
                </p>
              </div>
            </div>

            {file?.recovery ? (
              <p className="settings-copy">
                <ShieldCheck size={15} /> Phrase configurée le{' '}
                <strong>{formatDateTime(file.recovery.createdAt)}</strong>. Elle permet de
                choisir un nouveau mot de passe maître en cas d’oubli.
              </p>
            ) : (
              <p className="settings-copy">
                Aucune phrase n’est configurée. Sans elle, perdre le mot de passe maître
                revient à perdre les données.
              </p>
            )}

            <div className="settings-actions settings-actions--start">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setShowRecovery(true)}
              >
                <KeyRound size={16} />
                {file?.recovery ? 'Gérer la phrase' : 'Configurer une phrase'}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__head">
              <span className="settings-section__icon">
                <FileSpreadsheet size={18} />
              </span>
              <div>
                <h3>Importer depuis un autre gestionnaire</h3>
                <p>
                  Exports JSON Bitwarden, Proton Pass et Enpass, ou CSV de 1Password,
                  LastPass, Chrome, Firefox, Safari, Dashlane, KeePass, NordPass,
                  Keeper, RoboForm et SafeInCloud. Les éléments sont ajoutés au coffre
                  choisi, puis chiffrés localement. Les doublons peuvent être ignorés.
                </p>
              </div>
            </div>

            <label className="file-drop">
              <input
                type="file"
                accept=".json,.csv,application/json,text/csv"
                onChange={(event) => {
                  void selectSourceFile(event.target.files?.[0] ?? null)
                  event.target.value = ''
                }}
                disabled={sourceBusy}
              />
              <Upload size={20} />
              <span>
                {sourceFile ? sourceFile.name : 'Choisir un fichier JSON, CSV ou 1PUX'}
              </span>
              <small>
                {sourceFile
                  ? `${Math.ceil(sourceFile.size / 1024)} Ko`
                  : 'Bitwarden, Proton Pass, Enpass, 1Password (1PUX), LastPass, Chrome, Firefox, Safari, Dashlane, KeePass…'}
              </small>
            </label>

            {sourceError && (
              <p className="form-error" role="alert">
                <AlertTriangle size={16} />
                {sourceError}
              </p>
            )}

            {sourceItems && (
              <>
                <div className="import-summary">
                  <strong>{sourceItems.items.length}</strong>
                  <span>
                    élément{sourceItems.items.length > 1 ? 's' : ''} détecté
                    {sourceItems.items.length > 1 ? 's' : ''} ·{' '}
                    {sourceItems.format === 'csv'
                      ? 'CSV'
                      : sourceItems.format === '1pux'
                        ? '1PUX'
                        : 'JSON'}{' '}
                    {importSourceLabel(sourceItems.source)}
                    {sourcePreview.duplicates.length > 0 &&
                      ` · ${sourcePreview.duplicates.length} doublon${
                        sourcePreview.duplicates.length > 1 ? 's' : ''
                      }`}
                  </span>
                </div>

                <label className="field">
                  <span className="field__label">Coffre de destination</span>
                  <select
                    className="input"
                    value={sourceVaultId}
                    onChange={(event) => changeSourceVault(event.target.value)}
                    disabled={sourceBusy}
                  >
                    {vaults.map((vault) => (
                      <option key={vault.id} value={vault.id}>
                        {vault.name}
                      </option>
                    ))}
                  </select>
                </label>

                {sourcePreview.duplicates.length > 0 && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(event) => setSkipDuplicates(event.target.checked)}
                      disabled={sourceBusy}
                    />
                    <span>
                      <strong>Ignorer les doublons.</strong> {sourcePreview.duplicates.length}{' '}
                      élément{sourcePreview.duplicates.length > 1 ? 's' : ''} semble
                      {sourcePreview.duplicates.length > 1 ? 'nt' : ''} déjà présent
                      {sourcePreview.duplicates.length > 1 ? 's' : ''} dans le coffre
                      (même type et mêmes informations d’identification).
                    </span>
                  </label>
                )}

                {sourcePreview.duplicates.length > 0 &&
                  sourceImportCount === 0 &&
                  skipDuplicates && (
                    <p className="field__hint">
                      Tous les éléments de ce fichier sont déjà présents. Décochez
                      « Ignorer les doublons » pour les importer quand même.
                    </p>
                  )}

                {sourceItems.warnings.length > 0 && (
                  <ul className="import-warnings">
                    {sourceItems.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                )}

                <div className="settings-actions">
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => void runSourceImport()}
                    disabled={sourceBusy || sourceImportCount === 0}
                  >
                    {sourceBusy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Upload size={16} />
                    )}
                    {sourceBusy
                      ? 'Importation…'
                      : `Importer ${sourceImportCount} élément${
                          sourceImportCount > 1 ? 's' : ''
                        }`}
                  </button>
                </div>
              </>
            )}

            {sourceReport && (
              <div className="import-report" role="status">
                <p>
                  <Check size={16} />
                  {sourceReport.imported} élément
                  {sourceReport.imported > 1 ? 's' : ''} ajouté
                  {sourceReport.imported > 1 ? 's' : ''} au coffre.
                </p>
                {sourceReport.duplicates > 0 && (
                  <p>
                    {sourceReport.duplicates} doublon
                    {sourceReport.duplicates > 1 ? 's' : ''} ignoré
                    {sourceReport.duplicates > 1 ? 's' : ''}.
                  </p>
                )}
                {sourceReport.warnings.length > 0 && (
                  <details>
                    <summary>
                      {sourceReport.warnings.length} ligne
                      {sourceReport.warnings.length > 1 ? 's' : ''} ignorée
                      {sourceReport.warnings.length > 1 ? 's' : ''}
                    </summary>
                    <ul className="import-warnings">
                      {sourceReport.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </section>

          <section className="settings-section">
            <div className="settings-section__head">
              <span className="settings-section__icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <h3>Contenu du coffre</h3>
                <p>
                  {vaults.length} coffre{vaults.length > 1 ? 's' : ''} · {activeItems.length}{' '}
                  élément{activeItems.length > 1 ? 's' : ''} actif
                  {activeItems.length > 1 ? 's' : ''}
                  {trashedItems.length > 0
                    ? ` · ${trashedItems.length} dans la corbeille`
                    : ''}
                </p>
              </div>
            </div>

            <div className="stat-grid">
              {(['login', 'card', 'note', 'identity'] as const).map((type) => (
                <div key={type} className="stat">
                  <strong>{counts[type]}</strong>
                  <span>{itemTypeLabel(type)}</span>
                </div>
              ))}
            </div>

            {trashedItems.length > 0 && (
              <div className="settings-actions settings-actions--start">
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => setShowEmptyTrash(true)}
                >
                  <Trash2 size={16} />
                  Vider la corbeille ({trashedItems.length})
                </button>
              </div>
            )}

            {file && (
              <p className="settings-copy">
                Dernière écriture locale : {formatDateTime(file.updatedAt)} · format v
                {file.version} · identifiant {file.id.slice(0, 12)}…
              </p>
            )}
          </section>

          <section className="settings-section settings-section--danger">
            <div className="settings-section__head">
              <span className="settings-section__icon">
                <Trash2 size={18} />
              </span>
              <div>
                <h3>Zone dangereuse</h3>
                <p>Supprime définitivement le coffre de ce navigateur.</p>
              </div>
            </div>
            <div className="settings-actions settings-actions--start">
              <button
                type="button"
                className="button button--danger"
                onClick={() => setShowReset(true)}
              >
                <Trash2 size={16} />
                Effacer le coffre local
              </button>
            </div>
          </section>

          <p className="settings-about">
            Coffre v0.8.0 · chiffrement local inspiré de Proton Pass · GPL-3.0. Aucune donnée
            n’est transmise. Le modèle de sécurité complet est décrit dans{' '}
            <code>docs/SECURITY.md</code>.
          </p>
        </div>
      </Modal>

      {showReset && (
        <ConfirmDialog
          title="Effacer tout le coffre ?"
          description="Tous les coffres et éléments stockés dans ce navigateur seront supprimés. Cette action est définitive."
          confirmLabel="Effacer définitivement"
          requireText="SUPPRIMER"
          onClose={() => setShowReset(false)}
          onConfirm={resetVault}
        />
      )}

      {showEmptyTrash && (
        <ConfirmDialog
          title="Vider la corbeille ?"
          description={`${trashedItems.length} élément${
            trashedItems.length > 1 ? 's' : ''
          }, leurs pièces jointes et leur historique seront définitivement supprimés. Cette action est irréversible.`}
          confirmLabel="Vider définitivement"
          requireText="SUPPRIMER"
          onClose={() => setShowEmptyTrash(false)}
          onConfirm={async () => {
            const removed = await emptyTrash()
            setShowEmptyTrash(false)
            toast(
              `${removed} élément${removed > 1 ? 's' : ''} supprimé${
                removed > 1 ? 's' : ''
              } définitivement`,
              'info',
            )
          }}
        />
      )}

      {showRecovery && <RecoveryDialog onClose={() => setShowRecovery(false)} />}

      {showLockConfirm && (
        <ConfirmDialog
          title="Verrouiller maintenant ?"
          description="Vos clés seront effacées de la mémoire. Il faudra ressaisir votre mot de passe maître."
          confirmLabel="Verrouiller"
          tone="primary"
          onClose={() => setShowLockConfirm(false)}
          onConfirm={() => {
            setShowLockConfirm(false)
            lock()
          }}
        />
      )}
    </>
  )
}
