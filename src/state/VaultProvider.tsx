import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  clearVaultStorage,
  loadBackupVaultFile,
  loadVaultFile,
  loadVaultState,
  overwriteVaultBackups,
  saveVaultFile,
  saveVaultState,
} from '../lib/storage'
import {
  addAttachment as addAttachmentToFile,
  addSharedVault,
  readVaultSharing,
  rotateVaultKey,
  setVaultSharingMembers,
  addVault as addVaultToFile,
  appendActivity,
  deleteAliasKey as deleteAliasKeyInFile,
  setAliasKey as setAliasKeyInFile,
  changeMasterPassword,
  checkVaultRollback,
  createItem,
  createTemplate as createTemplateInFile,
  createVaultFile,
  deleteTemplate as deleteTemplateInFile,
  deleteItem,
  deleteItems,
  deleteVault as deleteVaultFromFile,
  disableRecovery,
  enableRecovery,
  listItemVersions,
  moveItem as moveItemInFile,
  openAttachment,
  openVaultFileWithMasterKey,
  parseVaultFileText,
  recoverVaultFile,
  recoverVaultFileWithRecoveryKey,
  removeAttachment as removeAttachmentFromFile,
  renameVault as renameVaultInFile,
  restoreItem as restoreItemFromFile,
  restoreItemVersion as restoreItemVersionInFile,
  serializeVault,
  signVaultFile,
  trashItem as trashItemInFile,
  unlockVaultFile,
  updateItem as updateItemInFile,
  updateTemplate as updateTemplateInFile,
  vaultFileName,
  verifyVaultFile,
  VaultValidationError,
  type ItemVersion,
  type OpenedVault,
  type VaultIntegrityReport,
  type VaultSession,
} from '../lib/vault'
import { deriveMasterKey, fromBase64, randomBytes, toBase64, wipe } from '../lib/crypto'
import { deleteVaultKey, loadVaultKey, storeVaultKey } from '../lib/keychain'
import {
  deleteBiometricKey,
  loadBiometricKey,
  storeBiometricKey,
} from '../lib/biometrics'
import { clearUsage } from '../lib/usage'
import {
  combineShares,
  encodeShareWords,
  parseShareInput,
  shareToPayload,
  splitSecret,
  type RecoveryShare,
} from '../lib/shamir'
import { clearClipboardIfLastCopied } from '../lib/clipboard'
import {
  exportBlobsToDirectory,
  importBlobsFromDirectory,
  referencedBlobIds,
} from '../lib/blobStore'
import {
  clearTravelMode,
  getTravelMode,
  setTravelMode,
  stripVaultForTravel,
} from '../lib/travelMode'
import {
  enrollPrf as createPrfEnrollment,
  getPrfOutput,
  openPrfEnvelope,
} from '../lib/prf'
import {
  createSharingIdentity as makeSharingIdentity,
  openSharingIdentity,
} from '../lib/sharingVault'
import {
  parsePublicSharingIdentity,
  publicSharingIdentity,
  type ShareMember,
  type SharingIdentity,
} from '../lib/sharing'
import {
  createEmergencyRecord,
  createShamirEmergencyRecord,
} from '../lib/emergencyVault'
import {
  createSharedVaultPackage,
  openSharedVaultPackage,
  parseSharedVaultPackage,
  type SharedVaultPackage,
} from '../lib/sharingPackage'
import {
  createSharedVaultBundle,
  importSharedVaultBundle,
  parseSharedVaultBundle,
  signSharedVaultBundle,
  type SharedVaultBundle,
} from '../lib/sharedVaultBundle'
import {
  syncSharedVault as syncSharedVaultContent,
  type SharedSyncReport,
} from '../lib/sharedSync'
import {
  configureDesktopSharedSync,
  configureWebSharedSync,
  disableSharedSync as disableSharedSyncConfig,
  openSharedSyncIO,
} from '../lib/sharedSyncStorage'
import {
  getSharedSyncConfig,
  listSharedSyncConfigs,
  saveSharedSyncConfig,
  type SharedSyncConfig,
} from '../lib/sharedSyncConfig'
import { BRIDGE_KEYCHAIN_ACCOUNT } from '../lib/bridgeProtocol'
import { isTauriRuntime } from '../lib/external'
import {
  getSyncConfig,
  newSyncDeviceId,
  removeSyncConfig,
  saveSyncConfig,
  syncDeviceFileName,
  type SyncConfig,
} from '../lib/syncConfig'
import {
  listSyncFiles,
  onSyncFolderChanged,
  prepareSyncFolder,
  readSyncFile,
  unwatchSyncFolder,
  watchSyncFolder,
  writeSyncFile,
  type SyncFileInfo,
} from '../lib/syncStorage'
import {
  clearWebSyncHandle,
  ensureWebSyncPermission,
  listWebSyncFiles,
  loadWebSyncHandle,
  prepareWebSyncDirectory,
  readWebSyncFile,
  saveWebSyncHandle,
  writeWebSyncFile,
} from '../lib/syncWebStorage'
import { reconcileVaultFiles } from '../lib/syncService'
import { acquireVaultLock, releaseVaultLock } from '../lib/tabLock'
import { downloadBytes, downloadFile } from '../lib/settings'
import {
  MAX_ATTACHMENT_BYTES,
  type ItemDraft,
  type VaultFile,
  type ActivityEvent,
  type EmergencyAccessRecord,
  type ActivityKind,
  type AliasKeyService,
  type ItemTemplate,
  type VaultItem,
  type VaultStatus,
  type VaultSummary,
} from '../lib/types'
import { useSettings } from './SettingsProvider'

export interface ImportResult {
  imported: number
  warnings: string[]
}

export interface SyncRunResult {
  conflicts: number
  warnings: string[]
  adoptedEpoch: number | null
}

interface ProviderState {
  status: VaultStatus
  file: VaultFile | null
  session: VaultSession | null
  vaults: VaultSummary[]
  items: VaultItem[]
  templates: ItemTemplate[]
  activity: ActivityEvent[]
  aliasKeys: Partial<Record<AliasKeyService, string>>
  warnings: string[]
  error: string | null
  /** MAC global invalide : toutes les mutations sont refusées. */
  readOnly: boolean
  /** Un fichier du dossier synchronisé a changé depuis la dernière fusion. */
  syncPending: boolean
  /** Incrémenté après configuration, suppression ou synchronisation. */
  syncRevision: number
}

interface VaultContextValue extends ProviderState {
  create: (password: string, vaultName?: string) => Promise<void>
  unlock: (password: string) => Promise<void>
  /** Déverrouille après une authentification Touch ID ; false si annulée. */
  unlockWithBiometrics: () => Promise<boolean>
  /** Déverrouille avec la clé de sécurité FIDO2/PRF configurée. */
  unlockWithPrf: () => Promise<boolean>
  /** Enrôle une clé FIDO2/PRF pour le coffre courant. */
  enrollPrf: () => Promise<void>
  /** Révoque l’enveloppe PRF du coffre courant. */
  removePrf: () => Promise<void>
  /** Lit l’identité de partage du fichier, si elle existe. */
  getSharingIdentity: () => Promise<SharingIdentity | null>
  /** Crée l’identité de partage du fichier si nécessaire. */
  createSharingIdentity: () => Promise<SharingIdentity>
  /** Génère un paquet signé pour des identités publiques. */
  createSharingPackage: (
    vaultId: string,
    memberIdentities: string[],
  ) => Promise<SharedVaultPackage>
  /** Génère un paquet contenant la clé et le contenu chiffré. */
  createSharingBundle: (
    vaultId: string,
    memberIdentities: string[],
  ) => Promise<SharedVaultBundle>
  /** Importe un coffre partagé (clé seule ou contenu complet). */
  importSharingPackage: (packageText: string, vaultName: string) => Promise<void>
  /** Liste les membres connus d’un coffre partagé. */
  getVaultSharing: (vaultId: string) => Promise<{
    members: import('../lib/types').VaultSharingMember[]
    adminFingerprint?: string
    package?: SharedVaultPackage
  }>
  /** Configure la synchronisation par dossier d’un coffre partagé. */
  configureSharedFolder: (vaultId: string, dir: string) => Promise<void>
  /** Configure la synchronisation Web via un dossier choisi. */
  configureWebSharedFolder: (
    vaultId: string,
    handle: FileSystemDirectoryHandle,
  ) => Promise<void>
  /** Désactive la synchronisation d’un coffre partagé. */
  disableSharedSync: (vaultId: string) => Promise<void>
  /** Synchronise un coffre partagé avec son dossier. */
  syncSharedVault: (vaultId: string) => Promise<SharedSyncReport>
  /** État local de synchronisation d’un coffre partagé. */
  getSharedSyncStatus: (vaultId: string) => SharedSyncConfig | null
  /** Révoque un membre et renvoie le nouveau paquet pour les restants. */
  revokeSharingMember: (
    vaultId: string,
    memberFingerprint: string,
  ) => Promise<SharedVaultPackage>
  /** Lit l’enveloppe d’accès d’urgence du fichier. */
  getEmergencyAccess: () => EmergencyAccessRecord | null
  /** Crée ou remplace l’enveloppe d’accès d’urgence. */
  createEmergencyAccess: (contactText: string) => Promise<void>
  /** Crée un accès d’urgence Shamir pour plusieurs contacts. */
  createShamirEmergencyAccess: (
    contactTexts: string[],
    threshold?: number,
  ) => Promise<void>
  /** Supprime l’enveloppe d’accès d’urgence. */
  removeEmergencyAccess: () => Promise<void>
  /** Supprime puis réenregistre la clé biométrique du coffre courant. */
  resetBiometricKey: () => Promise<void>
  lock: () => void
  addVault: (name: string) => Promise<void>
  renameVault: (vaultId: string, name: string) => Promise<void>
  deleteVault: (vaultId: string) => Promise<void>
  createTemplate: (input: {
    name: string
    icon?: string
    fields: import('../lib/types').TemplateField[]
  }) => Promise<ItemTemplate>
  updateTemplate: (
    templateId: string,
    input: {
      name: string
      icon?: string
      fields: import('../lib/types').TemplateField[]
    },
  ) => Promise<ItemTemplate>
  deleteTemplate: (templateId: string) => Promise<void>
  /** Active le mode voyage : retire les coffres non sûrs du fichier local. */
  enableTravelMode: (safeVaultIds: string[], password: string) => Promise<void>
  /** Restaure les coffres masqués depuis la synchronisation par dossier. */
  disableTravelMode: (password: string, remotePassword?: string) => Promise<SyncRunResult>
  addItem: (draft: ItemDraft) => Promise<VaultItem>
  updateItem: (item: VaultItem) => Promise<VaultItem>
  moveItem: (itemId: string, targetVaultId: string) => Promise<VaultItem>
  trashItem: (itemId: string) => Promise<VaultItem>
  trashItems: (itemIds: string[]) => Promise<number>
  favoriteItems: (itemIds: string[], favorite: boolean) => Promise<number>
  restoreItem: (itemId: string) => Promise<VaultItem>
  deleteItemPermanently: (itemId: string) => Promise<void>
  emptyTrash: () => Promise<number>
  getItemVersions: (itemId: string) => Promise<ItemVersion[]>
  restoreItemVersion: (itemId: string, versionId: string) => Promise<VaultItem>
  addAttachment: (item: VaultItem, file: File) => Promise<VaultItem>
  removeAttachment: (item: VaultItem, attachmentId: string) => Promise<VaultItem>
  downloadAttachment: (item: VaultItem, attachmentId: string) => Promise<void>
  importItems: (drafts: ItemDraft[]) => Promise<ImportResult>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  setRecoveryPhrase: (phrase: string | null) => Promise<void>
  recoverWithPhrase: (phrase: string, newPassword: string) => Promise<void>
  /** Découpe la clé de récupération en parts Shamir, sans exposer la clé. */
  createRecoveryShares: (threshold: number, total: number) => Promise<RecoveryShare[]>
  /** Reconstruit la clé depuis des parts et impose un nouveau mot de passe. */
  recoverWithShares: (shares: string[], newPassword: string) => Promise<void>
  exportVault: () => void
  importVault: (text: string, password: string) => Promise<void>
  verify: () => Promise<VaultIntegrityReport>
  reset: () => Promise<void>
  restoreFromBackup: (password: string, generation?: number) => Promise<void>
  configureSync: (baseDir: string) => Promise<SyncConfig>
  configureWebSync: (
    handle: FileSystemDirectoryHandle,
  ) => Promise<SyncConfig>
  disableSync: () => Promise<void>
  syncNow: (password?: string) => Promise<SyncRunResult>
  /** Fusionne un fichier reçu par synchronisation locale (F2). */
  lanSync: (remoteText: string, password?: string) => Promise<SyncRunResult>
  /** Vrai si `password` est le mot de passe maître de la session ouverte. */
  confirmMasterPassword: (password: string) => Promise<boolean>
  /** Ajoute un événement au journal d’activité chiffré. */
  recordActivity: (
    kind: ActivityKind,
    detail: string,
    host?: string,
  ) => Promise<void>
  /** Vérifie une sauvegarde en lecture seule, sans toucher au coffre courant. */
  verifyBackup: (
    contents: string,
    password?: string,
  ) => Promise<{
    items: number
    vaults: number
    currentItems: number
    integrity: 'valid' | 'unsigned' | 'invalid'
  }>
  setAliasKey: (service: AliasKeyService, key: string) => Promise<void>
  deleteAliasKey: (service: AliasKeyService) => Promise<void>
  dismissWarnings: () => void
}

