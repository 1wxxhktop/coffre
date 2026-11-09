import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Cloud,
  Download,
  FileKey2,
  FileSpreadsheet,
  Fingerprint,
  HardDrive,
  KeyRound,
  Languages,
  LoaderCircle,
  Share2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react'
import { Modal } from './Modal'
import { SyncSettings } from './SyncSettings'
import { TemplateSettings } from './TemplateSettings'
import { ActivitySettings } from './ActivitySettings'
import { BlobStorageSettings } from './BlobStorageSettings'
import { BackupSettings } from './BackupSettings'
import { SshAgentSettings } from './SshAgentSettings'
import { SharingSettings } from './SharingSettings'
import { EmergencyAccessSettings } from './EmergencyAccessSettings'
import { ConfirmDialog } from './ConfirmDialog'
import { PasswordStrength } from './PasswordStrength'
import { RecoveryDialog } from './RecoveryDialog'
import { EmergencyKitDialog } from './EmergencyKitDialog'
import { KdbxExportDialog } from './KdbxExportDialog'
import { CxfExportDialog } from './CxfExportDialog'
import { readKdbx } from '../lib/kdbx'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'
import { estimateEntropy } from '../lib/strength'
import { keychainAvailable } from '../lib/keychain'
import { biometricAvailable } from '../lib/biometrics'
import { prfSupported } from '../lib/prf'
import { isTauriRuntime } from '../lib/external'
import { ensureNotificationPermission } from '../lib/notifications'
import { LOCALES, type Locale } from '../lib/i18n'
import {
  dedupeImport,
  detectImportFormat,
  importSourceLabel,
  parseImport,
  type ParsedImport,
} from '../lib/import'
import { parseCxf } from '../lib/cxf'
import { parse1pux } from '../lib/onePassword'
import { downloadFile, formatBytes, formatDateTime, pluralize } from '../lib/settings'
import { exportCsv, type CsvExportFormat } from '../lib/export'
import { openOfflineShare } from '../lib/offlineShare'
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

type SettingsPage =
  | 'general'
  | 'sync'
  | 'security'
  | 'templates'
  | 'activity'
  | 'backup'
  | 'storage'
  | 'danger'

const SETTINGS_PAGES: Array<{
  id: SettingsPage
  label: string
  icon: typeof SlidersHorizontal
}> = [
  { id: 'general', label: 'Général', icon: SlidersHorizontal },
  { id: 'sync', label: 'Synchronisation', icon: Cloud },
  { id: 'security', label: 'Sécurité', icon: ShieldCheck },
  { id: 'templates', label: 'Modèles', icon: FileKey2 },
  { id: 'activity', label: 'Journal d’activité', icon: FileKey2 },
  { id: 'backup', label: 'Sauvegarde et import', icon: FileKey2 },
  { id: 'storage', label: 'Stockage', icon: HardDrive },
  { id: 'danger', label: 'Zone dangereuse', icon: Trash2 },
]