const initialState: ProviderState = {
  status: 'loading',
  file: null,
  session: null,
  vaults: [],
  items: [],
  templates: [],
  activity: [],
  aliasKeys: {},
  warnings: [],
  error: null,
  readOnly: false,
  syncPending: false,
  syncRevision: 0,
}

const VaultContext = createContext<VaultContextValue | null>(null)

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Une erreur inattendue est survenue'
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}

/** Éléments de la corbeille dont la date de suppression dépasse la rétention. */
function expiredTrashIds(items: VaultItem[], retentionDays: number): string[] {
  if (retentionDays <= 0) return []
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  return items
    .filter((item) => {
      if (!item.deletedAt) return false
      const deletedAt = Date.parse(item.deletedAt)
      return !Number.isNaN(deletedAt) && deletedAt <= cutoff
    })
    .map((item) => item.id)
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const settingsRef = useRef(settings)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const [state, setState] = useState<ProviderState>(initialState)
  const stateRef = useRef<ProviderState>(initialState)
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const epochRef = useRef(0)
  /** Révision minimale connue pour le fichier courant (anti-retour). */
  const revisionFloorRef = useRef(0)
  /** Ignore les événements de notre propre écriture dans le dossier synchronisé. */
  const syncIgnoreUntilRef = useRef(0)
  // Identifiant du coffre dont la clé biométrique est déjà rangée. Évite de
  // réécrire l’entrée du trousseau à chaque déverrouillage, ce qui redéclenche
  // l’autorisation d’accès macOS.
  const biometricKeyFileRef = useRef<string | null>(null)
  /**
   * Session qui vient d’être verrouillée alors qu’une écriture était en cours.
   * Ses clés restent en mémoire le temps que les tâches déjà en file se
   * terminent, pour que la modification soit signée et enregistrée au lieu
   * d’être perdue ; elles sont effacées juste après.
   */
  const drainingRef = useRef<{ session: VaultSession; readOnly: boolean } | null>(null)

  const apply = useCallback((updater: (previous: ProviderState) => ProviderState) => {
    const next = updater(stateRef.current)
    stateRef.current = next
    setState(next)
  }, [])

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const result = queueRef.current.then(task, task)
    queueRef.current = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }, [])

  /** Enregistre la plus haute révision vue. Un échec ne bloque pas l’usage. */
  const acceptRevision = useCallback(
    async (
      file: VaultFile,
      options: { lower?: boolean } = {},
    ): Promise<void> => {
      if (file.version !== 4 || file.revision === undefined) return
      const revision = options.lower
        ? file.revision
        : Math.max(file.revision, revisionFloorRef.current)
      revisionFloorRef.current = revision
      try {
        await saveVaultState({
          fileId: file.id,
          revision,
          updatedAt: file.updatedAt,
        })
      } catch (error) {
        console.warn(
          'Coffre : impossible d’enregistrer l’état anti-retour en arrière.',
          error,
        )
      }
    },
    [],
  )

  const persistWithSession = useCallback(
    async (
      session: VaultSession,
      base: VaultFile,
      next: VaultFile,
    ): Promise<VaultFile> => {
      const signed = await signVaultFile(next, session, base, {
        minimumRevision: revisionFloorRef.current,
      })
      // Écriture contrôlée : refusée si le fichier enregistré n’est plus
      // `base`, c’est-à-dire si un autre onglet l’a modifié entre-temps.
      await saveVaultFile(signed, { expected: base })
      await acceptRevision(signed)
      return signed
    },
    [acceptRevision],
  )

  /**
   * Signe et écrit une mutation contrôlée. Toute écriture de l’application
   * passe par ici : révision, horloges, pierres tombales et MAC sont calculés
   * sur `next` à partir de `base`, puis l’état local est mis à jour.
   */
  const persist = useCallback(
    async (base: VaultFile, next: VaultFile): Promise<VaultFile> => {
      const current = stateRef.current
      // Verrouillé pendant cette mutation : on termine l’écriture avec la
      // session encore en cours d’effacement (voir `lockWith`).
      const draining = current.session ? null : drainingRef.current
      const readOnly = draining ? draining.readOnly : current.readOnly
      if (readOnly) {
        throw new Error(
          'Le coffre est ouvert en lecture seule : l’intégrité du fichier n’a pas pu être vérifiée.',
        )
      }
      const session = current.session ?? draining?.session
      if (!session || session.locked) throw new Error('Coffre verrouillé')
      return persistWithSession(session, base, next)
    },
    [persistWithSession],
  )

  /**
   * Purge les éléments dont la date de suppression dépasse la rétention
   * configurée. Si l’écriture échoue, le coffre reste ouvrable : on conserve
   * simplement la corbeille et on ajoute un avertissement.
   */
  const applyTrashRetention = useCallback(async (opened: OpenedVault): Promise<OpenedVault> => {
    if (opened.readOnly) return opened
    const expired = expiredTrashIds(opened.items, settingsRef.current.trashRetentionDays)
    if (expired.length === 0) return opened

    try {
      const next = deleteItems(opened.file, expired)
      const file = await signVaultFile(next, opened.session, opened.file, {
        minimumRevision: revisionFloorRef.current,
      })
      await saveVaultFile(file)
      const removed = new Set(expired)
      return {
        ...opened,
        file,
        items: opened.items.filter((item) => !removed.has(item.id)),
        warnings: [
          ...opened.warnings,
          `${expired.length} élément${expired.length > 1 ? 's' : ''} de la corbeille a${
            expired.length > 1 ? 'ont' : ''
          } été supprimé${expired.length > 1 ? 's' : ''} définitivement après la période de rétention.`,
        ],
      }
    } catch {
      return {
        ...opened,
        warnings: [
          ...opened.warnings,
          'La purge automatique de la corbeille a échoué ; les éléments ont été conservés.',
        ],
      }
    }
  }, [])

  /**
   * Contrôle anti-retour en arrière puis purge de la corbeille. Une
   * restauration volontaire (`acceptRollback`) ne déclenche pas d’alerte et
   * abaisse explicitement la révision de référence.
   */
  const finalizeOpen = useCallback(
    async (
      opened: OpenedVault,
      options: { acceptRollback?: boolean } = {},
    ): Promise<OpenedVault> => {
      const state = await loadVaultState().catch(() => null)
      revisionFloorRef.current =
        state && state.fileId === opened.file.id ? state.revision : 0
      const rollback = options.acceptRollback
        ? null
        : checkVaultRollback(opened.file, state)
      if (options.acceptRollback && opened.file.version === 4) {
        revisionFloorRef.current = opened.file.revision ?? 0
      }
      let next = rollback
        ? { ...opened, warnings: [rollback, ...opened.warnings] }
        : opened
      if (!rollback) next = await applyTrashRetention(next)
      if (next.integrity !== 'invalid' && (!rollback || options.acceptRollback)) {
        await acceptRevision(next.file, { lower: options.acceptRollback })
      }
      return next
    },
    [acceptRevision, applyTrashRetention],
  )

  /**
   * Écrit un fichier ouvert hors du flux de mutation (import, récupération,
   * restauration). Un fichier v4 déjà signé est conservé tel quel pour que la
   * restauration puisse reculer volontairement de révision ; un fichier
   * antérieur est migré et signé.
   */
  const saveOpenedFile = useCallback(
    async (opened: OpenedVault): Promise<OpenedVault> => {
      if (opened.readOnly) {
        throw new Error(
          'Le fichier importé n’a pas pu être authentifié : il est refusé.',
        )
      }
      const file =
        opened.file.version === 4 && opened.file.integrity
          ? opened.file
          : await signVaultFile(opened.file, opened.session, opened.file, {
              minimumRevision: revisionFloorRef.current,
            })
      await saveVaultFile(file)
      await acceptRevision(file, { lower: true })
      return { ...opened, file }
    },
    [acceptRevision],
  )

  const rememberBiometricKey = useCallback(
    (fileId: string, secret: string, force = false) => {
      if (!force && biometricKeyFileRef.current === fileId) return
      biometricKeyFileRef.current = fileId
      void storeBiometricKey(fileId, secret).then((stored) => {
        if (!stored) biometricKeyFileRef.current = null
      })
    },
    [],
  )

  /** Mémorise la clé de la session courante si l’utilisateur l’a demandé. */
  const rememberCurrentKey = useCallback(
    (force = false) => {
      const current = stateRef.current
      if (!current.file || !current.session) return
      const secret = toBase64(current.session.masterKey)
      if (settingsRef.current.biometricUnlock) {
        // La clé est déjà en place : ne pas réécrire l’entrée du trousseau (cela
        // redemanderait l’autorisation macOS), sauf après une opération qui a
        // changé la clé maîtresse.
        rememberBiometricKey(current.file.id, secret, force)
        void deleteVaultKey(current.file.id)
        return
      }
      if (settingsRef.current.keychainUnlock) {
        void storeVaultKey(current.file.id, secret)
      }
    },
    [rememberBiometricKey],
  )

  /** Active, déplace ou supprime la clé quand les options changent. */
  useEffect(() => {
    const current = stateRef.current
    if (!current.file) return

    if (settings.biometricUnlock) {
      if (current.session) {
        rememberBiometricKey(
          current.file.id,
          toBase64(current.session.masterKey),
          true,
        )
      }
      // Une seule source de déverrouillage rapide : Touch ID remplace le
      // trousseau silencieux.
      void deleteVaultKey(current.file.id)
      return
    }

    biometricKeyFileRef.current = null
    void deleteBiometricKey(current.file.id)
    if (settings.keychainUnlock && current.session) {
      void storeVaultKey(current.file.id, toBase64(current.session.masterKey))
    } else if (!settings.keychainUnlock) {
      void deleteVaultKey(current.file.id)
    }
  }, [rememberBiometricKey, settings.biometricUnlock, settings.keychainUnlock])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const file = await loadVaultFile()
        if (cancelled) return
        if (!file) {
          apply(() => ({ ...initialState, status: 'empty' }))
          return
        }

        // Touch ID remplace le trousseau silencieux : on retire l’ancienne
        // entrée normale dès qu’elle est détectée.
        if (settingsRef.current.biometricUnlock) {
          // On suppose la clé déjà rangée ; si elle manque, le premier essai
          // Touch ID la supprimera et le mot de passe la recréera.
          biometricKeyFileRef.current = file.id
          void deleteVaultKey(file.id)
        }

        // Déverrouillage rapide par le trousseau, uniquement si l’utilisateur
        // l’a demandé, si Touch ID n’est pas requis et si la clé correspond
        // encore à ce fichier.
        if (
          settingsRef.current.keychainUnlock &&
          !settingsRef.current.biometricUnlock
        ) {
          const secret = await loadVaultKey(file.id)
          if (secret) {
            if (!(await acquireVaultLock())) {
              apply(() => ({ ...initialState, status: 'locked', file }))
              return
            }
            const masterKey = fromBase64(secret)
            try {
              const opened = await finalizeOpen(
                await openVaultFileWithMasterKey(file, masterKey),
              )
              if (cancelled) {
                opened.session.lock()
                releaseVaultLock()
                return
              }
              epochRef.current += 1
              apply(() => ({
                status: 'unlocked',
                file: opened.file,
                session: opened.session,
                vaults: opened.vaults,
                templates: opened.templates,
                activity: opened.activity,
                aliasKeys: opened.aliasKeys,
                items: opened.items,
                warnings: opened.warnings,
                error: null,
                readOnly: opened.readOnly,
                syncPending: false,
                syncRevision: 0,
              }))
              return
            } catch {
              // Clé périmée ou fichier remplacé : on repart du mot de passe.
              releaseVaultLock()
              await deleteVaultKey(file.id)
            } finally {
              wipe(masterKey)
            }
          }
        }

        apply(() => ({ ...initialState, status: 'locked', file }))
      } catch (error) {
        if (cancelled) return
        apply(() => ({
          ...initialState,
          status: 'error',
          error: errorMessage(error),
        }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apply, finalizeOpen])

  const watchedSyncFileId =
    state.status === 'unlocked' ? state.file?.id ?? null : null

  useEffect(() => {
    if (!isTauriRuntime() || !watchedSyncFileId) return
    const config = getSyncConfig(watchedSyncFileId)
    if (!config || config.platform === 'web') return

    let active = true
    let unlisten: (() => void) | undefined
    void watchSyncFolder(config.dir).catch(() => undefined)
    void onSyncFolderChanged((dir) => {
      if (!active || dir !== config.dir) return
      if (Date.now() < syncIgnoreUntilRef.current) return
      apply((previous) =>
        previous.syncPending ? previous : { ...previous, syncPending: true },
      )
    }).then((cleanup) => {
      if (active) unlisten = cleanup
      else cleanup()
    })

    return () => {
      active = false
      unlisten?.()
      void unwatchSyncFolder().catch(() => undefined)
    }
  }, [apply, state.syncRevision, watchedSyncFileId])

  useEffect(
    () => () => {
      stateRef.current.session?.lock()
      releaseVaultLock()
    },
    [],
  )

  /**
   * Relit le fichier enregistré avant un déverrouillage. Une écriture terminée
   * après un verrouillage, ou faite par un autre onglet, est ainsi prise en
   * compte : la prochaine écriture contrôlée partira de la bonne base.
   */
  const reloadFile = useCallback(async (): Promise<VaultFile> => {
    const file = await loadVaultFile()
    if (!file) {
      apply(() => ({ ...initialState, status: 'empty' }))
      throw new Error('Le coffre local a été effacé depuis un autre onglet.')
    }
    apply((previous) => (previous.status === 'unlocked' ? previous : { ...previous, file }))
    return file
  }, [apply])

  /** Refuse l’ouverture si un autre onglet détient déjà la session. */
  const requireVaultLock = useCallback(async () => {
    if (await acquireVaultLock()) return
    throw new Error(
      'Coffre est déjà ouvert dans un autre onglet. Fermez cet onglet ou verrouillez-le avant de continuer.',
    )
  }, [])

  const create = useCallback(
    (password: string, vaultName?: string) =>
      enqueue(async () => {
        await requireVaultLock()
        let opened: OpenedVault
        try {
          opened = await createVaultFile(password, vaultName)
        } catch (error) {
          releaseVaultLock()
          throw error
        }
        try {
          opened = await saveOpenedFile(opened)
        } catch (error) {
          opened.session.lock()
          releaseVaultLock()
          throw error
        }
        epochRef.current += 1
        apply(() => ({
          status: 'unlocked',
          file: opened.file,
          session: opened.session,
          vaults: opened.vaults,
          templates: opened.templates,
          activity: opened.activity,
          aliasKeys: opened.aliasKeys,
          items: opened.items,
          warnings: opened.warnings,
          error: null,
          readOnly: opened.readOnly,
          syncPending: false,
          syncRevision: 0,
        }))
        rememberCurrentKey()
      }),
    [apply, enqueue, rememberCurrentKey, requireVaultLock, saveOpenedFile],
  )

  const unlock = useCallback(
    (password: string) =>
      enqueue(async () => {
        // Le fichier enregistré fait foi : un autre onglet, ou une écriture
        // terminée après un verrouillage, a pu le modifier depuis le chargement.
        const current = { ...stateRef.current, file: await reloadFile() }
        await requireVaultLock()
        let opened: OpenedVault
        try {
          opened = await finalizeOpen(
            await unlockVaultFile(current.file, password),
          )
        } catch (error) {
          releaseVaultLock()
          throw error
        }
        epochRef.current += 1
        apply(() => ({
          status: 'unlocked',
          file: opened.file,
          session: opened.session,
          vaults: opened.vaults,
          templates: opened.templates,
          activity: opened.activity,
          aliasKeys: opened.aliasKeys,
          items: opened.items,
          warnings: opened.warnings,
          error: null,
          readOnly: opened.readOnly,
          syncPending: false,
          syncRevision: 0,
        }))
        rememberCurrentKey()
      }),
    [apply, enqueue, finalizeOpen, rememberCurrentKey, reloadFile, requireVaultLock],
  )

  const unlockWithBiometrics = useCallback(
    () =>
      enqueue(async () => {
        // Le fichier enregistré fait foi : un autre onglet, ou une écriture
        // terminée après un verrouillage, a pu le modifier depuis le chargement.
        const current = { ...stateRef.current, file: await reloadFile() }
        await requireVaultLock()

        let result: Awaited<ReturnType<typeof loadBiometricKey>>
        try {
          result = await loadBiometricKey(current.file.id)
        } catch (error) {
          releaseVaultLock()
          throw new Error(
            error instanceof Error
              ? error.message
              : 'L’authentification par empreinte a échoué',
          )
        }

        // L’utilisateur a annulé le dialogue Touch ID : pas d’erreur.
        if (!result.authenticated) {
          releaseVaultLock()
          return false
        }

        if (!result.secret) {
          releaseVaultLock()
          biometricKeyFileRef.current = null
          await deleteBiometricKey(current.file.id)
          throw new Error(
            'Aucune clé biométrique n’est enregistrée pour ce coffre. Déverrouillez avec le mot de passe, puis réactivez Touch ID.',
          )
        }

        const masterKey = fromBase64(result.secret)
        try {
          const opened = await finalizeOpen(
            await openVaultFileWithMasterKey(current.file, masterKey),
          )
          epochRef.current += 1
          biometricKeyFileRef.current = current.file.id
          apply(() => ({
            status: 'unlocked',
            file: opened.file,
            session: opened.session,
            vaults: opened.vaults,
            templates: opened.templates,
            activity: opened.activity,
            aliasKeys: opened.aliasKeys,
            items: opened.items,
            warnings: opened.warnings,
            error: null,
            readOnly: opened.readOnly,
            syncPending: false,
            syncRevision: 0,
          }))
          return true
        } catch {
          // Clé périmée (mot de passe changé, fichier remplacé) : on nettoie.
          releaseVaultLock()
          biometricKeyFileRef.current = null
          await deleteBiometricKey(current.file.id)
          throw new Error(
            'La clé biométrique n’est plus valide. Déverrouillez avec le mot de passe, puis réactivez Touch ID.',
          )
        } finally {
          wipe(masterKey)
        }
      }),
    [apply, enqueue, finalizeOpen, reloadFile, requireVaultLock],
  )

  const unlockWithPrf = useCallback(
    () =>
      enqueue(async () => {
        const current = { ...stateRef.current, file: await reloadFile() }
        if (!current.file.prf) {
          throw new Error('Aucune clé de sécurité n’est configurée pour ce coffre')
        }
        await requireVaultLock()
        let prfOutput: Uint8Array
        try {
          prfOutput = await getPrfOutput({
            credentialId: current.file.prf.credentialId,
            salt: fromBase64(current.file.prf.salt),
            rpId: window.location.hostname,
          })
        } catch (error) {
          releaseVaultLock()
          throw new Error(
            error instanceof Error
              ? error.message
              : 'La clé de sécurité n’a pas fourni de sortie PRF',
          )
        }
        let masterKey: Uint8Array
        try {
          masterKey = await openPrfEnvelope(current.file.prf, prfOutput, current.file.id)
        } catch (error) {
          releaseVaultLock()
          throw new Error(
            error instanceof Error
              ? error.message
              : 'Enveloppe PRF invalide',
          )
        } finally {
          wipe(prfOutput)
        }
        try {
          const opened = await finalizeOpen(
            await openVaultFileWithMasterKey(current.file, masterKey),
          )
          epochRef.current += 1
          apply(() => ({
            status: 'unlocked',
            file: opened.file,
            session: opened.session,
            vaults: opened.vaults,
            templates: opened.templates,
            activity: opened.activity,
            aliasKeys: opened.aliasKeys,
            items: opened.items,
            warnings: opened.warnings,
            error: null,
            readOnly: opened.readOnly,
            syncPending: false,
            syncRevision: 0,
          }))
          return true
        } catch {
          releaseVaultLock()
          throw new Error(
            'La clé de sécurité n’est plus valide. Déverrouillez avec le mot de passe.',
          )
        } finally {
          wipe(masterKey)
        }
      }),
    [apply, enqueue, finalizeOpen, reloadFile, requireVaultLock],
  )

  const enrollPrf = useCallback(
    () =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) {
          throw new Error('Le coffre est en lecture seule.')
        }
        const epoch = epochRef.current
        const envelope = await createPrfEnrollment(
          current.session.masterKey,
          current.file.id,
          {
            rpId: window.location.hostname,
            userName: current.vaults[0]?.name ?? 'Coffre',
          },
        )
        const file = await persist(current.file, { ...current.file, prf: envelope })
        if (epochRef.current !== epoch) return
        apply((previous) => ({ ...previous, file }))
      }),
    [apply, enqueue, persist],
  )

  const removePrf = useCallback(
    () =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const next = { ...current.file }
        delete next.prf
        const file = await persist(current.file, next)
        apply((previous) => ({ ...previous, file }))
      }),
    [apply, enqueue, persist],
  )

  const getSharingIdentity = useCallback(async (): Promise<SharingIdentity | null> => {
    const current = stateRef.current
    if (!current.file || !current.session) throw new Error('Coffre verrouillé')
    if (!current.file.sharing) return null
    return openSharingIdentity(
      current.file.sharing,
      current.session.masterKey,
      current.file.id,
    )
  }, [])

  const createSharingIdentity = useCallback(
    () =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) {
          throw new Error('Le coffre est en lecture seule.')
        }
        if (current.file.sharing) {
          return openSharingIdentity(
            current.file.sharing,
            current.session.masterKey,
            current.file.id,
          )
        }
        const { identity, record } = await makeSharingIdentity(
          current.session.masterKey,
          current.file.id,
        )
        const file = await persist(current.file, { ...current.file, sharing: record })
        apply((previous) => ({ ...previous, file }))
        return identity
      }),
    [apply, enqueue, persist],
  )

  const createSharingPackage = useCallback(
    (vaultId: string, memberIdentities: string[]) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) {
          throw new Error('Le coffre est ouvert en lecture seule.')
        }
        let file = current.file
        let identity: SharingIdentity
        if (file.sharing) {
          identity = await openSharingIdentity(
            file.sharing,
            current.session.masterKey,
            file.id,
          )
        } else {
          const made = await makeSharingIdentity(
            current.session.masterKey,
            file.id,
          )
          identity = made.identity
          file = await persist(file, { ...file, sharing: made.record })
          apply((previous) => ({ ...previous, file }))
        }
        const vaultKey = current.session.vaultKey(vaultId)
        if (!vaultKey) throw new Error('Coffre introuvable')
        const sharing = await readVaultSharing(file, current.session, vaultId)
        if (
          sharing.adminFingerprint &&
          sharing.adminFingerprint !== identity.fingerprint
        ) {
          throw new Error(
            'Seul l’administrateur peut modifier le partage de ce coffre.',
          )
        }
        const members: ShareMember[] = [
          { identity: publicSharingIdentity(identity), role: 'write' },
        ]
        const seen = new Set([identity.fingerprint])
        for (const text of memberIdentities) {
          if (!text.trim()) continue
          const member = await parsePublicSharingIdentity(text)
          if (seen.has(member.fingerprint)) continue
          seen.add(member.fingerprint)
          members.push({ identity: member, role: 'read' })
        }
        if (members.length < 2) {
          throw new Error('Ajoutez au moins une identité de membre')
        }
        const pkg = await createSharedVaultPackage({
          vaultId,
          vaultKey,
          admin: identity,
          members,
        })
        const withMembers = await setVaultSharingMembers(
          file,
          current.session,
          vaultId,
          members.map((member) => ({
            encryptionPublicKey: member.identity.encryptionPublicKey,
            signingPublicKey: member.identity.signingPublicKey,
            fingerprint: member.identity.fingerprint,
            role: member.role,
          })),
          identity.fingerprint,
          pkg,
        )
        const signed = await persist(file, withMembers)
        apply((previous) => ({ ...previous, file: signed }))
        return pkg
      }),
    [apply, enqueue, persist],
  )

  const importSharingPackage = useCallback(
    (packageText: string, vaultName: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) {
          throw new Error('Le coffre est ouvert en lecture seule.')
        }
        let file = current.file
        let identity: SharingIdentity
        if (file.sharing) {
          identity = await openSharingIdentity(
            file.sharing,
            current.session.masterKey,
            file.id,
          )
        } else {
          const made = await makeSharingIdentity(
            current.session.masterKey,
            file.id,
          )
          identity = made.identity
          file = await persist(file, { ...file, sharing: made.record })
          apply((previous) => ({ ...previous, file }))
        }
        let bundleRecord: unknown
        try {
          bundleRecord = JSON.parse(packageText)
        } catch {
          bundleRecord = null
        }
        if (
          bundleRecord &&
          typeof bundleRecord === 'object' &&
          (bundleRecord as { format?: unknown }).format === 'coffre-shared-vault'
        ) {
          const bundle = await parseSharedVaultBundle(bundleRecord)
          const result = await importSharedVaultBundle(
            bundle,
            identity,
            file,
            current.session,
            vaultName,
          )
          const signed = await persist(file, result.file)
          const masterKey = current.session.masterKey
          const opened = await openVaultFileWithMasterKey(signed, masterKey)
          current.session.lock()
          epochRef.current += 1
          apply((previous) => ({
            ...previous,
            status: 'unlocked',
            file: opened.file,
            session: opened.session,
            vaults: opened.vaults,
            items: opened.items,
            templates: opened.templates,
            activity: opened.activity,
            aliasKeys: opened.aliasKeys,
            warnings: opened.warnings,
            error: null,
            readOnly: opened.readOnly,
            syncPending: true,
            syncRevision: previous.syncRevision + 1,
          }))
          return
        }
        const pkg = await parseSharedVaultPackage(packageText)
        const imported = await openSharedVaultPackage(pkg, identity)
        const added = await addSharedVault(file, current.session, {
          vaultId: pkg.vaultId,
          name: vaultName,
          key: imported.vaultKey,
          role: imported.role,
          adminFingerprint: imported.admin.fingerprint,
        })
        const signed = await persist(file, added.file)
        apply((previous) => ({
          ...previous,
          file: signed,
          vaults: [...previous.vaults, added.vault],
          syncPending: true,
          syncRevision: previous.syncRevision + 1,
        }))
      }),
    [apply, enqueue, persist],
  )

  const createSharingBundle = useCallback(
    (vaultId: string, memberIdentities: string[]) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) throw new Error('Le coffre est ouvert en lecture seule.')
        let file = current.file
        let identity: SharingIdentity
        if (file.sharing) {
          identity = await openSharingIdentity(
            file.sharing,
            current.session.masterKey,
            file.id,
          )
        } else {
          const made = await makeSharingIdentity(
            current.session.masterKey,
            file.id,
          )
          identity = made.identity
          file = await persist(file, { ...file, sharing: made.record })
          apply((previous) => ({ ...previous, file }))
        }
        const vaultKey = current.session.vaultKey(vaultId)
        if (!vaultKey) throw new Error('Coffre introuvable')
        const sharing = await readVaultSharing(file, current.session, vaultId)
        if (
          sharing.adminFingerprint &&
          sharing.adminFingerprint !== identity.fingerprint
        ) {
          throw new Error(
            'Seul l’administrateur peut modifier le partage de ce coffre.',
          )
        }
        const members: ShareMember[] = [
          { identity: publicSharingIdentity(identity), role: 'write' },
        ]
        const seen = new Set([identity.fingerprint])
        for (const text of memberIdentities) {
          if (!text.trim()) continue
          const member = await parsePublicSharingIdentity(text)
          if (seen.has(member.fingerprint)) continue
          seen.add(member.fingerprint)
          members.push({ identity: member, role: 'read' })
        }
        if (members.length < 2) throw new Error('Ajoutez au moins une identité de membre')
        const pkg = await createSharedVaultPackage({
          vaultId,
          vaultKey,
          admin: identity,
          members,
        })
        const bundle = await signSharedVaultBundle(
          createSharedVaultBundle(file, vaultId, pkg),
          identity,
        )
        const withMembers = await setVaultSharingMembers(
          file,
          current.session,
          vaultId,
          members.map((member) => ({
            encryptionPublicKey: member.identity.encryptionPublicKey,
            signingPublicKey: member.identity.signingPublicKey,
            fingerprint: member.identity.fingerprint,
            role: member.role,
          })),
          identity.fingerprint,
          pkg,
        )
        const signed = await persist(file, withMembers)
        apply((previous) => ({ ...previous, file: signed }))
        return bundle
      }),
    [apply, enqueue, persist],
  )

  const getVaultSharing = useCallback(
    async (vaultId: string) => {
      const current = stateRef.current
      if (!current.file || !current.session) throw new Error('Coffre verrouillé')
      return readVaultSharing(current.file, current.session, vaultId)
    },
    [],
  )

  const revokeSharingMember = useCallback(
    (vaultId: string, memberFingerprint: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) throw new Error('Le coffre est en lecture seule.')
        let file = current.file
        let identity: SharingIdentity
        if (file.sharing) {
          identity = await openSharingIdentity(
            file.sharing,
            current.session.masterKey,
            file.id,
          )
        } else {
          throw new Error('Créez d’abord votre identité de partage')
        }
        const sharing = await readVaultSharing(file, current.session, vaultId)
        if (sharing.adminFingerprint !== identity.fingerprint) {
          throw new Error('Seul l’administrateur peut révoquer un membre')
        }
        if (memberFingerprint === identity.fingerprint) {
          throw new Error('L’administrateur ne peut pas se révoquer lui-même')
        }
        if (!sharing.members.some((member) => member.fingerprint === memberFingerprint)) {
          throw new Error('Membre introuvable')
        }
        const remaining = sharing.members.filter(
          (member) => member.fingerprint !== memberFingerprint,
        )
        const rotated = await rotateVaultKey(
          file,
          current.session,
          vaultId,
          randomBytes(32),
        )
        const pkg = await createSharedVaultPackage({
          vaultId,
          vaultKey: current.session.vaultKey(vaultId),
          admin: identity,
          members: remaining.map((member) => ({
            identity: {
              encryptionPublicKey: member.encryptionPublicKey,
              signingPublicKey: member.signingPublicKey,
              fingerprint: member.fingerprint,
            },
            role: member.role,
          })),
        })
        file = await setVaultSharingMembers(
          rotated,
          current.session,
          vaultId,
          remaining,
          identity.fingerprint,
          pkg,
        )
        const signed = await persist(current.file, file)
        apply((previous) => ({ ...previous, file: signed }))
        return pkg
      }),
    [apply, enqueue, persist],
  )

  const getEmergencyAccess = useCallback(
    () => stateRef.current.file?.emergency ?? null,
    [],
  )

  const createEmergencyAccess = useCallback(
    (contactText: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) throw new Error('Le coffre est en lecture seule.')
        const contact = await parsePublicSharingIdentity(contactText)
        const emergency = await createEmergencyRecord(
          current.session.masterKey,
          contact,
        )
        const file = await persist(current.file, { ...current.file, emergency })
        apply((previous) => ({ ...previous, file }))
      }),
    [apply, enqueue, persist],
  )

  const createShamirEmergencyAccess = useCallback(
    (contactTexts: string[], threshold = 2) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) throw new Error('Le coffre est en lecture seule.')
        const contacts = []
        for (const text of contactTexts) {
          if (text.trim()) contacts.push(await parsePublicSharingIdentity(text))
        }
        const emergency = await createShamirEmergencyRecord(
          current.session.masterKey,
          contacts,
          threshold,
        )
        const file = await persist(current.file, { ...current.file, emergency })
        apply((previous) => ({ ...previous, file }))
      }),
    [apply, enqueue, persist],
  )

  const removeEmergencyAccess = useCallback(
    () =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (!current.file.emergency) return
        const next = { ...current.file }
        delete next.emergency
        const file = await persist(current.file, next)
        apply((previous) => ({ ...previous, file }))
      }),
    [apply, enqueue, persist],
  )

  const resetBiometricKey = useCallback(async () => {
    const current = stateRef.current
    if (!current.file || !current.session) throw new Error('Coffre verrouillé')
    biometricKeyFileRef.current = null
    await deleteBiometricKey(current.file.id)
    const stored = await storeBiometricKey(
      current.file.id,
      toBase64(current.session.masterKey),
    )
    if (!stored) throw new Error('Impossible d’enregistrer la clé biométrique.')
    biometricKeyFileRef.current = current.file.id
  }, [])

  /**
   * Verrouille la session. `forgetQuickUnlock` retire aussi la clé du
   * trousseau silencieux : c’est le cas d’un verrouillage explicite, par
   * inactivité ou en arrière-plan. À la fermeture de la page, la clé est
   * conservée, ce qui est le but du déverrouillage rapide au relancement.
   */
  const lockWith = useCallback((forgetQuickUnlock: boolean) => {
    const current = stateRef.current
    if (current.status !== 'unlocked') return
    epochRef.current += 1
    revisionFloorRef.current = 0
    const session = current.session
    if (session) {
      // L’interface passe immédiatement à « verrouillé ». Les clés sont
      // effacées dès que les tâches déjà en file sont terminées : une écriture
      // lancée avant le verrouillage est enregistrée au lieu d’être perdue.
      drainingRef.current = { session, readOnly: current.readOnly }
      void queueRef.current.then(() => {
        if (drainingRef.current?.session === session) drainingRef.current = null
        session.lock()
      })
    }
    releaseVaultLock()
    void clearClipboardIfLastCopied()
    if (current.file) {
      if (forgetQuickUnlock) void deleteVaultKey(current.file.id)
      // Avec Touch ID, la clé biométrique reste disponible pour le prochain
      // déverrouillage ; sinon on nettoie toute entrée résiduelle.
      if (!settingsRef.current.biometricUnlock) {
        biometricKeyFileRef.current = null
        void deleteBiometricKey(current.file.id)
      }
    }
    apply(() => ({
      ...current,
      status: 'locked',
      session: null,
      vaults: [],
      items: [],
      warnings: [],
      readOnly: false,
      syncPending: false,
    }))
  }, [apply])

  const lock = useCallback(() => lockWith(true), [lockWith])

  const configureSharedFolder = useCallback(
    (vaultId: string, dir: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file) throw new Error('Coffre verrouillé')
        if (!current.file.vaults.some((vault) => vault.id === vaultId)) {
          throw new Error('Coffre introuvable')
        }
        configureDesktopSharedSync(current.file.id, vaultId, dir)
        apply((previous) => ({
          ...previous,
          syncRevision: previous.syncRevision + 1,
        }))
      }),
    [apply, enqueue],
  )

  const configureWebSharedFolder = useCallback(
    (vaultId: string, handle: FileSystemDirectoryHandle) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file) throw new Error('Coffre verrouillé')
        if (!current.file.vaults.some((vault) => vault.id === vaultId)) {
          throw new Error('Coffre introuvable')
        }
        await configureWebSharedSync(current.file.id, vaultId, handle)
        apply((previous) => ({
          ...previous,
          syncRevision: previous.syncRevision + 1,
        }))
      }),
    [apply, enqueue],
  )

  const disableSharedSync = useCallback(
    (vaultId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file) throw new Error('Coffre verrouillé')
        await disableSharedSyncConfig(current.file.id, vaultId)
        apply((previous) => ({
          ...previous,
          syncRevision: previous.syncRevision + 1,
        }))
      }),
    [apply, enqueue],
  )

  const getSharedSyncStatus = useCallback((vaultId: string) => {
    const current = stateRef.current
    if (!current.file) return null
    return getSharedSyncConfig(current.file.id, vaultId)
  }, [])

  const sharedSyncBusyRef = useRef(new Set<string>())

  const syncSharedVault = useCallback(
    (vaultId: string) =>
      enqueue(async (): Promise<SharedSyncReport> => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) {
          throw new Error('Le coffre est ouvert en lecture seule.')
        }
        const config = getSharedSyncConfig(current.file.id, vaultId)
        if (!config) throw new Error('Aucun dossier de synchronisation configuré.')
        if (sharedSyncBusyRef.current.has(vaultId)) {
          throw new Error('Synchronisation déjà en cours.')
        }
        sharedSyncBusyRef.current.add(vaultId)
        try {
          const sharing = await readVaultSharing(
            current.file,
            current.session,
            vaultId,
          )
          if (!sharing.package) {
            throw new Error(
              'Paquet de partage indisponible : demandez un nouveau paquet à l’administrateur.',
            )
          }
          if (!current.file.sharing) {
            throw new Error('Identité de partage absente.')
          }
          const identity = await openSharingIdentity(
            current.file.sharing,
            current.session.masterKey,
            current.file.id,
          )
          const io = await openSharedSyncIO(config)
          const result = await syncSharedVaultContent({
            file: current.file,
            session: current.session,
            identity,
            vaultId,
            package: sharing.package,
            io,
            lastImports: config.lastImports,
          })
          const warnings = [...result.warnings]
          let opened: OpenedVault | null = null
          if (result.changed) {
            const next = await persist(current.file, result.file)
            try {
              opened = await openVaultFileWithMasterKey(
                next,
                current.session.masterKey,
              )
            } catch {
              current.session.lock()
              lock()
              throw new Error(
                'Le coffre partagé synchronisé n’a pas pu être rouvert. Déverrouillez-le à nouveau.',
              )
            }
            if (!opened) {
              throw new Error(
                'Le coffre partagé synchronisé n’a pas pu être rouvert.',
              )
            }
            const open = opened
            current.session.lock()
            epochRef.current += 1
            apply((previous) => ({
              ...previous,
              status: 'unlocked',
              file: open.file,
              session: open.session,
              vaults: open.vaults,
              templates: open.templates,
              activity: open.activity,
              aliasKeys: open.aliasKeys,
              items: open.items,
              warnings: open.warnings,
              error: null,
              readOnly: open.readOnly,
              syncPending: false,
              syncRevision: previous.syncRevision + 1,
            }))
          } else {
            apply((previous) => ({
              ...previous,
              syncRevision: previous.syncRevision + 1,
            }))
          }
          if (isTauriRuntime() && (result.changed || result.written)) {
            const itemsForVault = (opened?.items ?? current.items).filter(
              (item) => item.vaultId === vaultId,
            )
            try {
              await exportBlobsToDirectory(
                config.dir,
                referencedBlobIds(itemsForVault),
              )
              await importBlobsFromDirectory(config.dir)
            } catch {
              warnings.push(
                'Les documents chiffrés du coffre partagé n’ont pas pu être synchronisés.',
              )
            }
          }
          saveSharedSyncConfig({
            ...config,
            lastImports: result.lastImports,
            lastSyncAt: new Date().toISOString(),
            lastWarning:
              warnings.length > 0
                ? warnings.slice(0, 3).join(' · ').slice(0, 500)
                : undefined,
          })
          return {
            imported: result.imported,
            updated: result.updated,
            deleted: result.deleted,
            conflicts: result.conflicts,
            warnings,
            written: result.written,
            changed: result.changed,
          }
        } finally {
          sharedSyncBusyRef.current.delete(vaultId)
        }
      }),
    [apply, enqueue, lock, persist],
  )

  const sharedSyncFileId =
    state.status === 'unlocked' ? state.file?.id ?? null : null
  useEffect(() => {
    if (!sharedSyncFileId) return
    const configs = listSharedSyncConfigs(sharedSyncFileId)
    if (configs.length === 0) return
    let cancelled = false
    const syncAll = async () => {
      for (const config of configs) {
        if (cancelled) return
        try {
          await syncSharedVault(config.vaultId)
        } catch {
          // L’erreur est visible à la prochaine synchronisation manuelle.
        }
      }
    }
    const timer = window.setInterval(() => void syncAll(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [sharedSyncFileId, state.syncRevision, syncSharedVault])


  useEffect(() => {
    // Fermeture, rechargement ou mise en cache (bfcache) : la session est
    // effacée et l’état passe à « verrouillé », pour qu’une page restaurée
    // depuis le cache ne présente jamais un coffre ouvert sans clés. La clé
    // du déverrouillage rapide est conservée pour le prochain lancement.
    const onPageHide = () => lockWith(false)
    window.addEventListener('beforeunload', onPageHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('beforeunload', onPageHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [lockWith])

  const addVault = useCallback(
    (name: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (getTravelMode(current.file.id)?.enabled) {
          throw new Error(
            'Désactivez le mode voyage avant d’ajouter un coffre.',
          )
        }
        const epoch = epochRef.current
        const result = await addVaultToFile(current.file, current.session, name)
        const file = await persist(current.file, result.file)
        if (epochRef.current !== epoch) return
        apply((previous) => ({
          ...previous,
          file,
          vaults: [...previous.vaults, result.vault],
        }))
      }),
    [apply, enqueue, persist],
  )

  const renameVault = useCallback(
    (vaultId: string, name: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const next = await renameVaultInFile(current.file, current.session, vaultId, name)
        const file = await persist(current.file, next)
        if (epochRef.current !== epoch) return
        apply((previous) => ({
          ...previous,
          file,
          vaults: previous.vaults.map((vault) =>
            vault.id === vaultId ? { ...vault, name: name.trim() } : vault,
          ),
        }))
      }),
    [apply, enqueue, persist],
  )

  const deleteVault = useCallback(
    (vaultId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const next = await deleteVaultFromFile(current.file, current.session, vaultId)
        const file = await persist(current.file, next)
        current.session.removeVaultKey(vaultId)
        if (epochRef.current !== epoch) return
        apply((previous) => ({
          ...previous,
          file,
          vaults: previous.vaults.filter((vault) => vault.id !== vaultId),
          items: previous.items.filter((item) => item.vaultId !== vaultId),
        }))
      }),
    [apply, enqueue, persist],
  )

  const createTemplate = useCallback(
    (input: { name: string; icon?: string; fields: import('../lib/types').TemplateField[] }) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const result = await createTemplateInFile(current.file, current.session, input)
        const file = await persist(current.file, result.file)
        apply((previous) => ({
          ...previous,
          file,
          templates: [...previous.templates, result.template],
        }))
        return result.template
      }),
    [apply, enqueue, persist],
  )

  const updateTemplate = useCallback(
    (
      templateId: string,
      input: { name: string; icon?: string; fields: import('../lib/types').TemplateField[] },
    ) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const result = await updateTemplateInFile(
          current.file,
          current.session,
          templateId,
          input,
        )
        const file = await persist(current.file, result.file)
        apply((previous) => ({
          ...previous,
          file,
          templates: previous.templates.map((template) =>
            template.id === templateId ? result.template : template,
          ),
        }))
        return result.template
      }),
    [apply, enqueue, persist],
  )

  const deleteTemplate = useCallback(
    (templateId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const file = await persist(
          current.file,
          deleteTemplateInFile(current.file, templateId),
        )
        apply((previous) => ({
          ...previous,
          file,
          templates: previous.templates.filter((template) => template.id !== templateId),
        }))
      }),
    [apply, enqueue, persist],
  )

  const enableTravelMode = useCallback(
    (safeVaultIds: string[], password: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) {
          throw new Error('Le coffre est ouvert en lecture seule.')
        }
        const candidate = await deriveMasterKey(password, current.file.kdf)
        const matches = equalBytes(candidate, current.session.masterKey)
        wipe(candidate)
        if (!matches) throw new Error('Le mot de passe maître est incorrect')

        const safe = new Set(safeVaultIds)
        const hidden = current.file.vaults
          .map((vault) => vault.id)
          .filter((id) => !safe.has(id))
        if (safe.size === 0) {
          throw new Error('Sélectionnez au moins un coffre sûr pour le voyage.')
        }
        if (hidden.length === 0) {
          throw new Error('Tous les coffres sont déjà marqués sûrs pour le voyage.')
        }

        const stripped = stripVaultForTravel(current.file, safeVaultIds)
        const signed = await signVaultFile(stripped, current.session, current.file, {
          minimumRevision: revisionFloorRef.current,
          createTombstones: false,
        })
        await saveVaultFile(signed)
        await overwriteVaultBackups(signed)
        await acceptRevision(signed)
        for (const id of hidden) current.session.removeVaultKey(id)
        setTravelMode(current.file.id, {
          enabled: true,
          safeVaultIds: Array.from(safe),
        })
        apply((previous) => ({
          ...previous,
          file: signed,
          vaults: previous.vaults.filter((vault) => safe.has(vault.id)),
          items: previous.items.filter((item) => safe.has(item.vaultId)),
          syncPending: false,
          syncRevision: previous.syncRevision + 1,
        }))
      }),
    [acceptRevision, apply, enqueue],
  )

  const disableTravelMode = useCallback(
    (password: string, remotePassword?: string) =>
      enqueue(async (): Promise<SyncRunResult> => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) {
          throw new Error('Le coffre est ouvert en lecture seule.')
        }
        const travel = getTravelMode(current.file.id)
        if (!travel?.enabled) {
          throw new Error('Le mode voyage n’est pas actif.')
        }
        const candidate = await deriveMasterKey(password, current.file.kdf)
        const matches = equalBytes(candidate, current.session.masterKey)
        wipe(candidate)
        if (!matches) throw new Error('Le mot de passe maître est incorrect')

        const config = getSyncConfig(current.file.id)
        if (!config) {
          throw new Error(
            'Configurez une source de synchronisation avant de désactiver le mode voyage.',
          )
        }

        let io: {
          list: () => Promise<SyncFileInfo[]>
          read: (name: string) => Promise<string | null>
        }
        if (config.platform === 'web') {
          const handle = await loadWebSyncHandle(current.file.id)
          if (!handle) {
            throw new Error(
              'Le dossier Web n’est plus accessible. Choisissez-le à nouveau.',
            )
          }
          if (!(await ensureWebSyncPermission(handle))) {
            throw new Error('L’accès au dossier de synchronisation a été refusé.')
          }
          io = {
            list: () => listWebSyncFiles(handle, current.file!.id),
            read: (name) => readWebSyncFile(handle, current.file!.id, name),
          }
        } else {
          io = {
            list: () => listSyncFiles(config.dir),
            read: (name) => readSyncFile(config.dir, name),
          }
        }

        const warnings: string[] = []
        const remotes: VaultFile[] = []
        for (const entry of await io.list()) {
          try {
            const text = await io.read(entry.name)
            if (!text) continue
            remotes.push(parseVaultFileText(text))
          } catch {
            warnings.push(`Le fichier « ${entry.name} » est illisible et a été ignoré.`)
          }
        }
        if (remotes.length === 0) {
          throw new Error(
            'Aucun fichier distant trouvé. Reconnectez une source de synchronisation contenant les coffres masqués.',
          )
        }

        const result = await reconcileVaultFiles({
          local: current.file,
          session: current.session,
          remotes,
          password: remotePassword ?? password,
        })
        warnings.push(...result.warnings)
        let signed = current.file
        let opened: OpenedVault | null = null
        if (result.session !== current.session || result.file !== current.file) {
          try {
            signed = await persistWithSession(
              result.session,
              current.file,
              result.file,
            )
          } catch (error) {
            if (result.session !== current.session) result.session.lock()
            throw error
          }
          await overwriteVaultBackups(signed)
          try {
            opened = await openVaultFileWithMasterKey(
              signed,
              result.session.masterKey,
            )
          } catch {
            current.session.lock()
            if (result.session !== current.session) result.session.lock()
            lock()
            throw new Error(
              'Le coffre restauré n’a pas pu être rouvert. Déverrouillez-le à nouveau.',
            )
          }
        }

        if (!opened) {
          throw new Error(
            'Aucun coffre masqué n’a été retrouvé dans la source de synchronisation.',
          )
        }

        clearTravelMode(current.file.id)
        const previousSession = current.session
        current.session.lock()
        if (result.session !== previousSession) result.session.lock()
        epochRef.current += 1
        apply((previous) => ({
          ...previous,
          file: signed,
          session: opened.session,
          vaults: opened.vaults,
          templates: opened.templates,
          activity: opened.activity,
          aliasKeys: opened.aliasKeys,
          items: opened.items,
          warnings: opened.warnings,
          error: null,
          readOnly: opened.readOnly,
          syncPending: false,
          syncRevision: previous.syncRevision + 1,
        }))
        return {
          conflicts: result.conflicts.length,
          warnings,
          adoptedEpoch: result.adoptedEpoch,
        }
      }),
    [apply, enqueue, lock, persistWithSession],
  )

  const addItem = useCallback(
    (draft: ItemDraft) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const result = await createItem(current.file, current.session, draft)
        const file = await persist(current.file, result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file,
          items: [...previous.items, result.item],
          vaults: previous.vaults.map((vault) =>
            vault.id === result.item.vaultId
              ? { ...vault, itemCount: vault.itemCount + 1 }
              : vault,
          ),
        }))
        return result.item
      }),
    [apply, enqueue, persist],
  )

  const updateItem = useCallback(
    (item: VaultItem) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const result = await updateItemInFile(current.file, current.session, item)
        const file = await persist(current.file, result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file,
          items: previous.items.map((candidate) =>
            candidate.id === result.item.id ? result.item : candidate,
          ),
        }))
        return result.item
      }),
    [apply, enqueue, persist],
  )

  const moveItem = useCallback(
    (itemId: string, targetVaultId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const existing = current.items.find((item) => item.id === itemId)
        if (!existing) throw new VaultValidationError('Élément introuvable')
        if (existing.vaultId === targetVaultId) return existing
        const epoch = epochRef.current
        const result = await moveItemInFile(
          current.file,
          current.session,
          itemId,
          targetVaultId,
        )
        const file = await persist(current.file, result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file,
          items: previous.items.map((candidate) =>
            candidate.id === result.item.id ? result.item : candidate,
          ),
          vaults: previous.vaults.map((vault) => {
            if (vault.id === existing.vaultId) {
              return { ...vault, itemCount: Math.max(0, vault.itemCount - 1) }
            }
            if (vault.id === targetVaultId) {
              return { ...vault, itemCount: vault.itemCount + 1 }
            }
            return vault
          }),
        }))
        return result.item
      }),
    [apply, enqueue, persist],
  )

  const trashItem = useCallback(
    (itemId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const existing = current.items.find((item) => item.id === itemId)
        if (!existing) throw new VaultValidationError('Élément introuvable')
        const epoch = epochRef.current
        const result = await trashItemInFile(current.file, current.session, itemId)
        const file = await persist(current.file, result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file,
          items: previous.items.map((item) =>
            item.id === result.item.id ? result.item : item,
          ),
          vaults: previous.vaults.map((vault) =>
            vault.id === existing.vaultId && !existing.deletedAt
              ? { ...vault, itemCount: Math.max(0, vault.itemCount - 1) }
              : vault,
          ),
        }))
        return result.item
      }),
    [apply, enqueue, persist],
  )

  const trashItems = useCallback(
    (itemIds: string[]) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const unique = Array.from(new Set(itemIds))
        const existing = current.items.filter(
          (item) => unique.includes(item.id) && !item.deletedAt,
        )
        if (existing.length === 0) return 0

        const epoch = epochRef.current
        let draft = current.file
        const trashed: VaultItem[] = []
        for (const item of existing) {
          const result = await trashItemInFile(draft, current.session, item.id)
          draft = result.file
          trashed.push(result.item)
        }
        const file = await persist(current.file, draft)
        if (epochRef.current !== epoch) return trashed.length

        const counts = new Map<string, number>()
        for (const item of existing) {
          counts.set(item.vaultId, (counts.get(item.vaultId) ?? 0) + 1)
        }
        apply((previous) => ({
          ...previous,
          file,
          items: previous.items.map(
            (item) => trashed.find((entry) => entry.id === item.id) ?? item,
          ),
          vaults: previous.vaults.map((vault) => ({
            ...vault,
            itemCount: Math.max(0, vault.itemCount - (counts.get(vault.id) ?? 0)),
          })),
        }))
        return trashed.length
      }),
    [apply, enqueue, persist],
  )

  const favoriteItems = useCallback(
    (itemIds: string[], favorite: boolean) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const unique = Array.from(new Set(itemIds))
        const existing = current.items.filter(
          (item) => unique.includes(item.id) && !item.deletedAt && item.favorite !== favorite,
        )
        if (existing.length === 0) return 0

        const epoch = epochRef.current
        let draft = current.file
        const changed: VaultItem[] = []
        for (const item of existing) {
          const result = await updateItemInFile(draft, current.session, {
            ...item,
            favorite,
          })
          draft = result.file
          changed.push(result.item)
        }
        const file = await persist(current.file, draft)
        if (epochRef.current !== epoch) return changed.length
        apply((previous) => ({
          ...previous,
          file,
          items: previous.items.map(
            (item) => changed.find((entry) => entry.id === item.id) ?? item,
          ),
        }))
        return changed.length
      }),
    [apply, enqueue, persist],
  )

  const restoreItem = useCallback(
    (itemId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const existing = current.items.find((item) => item.id === itemId)
        if (!existing) throw new VaultValidationError('Élément introuvable')
        const epoch = epochRef.current
        const result = await restoreItemFromFile(current.file, current.session, itemId)
        const file = await persist(current.file, result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file,
          items: previous.items.map((item) =>
            item.id === result.item.id ? result.item : item,
          ),
          vaults: previous.vaults.map((vault) =>
            vault.id === existing.vaultId && existing.deletedAt
              ? { ...vault, itemCount: vault.itemCount + 1 }
              : vault,
          ),
        }))
        return result.item
      }),
    [apply, enqueue, persist],
  )

  const deleteItemPermanently = useCallback(
    (itemId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file) throw new Error('Coffre verrouillé')
        const existing = current.items.find((item) => item.id === itemId)
        if (!existing) return
        if (!current.session) throw new Error('Coffre verrouillé')
        if (current.session.vaultRole(existing.vaultId) === 'read') {
          throw new Error('Ce coffre partagé est en lecture seule.')
        }
        const epoch = epochRef.current
        const draft = await deleteItem(current.file, itemId)
        const file = await persist(current.file, draft)
        if (epochRef.current !== epoch) return
        apply((previous) => ({
          ...previous,
          file,
          items: previous.items.filter((item) => item.id !== itemId),
          vaults: previous.vaults.map((vault) =>
            vault.id === existing.vaultId && !existing.deletedAt
              ? { ...vault, itemCount: Math.max(0, vault.itemCount - 1) }
              : vault,
          ),
        }))
      }),
    [apply, enqueue, persist],
  )

  const emptyTrash = useCallback(
    () =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const ids = current.items
          .filter(
            (item) =>
              item.deletedAt && current.session?.vaultRole(item.vaultId) !== 'read',
          )
          .map((item) => item.id)
        if (ids.length === 0) return 0

        const epoch = epochRef.current
        const draft = deleteItems(current.file, ids)
        const file = await persist(current.file, draft)
        if (epochRef.current !== epoch) return ids.length
        const removed = new Set(ids)
        apply((previous) => ({
          ...previous,
          file,
          items: previous.items.filter((item) => !removed.has(item.id)),
        }))
        return ids.length
      }),
    [apply, enqueue, persist],
  )

  const getItemVersions = useCallback(
    (itemId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        return listItemVersions(current.file, current.session, itemId)
      }),
    [enqueue],
  )

  const restoreItemVersion = useCallback(
    (itemId: string, versionId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const result = await restoreItemVersionInFile(
          current.file,
          current.session,
          itemId,
          versionId,
        )
        const file = await persist(current.file, result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file,
          items: previous.items.map((item) =>
            item.id === result.item.id ? result.item : item,
          ),
        }))
        return result.item
      }),
    [apply, enqueue, persist],
  )

  const addAttachment = useCallback(
    (item: VaultItem, attachment: File) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (attachment.size > MAX_ATTACHMENT_BYTES) {
          throw new VaultValidationError('La pièce jointe dépasse la limite de 5 Mo')
        }

        const bytes = new Uint8Array(await attachment.arrayBuffer())
        try {
          const epoch = epochRef.current
          const result = await addAttachmentToFile(
            current.file,
            current.session,
            item,
            {
              name: attachment.name,
              mime: attachment.type,
              bytes,
            },
          )
          const file = await persist(current.file, result.file)
          if (epochRef.current !== epoch) return result.item
          apply((previous) => ({
            ...previous,
            file,
            items: previous.items.map((candidate) =>
              candidate.id === result.item.id ? result.item : candidate,
            ),
          }))
          return result.item
        } finally {
          wipe(bytes)
        }
      }),
    [apply, enqueue, persist],
  )

  const removeAttachment = useCallback(
    (item: VaultItem, attachmentId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const result = await removeAttachmentFromFile(
          current.file,
          current.session,
          item,
          attachmentId,
        )
        const file = await persist(current.file, result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file,
          items: previous.items.map((candidate) =>
            candidate.id === result.item.id ? result.item : candidate,
          ),
        }))
        return result.item
      }),
    [apply, enqueue, persist],
  )

  const downloadAttachment = useCallback(
    (item: VaultItem, attachmentId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const { meta, bytes } = await openAttachment(
          current.file,
          current.session,
          item,
          attachmentId,
        )
        try {
          downloadBytes(bytes, meta.name, meta.mime)
        } finally {
          wipe(bytes)
        }
      }),
    [enqueue],
  )

  const importItems = useCallback(
    (drafts: ItemDraft[]) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (drafts.length === 0) return { imported: 0, warnings: [] }
        if (drafts.length > 5_000) {
          throw new VaultValidationError('Import limité à 5 000 éléments à la fois')
        }

        let draft = current.file
        const created: VaultItem[] = []
        const warnings: string[] = []

        for (const itemDraft of drafts) {
          try {
            const result = await createItem(draft, current.session, itemDraft)
            draft = result.file
            created.push(result.item)
          } catch (error) {
            warnings.push(
              `« ${itemDraft.title || 'Sans titre'} » : ${
                error instanceof Error ? error.message : 'import impossible'
              }`,
            )
          }
        }

        if (created.length === 0) return { imported: 0, warnings }

        const epoch = epochRef.current
        const file = await persist(current.file, draft)
        if (epochRef.current !== epoch) return { imported: created.length, warnings }

        apply((previous) => {
          const items = [...previous.items, ...created]
          return {
            ...previous,
            file,
            items,
            vaults: previous.vaults.map((vault) => ({
              ...vault,
              itemCount: items.filter((item) => item.vaultId === vault.id).length,
            })),
          }
        })

        return { imported: created.length, warnings }
      }),
    [apply, enqueue, persist],
  )

  const changePassword = useCallback(
    (currentPassword: string, newPassword: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (getTravelMode(current.file.id)?.enabled) {
          throw new Error(
            'Désactivez le mode voyage avant de changer le mot de passe maître.',
          )
        }

        const candidate = await deriveMasterKey(currentPassword, current.file.kdf)
        const matches = equalBytes(candidate, current.session.masterKey)
        wipe(candidate)
        if (!matches) throw new Error('Le mot de passe actuel est incorrect')

        const epoch = epochRef.current
        const draft = await changeMasterPassword(current.file, current.session, newPassword)
        // Une enveloppe PRF scellée avec l’ancienne clé maîtresse est invalide.
        delete draft.prf
        let file: VaultFile
        try {
          file = await persist(current.file, draft)
        } catch (error) {
          // Le fichier sur disque utilise encore l’ancienne clé : on verrouille
          // pour éviter de continuer avec une session incohérente.
          lock()
          throw error
        }
        if (epochRef.current !== epoch) return
        apply((previous) => ({ ...previous, file }))

        // La session garde l’ancienne clé maîtresse : on enregistre la nouvelle
        // pour que le déverrouillage rapide reste valide.
        if (
          settingsRef.current.biometricUnlock ||
          settingsRef.current.keychainUnlock
        ) {
          const nextKey = await deriveMasterKey(newPassword, file.kdf)
          try {
            const secret = toBase64(nextKey)
            if (settingsRef.current.biometricUnlock) {
              biometricKeyFileRef.current = file.id
              await storeBiometricKey(file.id, secret)
              await deleteVaultKey(file.id)
            } else {
              await storeVaultKey(file.id, secret)
            }
          } finally {
            wipe(nextKey)
          }
        }
      }),
    [apply, enqueue, lock, persist],
  )

  const setRecoveryPhrase = useCallback(
    (phrase: string | null) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')

        const epoch = epochRef.current
        const draft = phrase
          ? await enableRecovery(current.file, current.session, phrase)
          : disableRecovery(current.file, current.session)
        let file: VaultFile
        try {
          file = await persist(current.file, draft)
        } catch (error) {
          lock()
          throw error
        }
        if (epochRef.current !== epoch) return
        apply((previous) => ({ ...previous, file }))
      }),
    [apply, enqueue, lock, persist],
  )

  const recoverWithPhrase = useCallback(
    (phrase: string, newPassword: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file) throw new Error('Aucun coffre local à récupérer')
        if (getTravelMode(current.file.id)?.enabled) {
          throw new Error(
            'Désactivez le mode voyage avant de récupérer le coffre.',
          )
        }
        await requireVaultLock()

        let opened: OpenedVault
        try {
          const recovered = await recoverVaultFile(current.file, phrase, newPassword)
          delete recovered.file.prf
          opened = await finalizeOpen(recovered, { acceptRollback: true })
          opened = await saveOpenedFile(opened)
        } catch (error) {
          releaseVaultLock()
          throw error
        }
        current.session?.lock()
        epochRef.current += 1
        apply(() => ({
          status: 'unlocked',
          file: opened.file,
          session: opened.session,
          vaults: opened.vaults,
          templates: opened.templates,
          activity: opened.activity,
          aliasKeys: opened.aliasKeys,
          items: opened.items,
          warnings: opened.warnings,
          error: null,
          readOnly: opened.readOnly,
          syncPending: false,
          syncRevision: 0,
        }))
        rememberCurrentKey(true)
      }),
    [apply, enqueue, finalizeOpen, rememberCurrentKey, requireVaultLock, saveOpenedFile],
  )

  const createRecoveryShares = useCallback(
    (threshold: number, total: number) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file?.recovery) {
          throw new VaultValidationError(
            'Configurez d’abord une phrase de récupération pour créer un kit d’urgence.',
          )
        }
        if (!current.session) throw new Error('Coffre verrouillé')

        let recoveryKey: Uint8Array
        try {
          recoveryKey = current.session.recoveryKey().slice()
        } catch {
          throw new VaultValidationError(
            'La clé de récupération n’est pas disponible ; régénérez la phrase de récupération.',
          )
        }

        let parts: Uint8Array[] = []
        try {
          parts = await splitSecret(recoveryKey, threshold, total)
          return parts.map((part, index) => ({
            index: index + 1,
            threshold,
            total,
            words: encodeShareWords(part),
            payload: shareToPayload(part),
          }))
        } finally {
          wipe(recoveryKey)
          for (const part of parts) wipe(part)
        }
      }),
    [enqueue],
  )

  const recoverWithShares = useCallback(
    (shares: string[], newPassword: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file) throw new Error('Aucun coffre local à récupérer')
        if (getTravelMode(current.file.id)?.enabled) {
          throw new Error(
            'Désactivez le mode voyage avant de récupérer le coffre.',
          )
        }
        await requireVaultLock()

        const parts = shares.map(parseShareInput)
        let recoveryKey: Uint8Array | null = null
        try {
          recoveryKey = await combineShares(parts)
          let opened: OpenedVault
          try {
            const recovered = await recoverVaultFileWithRecoveryKey(
              current.file,
              recoveryKey,
              newPassword,
            )
            delete recovered.file.prf
            opened = await finalizeOpen(recovered, { acceptRollback: true })
            opened = await saveOpenedFile(opened)
          } catch (error) {
            releaseVaultLock()
            throw error
          }
          current.session?.lock()
          epochRef.current += 1
          apply(() => ({
            status: 'unlocked',
            file: opened.file,
            session: opened.session,
            vaults: opened.vaults,
            templates: opened.templates,
            activity: opened.activity,
            aliasKeys: opened.aliasKeys,
            items: opened.items,
            warnings: opened.warnings,
            error: null,
            readOnly: opened.readOnly,
            syncPending: false,
            syncRevision: 0,
          }))
          rememberCurrentKey(true)
        } finally {
          if (recoveryKey) wipe(recoveryKey)
          for (const part of parts) wipe(part)
        }
      }),
    [apply, enqueue, finalizeOpen, rememberCurrentKey, requireVaultLock, saveOpenedFile],
  )

  const exportVault = useCallback(() => {
    const current = stateRef.current
    if (!current.file) throw new Error('Aucun coffre à exporter')
    downloadFile(serializeVault(current.file), vaultFileName(), 'application/json')
  }, [])

  const importVault = useCallback(
    (text: string, password: string) =>
      enqueue(async () => {
        if (text.length > 100_000_000) {
          throw new VaultValidationError('Fichier trop volumineux (100 Mo maximum)')
        }
        await requireVaultLock()
        let file: VaultFile
        let opened: OpenedVault
        try {
          file = parseVaultFileText(text)
          if (getTravelMode(file.id)?.enabled) {
            throw new Error(
              'Désactivez le mode voyage avant d’importer un coffre complet.',
            )
          }
          opened = await finalizeOpen(await unlockVaultFile(file, password), {
            acceptRollback: true,
          })
          opened = await saveOpenedFile(opened)
        } catch (error) {
          releaseVaultLock()
          throw error
        }
        const previous = stateRef.current
        previous.session?.lock()
        epochRef.current += 1
        apply(() => ({
          status: 'unlocked',
          file: opened.file,
          session: opened.session,
          vaults: opened.vaults,
          templates: opened.templates,
          activity: opened.activity,
          aliasKeys: opened.aliasKeys,
          items: opened.items,
          warnings: opened.warnings,
          error: null,
          readOnly: opened.readOnly,
          syncPending: false,
          syncRevision: 0,
        }))
        if (previous.file && previous.file.id !== opened.file.id) {
          biometricKeyFileRef.current = null
          await deleteVaultKey(previous.file.id)
          await deleteBiometricKey(previous.file.id)
        }
        rememberCurrentKey(true)
      }),
    [apply, enqueue, finalizeOpen, rememberCurrentKey, requireVaultLock, saveOpenedFile],
  )

  const verify = useCallback(
    () =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const report = await verifyVaultFile(current.file, current.session)
        if (epochRef.current !== epoch) {
          throw new Error('Le coffre a été verrouillé pendant la vérification')
        }
        return report
      }),
    [enqueue],
  )

  const reset = useCallback(
    () =>
      enqueue(async () => {
        const current = stateRef.current
        await clearVaultStorage()
        clearUsage()
        epochRef.current += 1
        revisionFloorRef.current = 0
        current.session?.lock()
        releaseVaultLock()
        void clearClipboardIfLastCopied()
        if (current.file) {
          biometricKeyFileRef.current = null
          await deleteVaultKey(current.file.id)
          await deleteBiometricKey(current.file.id)
          const syncConfig = getSyncConfig(current.file.id)
          removeSyncConfig(current.file.id)
          if (syncConfig?.platform === 'web') {
            await clearWebSyncHandle(current.file.id).catch(() => undefined)
          }
          await unwatchSyncFolder().catch(() => undefined)
        }
        await deleteVaultKey(BRIDGE_KEYCHAIN_ACCOUNT)
        window.dispatchEvent(new Event('coffre:bridge-forget'))
        apply(() => ({ ...initialState, status: 'empty' }))
      }),
    [apply, enqueue],
  )

  const restoreFromBackup = useCallback(
    (password: string, generation = 1) =>
      enqueue(async () => {
        const backup = await loadBackupVaultFile(generation)
        if (!backup) throw new Error('Aucune sauvegarde locale disponible')
        if (getTravelMode(backup.id)?.enabled) {
          throw new Error(
            'Désactivez le mode voyage avant de restaurer une sauvegarde.',
          )
        }
        await requireVaultLock()
        let opened: OpenedVault
        try {
          opened = await finalizeOpen(await unlockVaultFile(backup, password), {
            acceptRollback: true,
          })
          opened = await saveOpenedFile(opened)
        } catch (error) {
          releaseVaultLock()
          throw error
        }
        const previous = stateRef.current
        previous.session?.lock()
        epochRef.current += 1
        apply(() => ({
          status: 'unlocked',
          file: opened.file,
          session: opened.session,
          vaults: opened.vaults,
          templates: opened.templates,
          activity: opened.activity,
          aliasKeys: opened.aliasKeys,
          items: opened.items,
          warnings: opened.warnings,
          error: null,
          readOnly: opened.readOnly,
          syncPending: false,
          syncRevision: 0,
        }))
        if (previous.file && previous.file.id !== opened.file.id) {
          biometricKeyFileRef.current = null
          await deleteVaultKey(previous.file.id)
          await deleteBiometricKey(previous.file.id)
        }
        rememberCurrentKey(true)
      }),
    [apply, enqueue, finalizeOpen, rememberCurrentKey, requireVaultLock, saveOpenedFile],
  )

  const configureSync = useCallback(
    (baseDir: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!isTauriRuntime()) {
          throw new Error('La synchronisation par dossier est disponible sur desktop.')
        }
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) {
          throw new Error('Le coffre est ouvert en lecture seule.')
        }
        const existing = getSyncConfig(current.file.id)
        const deviceId = existing?.deviceId ?? newSyncDeviceId()
        const dir = await prepareSyncFolder(baseDir, current.file.id)
        const config: SyncConfig = {
          version: 1,
          platform: 'desktop',
          fileId: current.file.id,
          baseDir,
          dir,
          deviceId,
          lastSyncAt: existing?.lastSyncAt,
          lastConflicts: existing?.lastConflicts,
        }
        syncIgnoreUntilRef.current = Date.now() + 4_000
        try {
          await writeSyncFile(
            dir,
            syncDeviceFileName(config),
            serializeVault(current.file, false),
          )
        } catch (error) {
          removeSyncConfig(current.file.id)
          throw error
        }
        saveSyncConfig(config)
        apply((previous) => ({
          ...previous,
          syncPending: false,
          syncRevision: previous.syncRevision + 1,
        }))
        return config
      }),
    [apply, enqueue],
  )

  const configureWebSync = useCallback(
    (handle: FileSystemDirectoryHandle) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) {
          throw new Error('Le coffre est ouvert en lecture seule.')
        }
        const existing = getSyncConfig(current.file.id)
        const deviceId = existing?.deviceId ?? newSyncDeviceId()
        const label = await prepareWebSyncDirectory(handle, current.file.id)
        const config: SyncConfig = {
          version: 1,
          platform: 'web',
          fileId: current.file.id,
          baseDir: handle.name,
          dir: label,
          deviceId,
          lastSyncAt: existing?.lastSyncAt,
          lastConflicts: existing?.lastConflicts,
        }
        try {
          await saveWebSyncHandle(current.file.id, handle)
          await writeWebSyncFile(
            handle,
            current.file.id,
            syncDeviceFileName(config),
            serializeVault(current.file, false),
          )
        } catch (error) {
          await clearWebSyncHandle(current.file.id).catch(() => undefined)
          removeSyncConfig(current.file.id)
          throw error
        }
        saveSyncConfig(config)
        apply((previous) => ({
          ...previous,
          syncPending: false,
          syncRevision: previous.syncRevision + 1,
        }))
        return config
      }),
    [apply, enqueue],
  )

  const disableSync = useCallback(
    () =>
      enqueue(async () => {
        const current = stateRef.current
        if (current.file) {
          const config = getSyncConfig(current.file.id)
          removeSyncConfig(current.file.id)
          if (config?.platform === 'web') {
            await clearWebSyncHandle(current.file.id).catch(() => undefined)
          }
        }
        await unwatchSyncFolder().catch(() => undefined)
        apply((previous) => ({
          ...previous,
          syncPending: false,
          syncRevision: previous.syncRevision + 1,
        }))
      }),
    [apply, enqueue],
  )

  const syncNow = useCallback(
    (password?: string) =>
      enqueue(async (): Promise<SyncRunResult> => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) {
          throw new Error('Le coffre est ouvert en lecture seule.')
        }
        if (getTravelMode(current.file.id)?.enabled) {
          throw new Error(
            'Le mode voyage est actif. Désactivez-le pour synchroniser sans écraser les coffres masqués.',
          )
        }
        const config = getSyncConfig(current.file.id)
        if (!config) throw new Error('Aucun dossier de synchronisation configuré.')

        const ownName = syncDeviceFileName(config)
        const fileId = current.file.id
        let io: {
          list: () => Promise<SyncFileInfo[]>
          read: (name: string) => Promise<string | null>
          write: (name: string, contents: string) => Promise<void>
        }
        if (config.platform === 'web') {
          const handle = await loadWebSyncHandle(fileId)
          if (!handle) {
            throw new Error(
              'Le dossier Web n’est plus accessible. Choisissez-le à nouveau.',
            )
          }
          if (!(await ensureWebSyncPermission(handle))) {
            throw new Error('L’accès au dossier de synchronisation a été refusé.')
          }
          io = {
            list: () => listWebSyncFiles(handle, fileId),
            read: (name) => readWebSyncFile(handle, fileId, name),
            write: (name, contents) =>
              writeWebSyncFile(handle, fileId, name, contents),
          }
        } else {
          io = {
            list: () => listSyncFiles(config.dir),
            read: (name) => readSyncFile(config.dir, name),
            write: (name, contents) =>
              writeSyncFile(config.dir, name, contents),
          }
        }
        syncIgnoreUntilRef.current = Date.now() + 4_000

        // Snapshot local avant lecture : les autres appareils peuvent le voir
        // même si la fusion échoue ensuite.
        await io.write(ownName, serializeVault(current.file, false))

        const warnings: string[] = []
        const remotes: VaultFile[] = []
        const entries = await io.list()
        for (const entry of entries) {
          if (!entry.name.endsWith('.coffre')) continue
          if (entry.name === ownName) continue
          try {
            const text = await io.read(entry.name)
            if (!text) continue
            remotes.push(parseVaultFileText(text))
          } catch {
            warnings.push(`Le fichier « ${entry.name} » est illisible et a été ignoré.`)
          }
        }

        const result = await reconcileVaultFiles({
          local: current.file,
          session: current.session,
          remotes,
          password,
        })
        warnings.push(...result.warnings)

        let signed = current.file
        let opened: OpenedVault | null = null
        if (result.session !== current.session || result.file !== current.file) {
          try {
            signed = await persistWithSession(
              result.session,
              current.file,
              result.file,
            )
          } catch (error) {
            if (result.session !== current.session) result.session.lock()
            throw error
          }
          try {
            await io.write(ownName, serializeVault(signed, false))
          } catch {
            warnings.push(
              'Le fichier fusionné n’a pas pu être réécrit dans le dossier synchronisé.',
            )
          }
          try {
            opened = await openVaultFileWithMasterKey(
              signed,
              result.session.masterKey,
            )
          } catch {
            current.session.lock()
            if (result.session !== current.session) result.session.lock()
            lock()
            throw new Error(
              'Le coffre fusionné n’a pas pu être rouvert. Déverrouillez-le à nouveau.',
            )
          }
        }

        const now = new Date().toISOString()
        saveSyncConfig({
          ...config,
          lastSyncAt: now,
          lastConflicts: result.conflicts.length,
          lastWarning:
            warnings.length > 0
              ? warnings.slice(0, 3).join(' · ').slice(0, 500)
              : undefined,
        })
        syncIgnoreUntilRef.current = Date.now() + 2_000
        if (config.platform !== 'web') {
          try {
            await exportBlobsToDirectory(
              config.dir,
              referencedBlobIds(opened?.items ?? current.items),
            )
            await importBlobsFromDirectory(config.dir)
          } catch {
            warnings.push(
              'Les documents chiffrés n’ont pas pu être synchronisés avec le dossier.',
            )
          }
        }

        if (opened) {
          const previousSession = current.session
          current.session.lock()
          if (result.session !== previousSession) result.session.lock()
          epochRef.current += 1
          apply((previous) => ({
            ...previous,
            file: signed,
            session: opened.session,
            vaults: opened.vaults,
            templates: opened.templates,
            activity: opened.activity,
            aliasKeys: opened.aliasKeys,
            items: opened.items,
            warnings: opened.warnings,
            error: null,
            readOnly: opened.readOnly,
            syncPending: false,
            syncRevision: previous.syncRevision + 1,
          }))
        } else {
          apply((previous) => ({
            ...previous,
            syncPending: false,
            syncRevision: previous.syncRevision + 1,
          }))
        }

        return {
          conflicts: result.conflicts.length,
          warnings,
          adoptedEpoch: result.adoptedEpoch,
        }
      }),
    [apply, enqueue, lock, persistWithSession],
  )

  const lanSync = useCallback(
    (remoteText: string, password?: string) =>
      enqueue(async (): Promise<SyncRunResult> => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        if (current.readOnly) {
          throw new Error('Le coffre est ouvert en lecture seule.')
        }
        let remote: VaultFile
        try {
          remote = parseVaultFileText(remoteText)
        } catch {
          throw new Error('Le fichier reçu par le réseau local est illisible.')
        }

        const result = await reconcileVaultFiles({
          local: current.file,
          session: current.session,
          remotes: [remote],
          password,
        })
        const warnings = [...result.warnings]
        let signed = current.file
        let opened: OpenedVault | null = null
        if (result.session !== current.session || result.file !== current.file) {
          try {
            signed = await persistWithSession(
              result.session,
              current.file,
              result.file,
            )
          } catch (error) {
            if (result.session !== current.session) result.session.lock()
            throw error
          }
          try {
            opened = await openVaultFileWithMasterKey(
              signed,
              result.session.masterKey,
            )
          } catch {
            current.session.lock()
            if (result.session !== current.session) result.session.lock()
            lock()
            throw new Error(
              'Le coffre fusionné n’a pas pu être rouvert. Déverrouillez-le à nouveau.',
            )
          }
        }

        syncIgnoreUntilRef.current = Date.now() + 2_000
        if (opened) {
          const previousSession = current.session
          current.session.lock()
          if (result.session !== previousSession) result.session.lock()
          epochRef.current += 1
          apply((previous) => ({
            ...previous,
            file: signed,
            session: opened.session,
            vaults: opened.vaults,
            templates: opened.templates,
            activity: opened.activity,
            aliasKeys: opened.aliasKeys,
            items: opened.items,
            warnings: opened.warnings,
            error: null,
            readOnly: opened.readOnly,
            syncPending: false,
            syncRevision: previous.syncRevision + 1,
          }))
        } else {
          apply((previous) => ({
            ...previous,
            syncPending: false,
            syncRevision: previous.syncRevision + 1,
          }))
        }

        return {
          conflicts: result.conflicts.length,
          warnings,
          adoptedEpoch: result.adoptedEpoch,
        }
      }),
    [apply, enqueue, lock, persistWithSession],
  )

  const confirmMasterPassword = useCallback(
    (password: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const candidate = await deriveMasterKey(password, current.file.kdf)
        try {
          return !current.session.locked && equalBytes(candidate, current.session.masterKey)
        } finally {
          wipe(candidate)
        }
      }),
    [enqueue],
  )

  const recordActivity = useCallback(
    (kind: ActivityKind, detail: string, host?: string) =>
      enqueue(async () => {
        try {
          const current = stateRef.current
          if (!current.file || !current.session || current.readOnly) return
          const result = await appendActivity(current.file, current.session, {
            kind,
            detail,
            host,
          })
          const file = await persist(current.file, result.file)
          apply((previous) => ({
            ...previous,
            file,
            activity: [result.event, ...previous.activity].slice(0, 5_000),
          }))
        } catch {
          // Le journal est accessoire : une erreur ne doit pas bloquer l’action.
        }
      }),
    [apply, enqueue, persist],
  )

  const verifyBackup = useCallback(
    async (
      contents: string,
      password?: string,
    ): Promise<{
      items: number
      vaults: number
      currentItems: number
      integrity: 'valid' | 'unsigned' | 'invalid'
    }> => {
      const parsed = parseVaultFileText(contents)
      const current = stateRef.current
      let opened: OpenedVault
      if (password) {
        opened = await unlockVaultFile(parsed, password)
      } else {
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        opened = await openVaultFileWithMasterKey(
          parsed,
          current.session.masterKey,
        )
      }
      try {
        await verifyVaultFile(opened.file, opened.session)
        return {
          items: opened.items.length,
          vaults: opened.vaults.length,
          currentItems: current.items.length,
          integrity: opened.integrity,
        }
      } finally {
        opened.session.lock()
      }
    },
    [],
  )

  const setAliasKey = useCallback(
    (service: AliasKeyService, key: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const next = await setAliasKeyInFile(current.file, current.session, service, key)
        const file = await persist(current.file, next)
        apply((previous) => ({
          ...previous,
          file,
          aliasKeys: { ...previous.aliasKeys, [service]: key.trim() },
        }))
      }),
    [apply, enqueue, persist],
  )

  const deleteAliasKey = useCallback(
    (service: AliasKeyService) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const file = await persist(
          current.file,
          deleteAliasKeyInFile(current.file, service),
        )
        apply((previous) => {
          const aliasKeys = { ...previous.aliasKeys }
          delete aliasKeys[service]
          return { ...previous, file, aliasKeys }
        })
      }),
    [apply, enqueue, persist],
  )

  const dismissWarnings = useCallback(() => {
    apply((previous) => ({ ...previous, warnings: [] }))
  }, [apply])

  const value: VaultContextValue = {
    ...state,
    create,
    unlock,
    unlockWithBiometrics,
    unlockWithPrf,
    enrollPrf,
    removePrf,
    getSharingIdentity,
    createSharingIdentity,
    createSharingPackage,
    createSharingBundle,
    importSharingPackage,
    getVaultSharing,
    revokeSharingMember,
    configureSharedFolder,
    configureWebSharedFolder,
    disableSharedSync,
    syncSharedVault,
    getSharedSyncStatus,
    getEmergencyAccess,
    createEmergencyAccess,
    createShamirEmergencyAccess,
    removeEmergencyAccess,
    resetBiometricKey,
    lock,
    addVault,
    renameVault,
    deleteVault,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    enableTravelMode,
    disableTravelMode,
    addItem,
    updateItem,
    moveItem,
    trashItem,
    trashItems,
    favoriteItems,
    restoreItem,
    deleteItemPermanently,
    emptyTrash,
    getItemVersions,
    restoreItemVersion,
    addAttachment,
    removeAttachment,
    downloadAttachment,
    importItems,
    changePassword,
    setRecoveryPhrase,
    recoverWithPhrase,
    createRecoveryShares,
    recoverWithShares,
    exportVault,
    importVault,
    verify,
    reset,
    restoreFromBackup,
    configureSync,
    configureWebSync,
    disableSync,
    syncNow,
    lanSync,
    confirmMasterPassword,
    recordActivity,
    verifyBackup,
    setAliasKey,
    deleteAliasKey,
    dismissWarnings,
  }

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext)
  if (!context) throw new Error('useVault doit être utilisé dans VaultProvider')
  return context
}