export function SettingsDialog({ onClose, onImported }: SettingsDialogProps) {
  const { settings, updateSettings } = useSettings()
  const { tt } = useI18n()
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
    enrollPrf,
    removePrf,
    emptyTrash,
    recordActivity,
    confirmMasterPassword,
  } = useVault()
  const { toast } = useToast()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordDone, setPasswordDone] = useState(false)
  const [prfBusy, setPrfBusy] = useState(false)

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

  const [shareText, setShareText] = useState('')
  const [shareKey, setShareKey] = useState('')
  const [shareVaultId, setShareVaultId] = useState(vaults[0]?.id ?? '')
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareReport, setShareReport] = useState<string | null>(null)

  const [kdbxFile, setKdbxFile] = useState<File | null>(null)
  const [kdbxKeyFile, setKdbxKeyFile] = useState<File | null>(null)
  const [kdbxPassword, setKdbxPassword] = useState('')
  const [kdbxVaultId, setKdbxVaultId] = useState(vaults[0]?.id ?? '')
  const [kdbxBusy, setKdbxBusy] = useState(false)
  const [kdbxError, setKdbxError] = useState<string | null>(null)
  const [kdbxReport, setKdbxReport] = useState<string | null>(null)

  const [showReset, setShowReset] = useState(false)
  const [showEmptyTrash, setShowEmptyTrash] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [showEmergencyKit, setShowEmergencyKit] = useState(false)
  const [showKdbxExport, setShowKdbxExport] = useState(false)
  const [showCxfExport, setShowCxfExport] = useState(false)
  const [page, setPage] = useState<SettingsPage>('general')
  const [mobilePageOpen, setMobilePageOpen] = useState(false)

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
  const activeShareVaultId = vaults.some((vault) => vault.id === shareVaultId)
    ? shareVaultId
    : vaults[0]?.id ?? ''
  const activeKdbxVaultId = vaults.some((vault) => vault.id === kdbxVaultId)
    ? kdbxVaultId
    : vaults[0]?.id ?? ''

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
        tt(
          granted
            ? 'Stockage persistant activé : le navigateur ne doit plus effacer le coffre.'
            : 'Le navigateur a refusé le stockage persistant.',
        ),
        granted ? 'success' : 'error',
      )
    } finally {
      setPersistBusy(false)
    }
  }

  const toggleExpiryNotifications = async (enabled: boolean) => {
    if (!enabled) {
      updateSettings({ expiryNotifications: false })
      return
    }
    const granted = await ensureNotificationPermission()
    updateSettings({ expiryNotifications: granted })
    if (!granted) {
      toast(
        tt(
          'Notifications refusées ou indisponibles dans cet environnement. Le rappel reste visible dans la vue « Bientôt expirés ».',
        ),
        'error',
      )
    }
  }

  const exportCsvFile = async () => {
    if (!csvPassword) return
    setCsvBusy(true)
    try {
      // Un export en clair de tout le coffre exige de ressaisir le mot de
      // passe maître : une session laissée ouverte ne suffit pas.
      if (!(await confirmMasterPassword(csvPassword))) {
        toast(tt('Mot de passe maître incorrect'), 'error')
        return
      }
      setCsvPassword('')
      const result = exportCsv(items, vaults, csvFormat)
      downloadFile(result.content, result.filename, 'text/csv;charset=utf-8')
      const label =
        result.exported === 1 ? '1 élément exporté' : `${result.exported} éléments exportés`
      void recordActivity('export', `CSV : ${label}`)
      toast(
        `${label} en CSV.${result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : ''}`,
        result.warnings.length > 0 ? 'info' : 'success',
      )
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : tt('Export CSV impossible'), 'error')
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
      toast(tt('Intégrité du coffre vérifiée'), 'success')
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
      void recordActivity('password-change', 'Mot de passe maître modifié')
      toast(tt('Mot de passe maître modifié'), 'success')
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
      toast(tt('Coffre importé et déverrouillé'), 'success')
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
        const parsed =
          detectImportFormat(text) === 'cxf'
            ? await parseCxf(text, target)
            : parseImport(text, target)
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
          : detectImportFormat(sourceText) === 'cxf'
            ? await parseCxf(sourceText, vaultId)
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
          : tt('Aucun élément importé'),
        report.imported > 0 ? 'success' : 'error',
      )
      if (report.imported > 0) {
        setSourceItems(null)
        setSourceFile(null)
        setSourceText('')
        setSourceBytes(null)
        setSkipDuplicates(true)
        onImported?.()
      }
    } catch (caught) {
      setSourceError(caught instanceof Error ? caught.message : tt('Import impossible'))
    } finally {
      setSourceBusy(false)
    }
  }

  const importOfflineShare = async () => {
    if (!shareText.trim() || !shareKey.trim() || !activeShareVaultId) return
    setShareBusy(true)
    setShareError(null)
    setShareReport(null)
    try {
      const opened = await openOfflineShare(shareText, shareKey)
      const report = await importItems([
        { ...opened.content, vaultId: activeShareVaultId },
      ])
      setShareReport(
        `${report.imported} élément${report.imported > 1 ? 's' : ''} importé${
          report.imported > 1 ? 's' : ''
        }${report.warnings.length > 0 ? ` · ${report.warnings.join(' ')}` : ''}`,
      )
      toast(tt('Partage importé'), 'success')
      setShareText('')
      setShareKey('')
      onImported?.()
    } catch (caught) {
      setShareError(caught instanceof Error ? caught.message : tt('Import du partage impossible'))
    } finally {
      setShareBusy(false)
    }
  }

  const importKdbx = async () => {
    if (!kdbxFile || !kdbxPassword || !activeKdbxVaultId) return
    setKdbxBusy(true)
    setKdbxError(null)
    setKdbxReport(null)
    try {
      const bytes = new Uint8Array(await kdbxFile.arrayBuffer())
      const keyFile = kdbxKeyFile
        ? new Uint8Array(await kdbxKeyFile.arrayBuffer())
        : undefined
      const result = await readKdbx(
        bytes,
        kdbxPassword,
        activeKdbxVaultId,
        keyFile,
      )
      const report = await importItems(result.items)
      setKdbxReport(
        `${report.imported} élément${report.imported > 1 ? 's' : ''} importé${
          report.imported > 1 ? 's' : ''
        }${result.warnings.length > 0 ? ` · ${result.warnings.join(' ')}` : ''}`,
      )
      toast(tt('Base KDBX importée'), 'success')
      setKdbxFile(null)
      setKdbxKeyFile(null)
      setKdbxPassword('')
      onImported?.()
    } catch (caught) {
      setKdbxError(
        caught instanceof Error ? caught.message : tt('Import KDBX impossible'),
      )
    } finally {
      setKdbxBusy(false)
    }
  }

  const setupPrf = async () => {
    setPrfBusy(true)
    try {
      await enrollPrf()
      toast(tt('Clé de sécurité configurée'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error
          ? caught.message
          : tt('Configuration de la clé de sécurité impossible'),
        'error',
      )
    } finally {
      setPrfBusy(false)
    }
  }

  const revokePrf = async () => {
    setPrfBusy(true)
    try {
      await removePrf()
      toast(tt('Clé de sécurité révoquée'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error
          ? caught.message
          : tt('Révocation de la clé de sécurité impossible'),
        'error',
      )
    } finally {
      setPrfBusy(false)
    }
  }

  const resetBiometric = async () => {
    setBiometricBusy(true)
    try {
      await resetBiometricKey()
      toast(tt('Clé Touch ID réinitialisée'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error
          ? caught.message
          : tt('Réinitialisation Touch ID impossible'),
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
    passkey: activeItems.filter((item) => item.type === 'passkey').length,
    'ssh-key': activeItems.filter((item) => item.type === 'ssh-key').length,
    wifi: activeItems.filter((item) => item.type === 'wifi').length,
    'api-credential': activeItems.filter((item) => item.type === 'api-credential').length,
    'software-license': activeItems.filter((item) => item.type === 'software-license').length,
    document: activeItems.filter((item) => item.type === 'document').length,
  }

  const goToPage = (next: SettingsPage) => {
    setPage(next)
    setMobilePageOpen(true)
  }

  return (
    <>
      <Modal
        title={tt('Réglages')}
        description={tt('Préférences locales, sécurité, sauvegardes et stockage.')}
        size="xl"
        onClose={onClose}
      >
        <div className={`settings ${mobilePageOpen ? 'settings--page-open' : ''}`}>
          <nav className="settings__nav" aria-label={tt('Sections des réglages')}>
            {SETTINGS_PAGES.map((entry) => {
              const Icon = entry.icon
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`settings__nav-item ${
                    page === entry.id ? 'is-active' : ''
                  } ${entry.id === 'danger' ? 'settings__nav-item--danger' : ''}`}
                  aria-current={page === entry.id ? 'page' : undefined}
                  onClick={() => goToPage(entry.id)}
                >
                  <Icon size={16} />
                  {entry.label}
                </button>
              )
            })}
          </nav>

          <div className="settings__content">
            <button
              type="button"
              className="link-button settings__back"
              onClick={() => setMobilePageOpen(false)}
            >
              <ArrowLeft size={15} />
              Toutes les sections
            </button>

            {page === 'templates' && <TemplateSettings />}

            {page === 'activity' && <ActivitySettings />}

            {page === 'general' && (
              <section className="settings__page" aria-labelledby="settings-general">
                <div className="settings__page-head">
                  <div>
                    <h3 id="settings-general">{tt("Général")}</h3>
                    <p>{tt("Ces préférences restent dans ce navigateur.")}</p>
                  </div>
                </div>

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <SlidersHorizontal size={18} />
                    </span>
                    <div>
                      <h3>{tt("Verrouillage et presse-papiers")}</h3>
                      <p>{tt("Quand le coffre se ferme et comment les copies sont effacées.")}</p>
                    </div>
                  </div>

                  <div className="form-grid">
                    <label className="field">
                      <span className="field__label">{tt("Verrouillage automatique")}</span>
                      <select
                        className="input"
                        value={settings.autoLockMinutes}
                        onChange={(event) =>
                          updateSettings({ autoLockMinutes: Number(event.target.value) })
                        }
                      >
                        <option value={0}>{tt("Jamais")}</option>
                        <option value={1}>{tt("Après 1 minute")}</option>
                        <option value={5}>{tt("Après 5 minutes")}</option>
                        <option value={15}>{tt("Après 15 minutes")}</option>
                        <option value={30}>{tt("Après 30 minutes")}</option>
                        <option value={60}>{tt("Après 1 heure")}</option>
                      </select>
                    </label>

                    <label className="field">
                      <span className="field__label">{tt("Effacement du presse-papiers")}</span>
                      <select
                        className="input"
                        value={settings.clipboardClearSeconds}
                        onChange={(event) =>
                          updateSettings({
                            clipboardClearSeconds: Number(event.target.value),
                          })
                        }
                      >
                        <option value={0}>{tt("Jamais")}</option>
                        <option value={15}>{tt("Après 15 secondes")}</option>
                        <option value={30}>{tt("Après 30 secondes")}</option>
                        <option value={60}>{tt("Après 1 minute")}</option>
                        <option value={120}>{tt("Après 2 minutes")}</option>
                      </select>
                    </label>

                    <label className="field field--full">
                      <span className="field__label">{tt("Conservation de la corbeille")}</span>
                      <select
                        className="input"
                        value={settings.trashRetentionDays}
                        onChange={(event) =>
                          updateSettings({
                            trashRetentionDays: Number(event.target.value),
                          })
                        }
                      >
                        <option value={0}>{tt("Jamais purger automatiquement")}</option>
                        <option value={7}>{tt("Après 7 jours")}</option>
                        <option value={30}>{tt("Après 30 jours")}</option>
                        <option value={90}>{tt("Après 90 jours")}</option>
                        <option value={365}>{tt("Après 1 an")}</option>
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
                    <span>{tt("Verrouiller lorsque l’onglet passe en arrière-plan")}</span>
                  </label>
                  <details className="settings-help">
                    <summary>{tt("En savoir plus")}</summary>
                    <p>
                      Recommandé : dès que Coffre n’est plus visible, les clés sont effacées
                      de la mémoire. Ce verrouillage s’applique même si le délai
                      d’inactivité est désactivé.
                    </p>
                  </details>

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
                        <span>{tt("Verrouiller lorsque la fenêtre perd le focus")}</span>
                      </label>
                      <details className="settings-help">
                        <summary>{tt("En savoir plus")}</summary>
                        <p>
                          Utile sur desktop : cliquer dans une autre application verrouille
                          le coffre. Laissez désactivé si vous utilisez souvent des dialogues
                          système.
                        </p>
                      </details>
                    </>
                  )}

                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={settings.expiryNotifications}
                      onChange={(event) =>
                        void toggleExpiryNotifications(event.target.checked)
                      }
                    />
                    <span>{tt("Recevoir un rappel pour les échéances proches")}</span>
                  </label>
                </section>

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <Languages size={18} />
                    </span>
                    <div>
                      <h3>{tt("Langue")}</h3>
                      <p>{tt("Langue de l’interface et des dates.")}</p>
                    </div>
                  </div>
                  <label className="field field--full">
                    <span className="field__label">{tt("Langue")}</span>
                    <select
                      className="input"
                      value={settings.language}
                      onChange={(event) =>
                        updateSettings({ language: event.target.value as Locale })
                      }
                    >
                      {LOCALES.map((locale) => (
                        <option key={locale.id} value={locale.id}>
                          {locale.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <SlidersHorizontal size={18} />
                    </span>
                    <div>
                      <h3>{tt("Apparence")}</h3>
                      <p>{tt("Thème sombre, clair ou aligné sur le système.")}</p>
                    </div>
                  </div>
                  <label className="field field--full">
                    <span className="field__label">{tt("Apparence")}</span>
                    <select
                      className="input"
                      value={settings.theme}
                      onChange={(event) =>
                        updateSettings({ theme: event.target.value as ThemePreference })
                      }
                    >
                      <option value="dark">{tt("Sombre")}</option>
                      <option value="light">{tt("Clair")}</option>
                      <option value="system">{tt("Suivre le système")}</option>
                    </select>
                  </label>
                </section>

                <p className="settings__about">
                  Coffre v{__APP_VERSION__} · GPL-3.0 · format de coffre v{file?.version ?? '—'}.
                  Aucune donnée n’est transmise. Le modèle de sécurité est décrit dans{' '}
                  <code>docs/SECURITY.md</code>.
                </p>
              </section>
            )}

            {page === 'sync' && <SyncSettings />}

            {page === 'security' && (
              <section className="settings__page" aria-labelledby="settings-security">
                <div className="settings__page-head">
                  <div>
                    <h3 id="settings-security">{tt("Sécurité")}</h3>
                    <p>{tt("Mot de passe maître, récupération et trousseau du système.")}</p>
                  </div>
                </div>

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <KeyRound size={18} />
                    </span>
                    <div>
                      <h3>{tt("Mot de passe maître")}</h3>
                      <p>
                        Le changer ré-enveloppe les clés de coffre, sans réchiffrer les
                        éléments.
                      </p>
                    </div>
                  </div>

                  <div className="form-grid">
                    <label className="field field--full">
                      <span className="field__label">{tt("Mot de passe actuel")}</span>
                      <input
                        className="input"
                        type="password"
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        autoComplete="current-password"
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">{tt("Nouveau mot de passe")}</span>
                      <input
                        className="input"
                        type="password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        autoComplete="new-password"
                        placeholder={tt('12 caractères minimum')}
                      />
                      {newPassword && <PasswordStrength entropy={entropy} showEntropy />}
                    </label>
                    <label className="field">
                      <span className="field__label">{tt("Confirmer")}</span>
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
                        <strong>Argon2id</strong> ·{' '}
                        {Math.round(file.kdf.memoryKiB / 1024)} Mio · {file.kdf.iterations}{' '}
                        itérations · {file.kdf.parallelism} threads
                      </span>
                      <small>{tt("Sel unique par coffre, clé AES de 256 bits.")}</small>
                    </div>
                  )}
                </section>

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <KeyRound size={18} />
                    </span>
                    <div>
                      <h3>{tt("Phrase de récupération")}</h3>
                      <p>{tt("Une seconde clé optionnelle, jamais stockée en clair.")}</p>
                    </div>
                  </div>

                  {file?.recovery ? (
                    <p className="settings-copy">
                      <ShieldCheck size={15} /> Phrase configurée le{' '}
                      <strong>{formatDateTime(file.recovery.createdAt)}</strong>. Elle permet
                      de choisir un nouveau mot de passe maître en cas d’oubli.
                    </p>
                  ) : (
                    <p className="settings-copy">
                      Aucune phrase n’est configurée. Sans elle, perdre le mot de passe
                      maître revient à perdre les données.
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
                      <FileKey2 size={18} />
                    </span>
                    <div>
                      <h3>{tt("Kit d’urgence")}</h3>
                      <p>{tt("Parts imprimables de la clé de récupération, avec QR codes.")}</p>
                    </div>
                  </div>

                  <p className="settings-copy">
                    Document papier avec des parts Shamir de la clé de récupération.
                  </p>
                  <details className="settings-help">
                    <summary>{tt("En savoir plus")}</summary>
                    <p>
                      Par exemple, trois parts sur cinq sont nécessaires : confiez-les à des
                      personnes différentes. Chaque part seule ne révèle rien, et les parts
                      ne remplacent pas une sauvegarde du fichier <code>.coffre</code>.
                    </p>
                  </details>

                  <div className="settings-actions settings-actions--start">
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => setShowEmergencyKit(true)}
                      disabled={!file?.recovery}
                    >
                      <FileKey2 size={16} />
                      Créer le kit d’urgence
                    </button>
                  </div>
                  {!file?.recovery && (
                    <p className="field__hint">
                      Configurez d’abord une phrase de récupération.
                    </p>
                  )}
                </section>

                {keychainAvailable() && (
                  <section className="settings-section">
                    <div className="settings-section__head">
                      <span className="settings-section__icon">
                        <Fingerprint size={18} />
                      </span>
                      <div>
                        <h3>{tt("Trousseau du système")}</h3>
                        <p>{tt("Déverrouillage rapide par le trousseau de l’appareil.")}</p>
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
                          <span>{tt("Déverrouiller avec Touch ID (empreinte)")}</span>
                        </label>
                        <details className="settings-help">
                          <summary>{tt("En savoir plus")}</summary>
                          <p>
                            La clé maîtresse est rangée dans un trousseau biométrique séparé
                            et n’est libérée qu’après une authentification réussie. La clé
                            reste en place pendant le verrouillage pour permettre le
                            déverrouillage rapide, puis elle est supprimée si l’option est
                            désactivée ou le coffre réinitialisé.
                          </p>
                        </details>
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
                              {biometricBusy
                                ? 'Réinitialisation…'
                                : 'Réinitialiser Touch ID'}
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
                    <details className="settings-help">
                      <summary>{tt("En savoir plus")}</summary>
                      <p>
                        La clé est conservée hors du coffre, protégée par votre session
                        système, puis supprimée dès que le coffre est verrouillé. Le
                        déverrouillage rapide s’applique donc après un rechargement ou un
                        redémarrage de l’application.
                      </p>
                    </details>
                  </section>
                )}

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <KeyRound size={18} />
                    </span>
                    <div>
                      <h3>{tt('Clé de sécurité FIDO2')}</h3>
                      <p>{tt('Déverrouillage par FIDO2/PRF, sans mot de passe.')}</p>
                    </div>
                  </div>

                  {file?.prf ? (
                    <p className="settings-copy">
                      Clé configurée le{' '}
                      <strong>{formatDateTime(file.prf.createdAt)}</strong>. Le
                      mot de passe maître reste requis après tout changement de
                      clé ou de fichier.
                    </p>
                  ) : (
                    <p className="settings-copy">
                      Configurez une clé compatible PRF (YubiKey 5, clé de
                      plateforme récente) pour déverrouiller ce coffre sans
                      saisir le mot de passe.
                    </p>
                  )}

                  <div className="settings-actions settings-actions--start">
                    {file?.prf ? (
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => void revokePrf()}
                        disabled={prfBusy}
                      >
                        {prfBusy ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                        {prfBusy ? tt('Révocation…') : tt('Révoquer la clé')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => void setupPrf()}
                        disabled={prfBusy || !prfSupported()}
                      >
                        {prfBusy ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <KeyRound size={16} />
                        )}
                        {prfBusy ? tt('Configuration…') : tt('Configurer une clé')}
                      </button>
                    )}
                  </div>
                  <details className="settings-help">
                    <summary>{tt('En savoir plus')}</summary>
                    <p>
                      {tt(
                        'La sortie PRF de la clé dérive une KEK qui scelle la clé maîtresse dans le fichier. Le mot de passe maître reste le secret racine ; l’enveloppe est révocable et supprimée lors d’un changement de mot de passe ou d’une récupération.',
                      )}
                    </p>
                  </details>
                </section>

                <SshAgentSettings />

                <SharingSettings />

                <EmergencyAccessSettings />

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <ShieldAlert size={18} />
                    </span>
                    <div>
                      <h3>{tt("Fuites connues")}</h3>
                      <p>{tt("Surveillance optionnelle en k-anonymat.")}</p>
                    </div>
                  </div>

                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={settings.breachCheck}
                      onChange={(event) =>
                        updateSettings({ breachCheck: event.target.checked })
                      }
                    />
                    <span>
                      {tt(
                        "Vérifier mes mots de passe dans les fuites connues (Have I Been Pwned)",
                      )}
                    </span>
                  </label>
                  <details className="settings-help">
                    <summary>{tt("En savoir plus")}</summary>
                    <p>
                      Le mot de passe est haché localement en SHA-1 ; seuls les 5
                      premiers caractères hexadécimaux sont envoyés à
                      api.pwnedpasswords.com avec l’en-tête <code>Add-Padding</code>.
                      Le hash complet et le mot de passe ne quittent jamais
                      l’appareil. Aucun résultat n’est persisté : ils disparaissent au
                      rechargement.
                      Sur desktop, la requête passe par une commande Rust ; sur le
                      Web, cet hôte est le seul ajouté à la CSP.
                    </p>
                  </details>
                  <p className="field__hint">
                    Désactivé par défaut. La vérification ne démarre que lorsque
                    vous la lancez depuis le tableau de bord Sécurité.
                  </p>
                </section>
              </section>
            )}

            {page === 'backup' && (
              <section className="settings__page" aria-labelledby="settings-backup">
                <div className="settings__page-head">
                  <div>
                    <h3 id="settings-backup">{tt("Sauvegarde et import")}</h3>
                    <p>{tt("Exports chiffrés, exports CSV et imports depuis d’autres outils.")}</p>
                  </div>
                </div>

                <BackupSettings />

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <FileKey2 size={18} />
                    </span>
                    <div>
                      <h3>{tt("Exporter le coffre")}</h3>
                      <p>{tt("Le fichier .coffre est chiffré avec votre mot de passe maître.")}</p>
                    </div>
                  </div>

                  <div className="settings-actions settings-actions--start">
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => {
                        try {
                          exportVault()
                          const now = new Date().toISOString()
                          updateSettings({
                            backupLastRunAt: now,
                            backupLastSuccessAt: now,
                            backupLastError: null,
                          })
                          void recordActivity('export', 'Fichier .coffre')
                          toast(tt('Coffre exporté'), 'success')
                        } catch (caught) {
                          toast(
                            caught instanceof Error
                              ? caught.message
                              : tt('Export impossible'),
                            'error',
                          )
                        }
                      }}
                    >
                      <Download size={16} />
                      {tt("Exporter le coffre")}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => setShowKdbxExport(true)}
                    >
                      <FileKey2 size={16} />
                      {tt('Exporter en KDBX')}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => setShowCxfExport(true)}
                    >
                      <FileKey2 size={16} />
                      {tt('Exporter en CXF')}
                    </button>
                  </div>

                  <div className="settings-divider" />

                  <h4 className="settings-subtitle">{tt("Exporter en CSV")}</h4>
                  <p className="settings-copy">
                    Le CSV est un fichier <strong>{tt("en clair")}</strong> : importez-le
                    immédiatement, puis supprimez-le.
                  </p>

                  <label className="field field--full">
                    <span className="field__label">{tt("Format CSV")}</span>
                    <select
                      className="input"
                      value={csvFormat}
                      onChange={(event) =>
                        setCsvFormat(event.target.value as CsvExportFormat)
                      }
                    >
                      <option value="apple">{tt("Mots de passe (Apple) — connexions")}</option>
                      <option value="coffre">{tt("Coffre complet — tous les éléments")}</option>
                    </select>
                  </label>

                  <label className="field field--full">
                    <span className="field__label">{tt("Mot de passe maître")}</span>
                    <input
                      className="input"
                      type="password"
                      autoComplete="current-password"
                      value={csvPassword}
                      onChange={(event) => setCsvPassword(event.target.value)}
                      aria-label={tt("Mot de passe maître pour l’export CSV")}
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
                      {tt("Exporter en CSV")}
                    </button>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <Upload size={18} />
                    </span>
                    <div>
                      <h3>{tt("Importer un coffre")}</h3>
                      <p>{tt("Le fichier importé remplace le coffre stocké dans ce navigateur.")}</p>
                    </div>
                  </div>

                  <div className="form-grid">
                    <label className="file-drop field--full">
                      <input
                        type="file"
                        accept=".coffre,.json,application/json"
                        onChange={(event) =>
                          setImportFile(event.target.files?.[0] ?? null)
                        }
                      />
                      <Upload size={20} />
                      <span>
                        {importFile ? importFile.name : 'Choisir un fichier .coffre'}
                      </span>
                      <small>
                        {importFile
                          ? `${Math.ceil(importFile.size / 1024)} Ko`
                          : 'Le fichier reste sur cet appareil'}
                      </small>
                    </label>

                    <label className="field field--full">
                      <span className="field__label">{tt("Mot de passe du fichier")}</span>
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
                    <span>{tt("Je comprends que le coffre local actuel sera remplacé.")}</span>
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
                      disabled={
                        !importFile || !importPassword || !importAcknowledged || importBusy
                      }
                    >
                      {importBusy ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <Upload size={16} />
                      )}
                      {importBusy ? 'Importation…' : 'Remplacer par ce coffre'}
                    </button>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <FileKey2 size={18} />
                    </span>
                    <div>
                      <h3>{tt('Importer une base KeePass (KDBX 4)')}</h3>
                      <p>{tt('Fichier .kdbx, mot de passe et éventuel fichier de clé.')}</p>
                    </div>
                  </div>

                  <div className="form-grid">
                    <label className="field field--full">
                      <span className="field__label">{tt('Fichier KDBX')}</span>
                      <input
                        className="input"
                        type="file"
                        accept=".kdbx,application/octet-stream"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null
                          if (file && file.size > 100 * 1024 * 1024) {
                            setKdbxError(
                              tt('Fichier trop volumineux (100 Mo maximum)'),
                            )
                            return
                          }
                          setKdbxError(null)
                          setKdbxFile(file)
                        }}
                        disabled={kdbxBusy}
                      />
                    </label>

                    <label className="field field--full">
                      <span className="field__label">{tt('Mot de passe KDBX')}</span>
                      <input
                        className="input"
                        type="password"
                        value={kdbxPassword}
                        onChange={(event) => setKdbxPassword(event.target.value)}
                        autoComplete="off"
                        disabled={kdbxBusy}
                      />
                    </label>

                    <label className="field field--full">
                      <span className="field__label">{tt('Fichier de clé (optionnel)')}</span>
                      <input
                        className="input"
                        type="file"
                        accept=".keyx,.key,application/octet-stream"
                        onChange={(event) =>
                          setKdbxKeyFile(event.target.files?.[0] ?? null)
                        }
                        disabled={kdbxBusy}
                      />
                    </label>

                    <label className="field">
                      <span className="field__label">{tt('Coffre de destination')}</span>
                      <select
                        className="input"
                        value={activeKdbxVaultId}
                        onChange={(event) => setKdbxVaultId(event.target.value)}
                        disabled={kdbxBusy}
                      >
                        {vaults.map((vault) => (
                          <option key={vault.id} value={vault.id}>
                            {vault.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {kdbxError && (
                    <p className="form-error" role="alert">
                      <AlertTriangle size={16} />
                      {kdbxError}
                    </p>
                  )}
                  {kdbxReport && (
                    <div className="import-report" role="status">
                      <p>
                        <Check size={16} />
                        {kdbxReport}
                      </p>
                    </div>
                  )}

                  <div className="settings-actions">
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => void importKdbx()}
                      disabled={
                        kdbxBusy ||
                        !kdbxFile ||
                        !kdbxPassword ||
                        !activeKdbxVaultId
                      }
                    >
                      {kdbxBusy ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <Upload size={16} />
                      )}
                      {kdbxBusy
                        ? tt('Import KDBX en cours…')
                        : tt('Importer la base KDBX')}
                    </button>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <FileSpreadsheet size={18} />
                    </span>
                    <div>
                      <h3>{tt("Importer depuis un autre gestionnaire")}</h3>
                      <p>
                        Bitwarden, Proton Pass, Enpass, 1Password, LastPass, Chrome,
                        Firefox, Safari, Dashlane, KeePass, CXF…
                      </p>
                    </div>
                  </div>

                  <label className="file-drop">
                    <input
                      type="file"
                      accept=".json,.csv,.xml,.1pux,.cxf,application/json,text/csv,application/xml,text/xml"
                      onChange={(event) => {
                        void selectSourceFile(event.target.files?.[0] ?? null)
                        event.target.value = ''
                      }}
                      disabled={sourceBusy}
                    />
                    <Upload size={20} />
                    <span>
                      {sourceFile ? sourceFile.name : 'Choisir un fichier JSON, CSV, XML, CXF ou 1PUX'}
                    </span>
                    <small>{tt("Les éléments sont ajoutés au coffre choisi, puis chiffrés.")}</small>
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
                              : sourceItems.format === 'keepass-xml'
                                ? 'XML KeePass'
                                : sourceItems.format === 'cxf'
                                  ? 'CXF'
                                  : 'JSON'}{' '}
                          {importSourceLabel(sourceItems.source)}
                          {sourcePreview.duplicates.length > 0 &&
                            ` · ${sourcePreview.duplicates.length} doublon${
                              sourcePreview.duplicates.length > 1 ? 's' : ''
                            }`}
                        </span>
                      </div>

                      <label className="field">
                        <span className="field__label">{tt("Coffre de destination")}</span>
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
                            <strong>{tt("Ignorer les doublons.")}</strong>{' '}
                            {sourcePreview.duplicates.length} élément
                            {sourcePreview.duplicates.length > 1 ? 's' : ''} semble
                            {sourcePreview.duplicates.length > 1 ? 'nt' : ''} déjà présent
                            {sourcePreview.duplicates.length > 1 ? 's' : ''} dans le coffre.
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
                      <Share2 size={18} />
                    </span>
                    <div>
                      <h3>{tt("Importer un partage hors ligne")}</h3>
                      <p>{tt("Fichier")} <code>.coffre-share</code> {tt("et clé transmis séparément.")}</p>
                    </div>
                  </div>

                  <p className="settings-copy">
                    Le fichier et la clé sont nécessaires ; les pièces jointes ne sont pas
                    incluses.
                  </p>
                  <details className="settings-help">
                    <summary>{tt("En savoir plus")}</summary>
                    <p>
                      Saisissez la clé en mots ou le contenu du QR code fourni par
                      l’expéditeur. Un partage expiré est refusé.
                    </p>
                  </details>

                  <div className="form-grid">
                    <label className="field field--full">
                      <span className="field__label">{tt("Fichier de partage")}</span>
                      <input
                        className="input"
                        type="file"
                        accept=".coffre-share,application/json"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (!file) return
                          if (file.size > 10 * 1024 * 1024) {
                            setShareError('Fichier trop volumineux (10 Mo maximum)')
                            return
                          }
                          setShareError(null)
                          void file.text().then(setShareText)
                        }}
                        disabled={shareBusy}
                      />
                    </label>

                    <label className="field field--full">
                      <span className="field__label">{tt("Clé de partage")}</span>
                      <textarea
                        className="input input--mono"
                        rows={3}
                        value={shareKey}
                        onChange={(event) => setShareKey(event.target.value)}
                        placeholder={tt('Mots de la clé, ou contenu du QR code')}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={shareBusy}
                      />
                    </label>

                    <label className="field">
                      <span className="field__label">{tt("Coffre de destination")}</span>
                      <select
                        className="input"
                        value={activeShareVaultId}
                        onChange={(event) => setShareVaultId(event.target.value)}
                        disabled={shareBusy}
                      >
                        {vaults.map((vault) => (
                          <option key={vault.id} value={vault.id}>
                            {vault.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {shareError && (
                    <p className="form-error" role="alert">
                      <AlertTriangle size={16} />
                      {shareError}
                    </p>
                  )}
                  {shareReport && (
                    <div className="import-report" role="status">
                      <p>
                        <Check size={16} />
                        {shareReport}
                      </p>
                    </div>
                  )}

                  <div className="settings-actions">
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => void importOfflineShare()}
                      disabled={
                        shareBusy || !shareText.trim() || !shareKey.trim() || !activeShareVaultId
                      }
                    >
                      {shareBusy ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <Upload size={16} />
                      )}
                      Importer le partage
                    </button>
                  </div>
                </section>
              </section>
            )}

            {page === 'storage' && (
              <section className="settings__page" aria-labelledby="settings-storage">
                <div className="settings__page-head">
                  <div>
                    <h3 id="settings-storage">{tt("Stockage")}</h3>
                    <p>{tt("Persistance, intégrité et sauvegardes locales.")}</p>
                  </div>
                </div>

                <BlobStorageSettings />

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <HardDrive size={18} />
                    </span>
                    <div>
                      <h3>
                        {isTauriRuntime()
                          ? 'Stockage natif'
                          : 'Stockage du navigateur'}
                      </h3>
                      <p>
                        {isTauriRuntime()
                          ? 'Trois sauvegardes tournantes et écritures atomiques.'
                          : 'Le navigateur peut conserver ou effacer les données locales.'}
                      </p>
                    </div>
                  </div>

                  {isTauriRuntime() ? (
                    <>
                      <p className="settings-copy">
                        Coffre chiffré dans le dossier de données de l’application.
                      </p>
                      <details className="settings-help">
                        <summary>{tt("En savoir plus")}</summary>
                        <p>
                          Trois sauvegardes tournantes, des écritures atomiques et des
                          permissions réservées à votre compte. Aucune donnée n’est envoyée
                          sur Internet.
                        </p>
                      </details>
                    </>
                  ) : (
                    <>
                      <p className="settings-copy">
                        {persisted === true
                          ? 'Stockage persistant activé : le navigateur s’engage à conserver le coffre.'
                          : persisted === false
                            ? 'Stockage non persistant : le navigateur peut effacer le coffre en cas de manque d’espace.'
                            : 'Ce navigateur ne permet pas de connaître le statut du stockage persistant.'}
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
                      <details className="settings-help">
                        <summary>{tt("En savoir plus")}</summary>
                        <p>
                          Exportez régulièrement une sauvegarde : un nettoyage du
                          navigateur peut supprimer les données locales, même persistantes.
                        </p>
                      </details>
                    </>
                  )}
                </section>

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <ShieldCheck size={18} />
                    </span>
                    <div>
                      <h3>{tt("Intégrité du coffre")}</h3>
                      <p>{tt("Déchiffre et vérifie chaque coffre, élément et pièce jointe.")}</p>
                    </div>
                  </div>

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
                      {pluralize(verifyReport.attachments, 'pièce jointe', 'pièces jointes')}{' '}
                      · {pluralize(verifyReport.versions, 'version')}.
                      {verifyReport.attachments > 0
                        ? ` ${formatBytes(verifyReport.attachmentBytes)} de pièces jointes déchiffrées.`
                        : ''}
                      {verifyReport.signedRecords > 0
                        ? ' MAC global du format 4 vérifié.'
                        : ' Fichier antérieur au format 4 : il sera signé à la prochaine écriture.'}
                    </p>
                  )}
                </section>

                <section className="settings-section">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <HardDrive size={18} />
                    </span>
                    <div>
                      <h3>{tt("Contenu du coffre")}</h3>
                      <p>
                        {vaults.length} coffre{vaults.length > 1 ? 's' : ''} ·{' '}
                        {activeItems.length} élément{activeItems.length > 1 ? 's' : ''} actif
                        {activeItems.length > 1 ? 's' : ''}
                        {trashedItems.length > 0
                          ? ` · ${trashedItems.length} dans la corbeille`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="stat-grid">
                    {(['login', 'card', 'note', 'identity', 'passkey', 'ssh-key', 'wifi', 'api-credential', 'software-license', 'document'] as const).map(
                      (type) => (
                        <div key={type} className="stat">
                          <strong>{counts[type]}</strong>
                          <span>{itemTypeLabel(type)}</span>
                        </div>
                      ),
                    )}
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
                      Dernière écriture locale : {formatDateTime(file.updatedAt)}. Trois
                      sauvegardes locales tournantes sont conservées.
                    </p>
                  )}
                </section>
              </section>
            )}

            {page === 'danger' && (
              <section className="settings__page" aria-labelledby="settings-danger">
                <div className="settings__page-head">
                  <div>
                    <h3 id="settings-danger">{tt("Zone dangereuse")}</h3>
                    <p>{tt("Actions irréversibles sur le coffre local.")}</p>
                  </div>
                </div>

                <section className="settings-section settings-section--danger">
                  <div className="settings-section__head">
                    <span className="settings-section__icon">
                      <Trash2 size={18} />
                    </span>
                    <div>
                      <h3>{tt("Effacer le coffre local")}</h3>
                      <p>
                        Supprime définitivement le coffre et sa sauvegarde de ce navigateur.
                      </p>
                    </div>
                  </div>
                  <div className="settings-actions settings-actions--start">
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => setShowReset(true)}
                    >
                      <Trash2 size={16} />
                      Effacer le coffre local…
                    </button>
                  </div>
                </section>
              </section>
            )}
          </div>
        </div>
      </Modal>

      {showReset && (
        <ConfirmDialog
          title={tt('Effacer tout le coffre ?')}
          description={tt(
            'Tous les coffres et éléments stockés dans ce navigateur seront supprimés. Cette action est définitive.',
          )}
          confirmLabel={tt('Effacer définitivement')}
          requireText="EFFACER"
          onClose={() => setShowReset(false)}
          onConfirm={resetVault}
        />
      )}

      {showEmptyTrash && (
        <ConfirmDialog
          title={tt('Vider la corbeille ?')}
          description={`${trashedItems.length} élément${
            trashedItems.length > 1 ? 's' : ''
          }, leurs pièces jointes et leur historique seront définitivement supprimés. Cette action est irréversible.`}
          confirmLabel={tt('Vider définitivement')}
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
      {showEmergencyKit && (
        <EmergencyKitDialog onClose={() => setShowEmergencyKit(false)} />
      )}
      {showKdbxExport && (
        <KdbxExportDialog
          items={items}
          vaults={vaults}
          onClose={() => setShowKdbxExport(false)}
        />
      )}
      {showCxfExport && (
        <CxfExportDialog items={items} onClose={() => setShowCxfExport(false)} />
      )}
    </>
  )
}
