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
  saveVaultFile,
} from '../lib/storage'
import {
  addAttachment as addAttachmentToFile,
  addVault as addVaultToFile,
  changeMasterPassword,
  createItem,
  createVaultFile,
  deleteItem,
  deleteItems,
  deleteVault as deleteVaultFromFile,
  disableRecovery,
  enableRecovery,
  listItemVersions,
  openAttachment,
  openVaultFileWithMasterKey,
  parseVaultFileText,
  recoverVaultFile,
  removeAttachment as removeAttachmentFromFile,
  renameVault as renameVaultInFile,
  restoreItem as restoreItemFromFile,
  restoreItemVersion as restoreItemVersionInFile,
  serializeVault,
  trashItem as trashItemInFile,
  unlockVaultFile,
  updateItem as updateItemInFile,
  vaultFileName,
  verifyVaultFile,
  VaultLockedError,
  VaultValidationError,
  type ItemVersion,
  type OpenedVault,
  type RekeyedVault,
  type VaultIntegrityReport,
  type VaultSession,
} from '../lib/vault'
import { deriveMasterKey, fromBase64, toBase64, wipe } from '../lib/crypto'
import { deleteVaultKey, loadVaultKey, storeVaultKey } from '../lib/keychain'
import {
  deleteBiometricKey,
  loadBiometricKey,
  storeBiometricKey,
} from '../lib/biometrics'
import { clearUsage } from '../lib/usage'
import { clearClipboardIfLastCopied } from '../lib/clipboard'
import { acquireVaultLock, releaseVaultLock } from '../lib/tabLock'
import { downloadBytes, downloadFile } from '../lib/settings'
import {
  MAX_ATTACHMENT_BYTES,
  type ItemDraft,
  type VaultFile,
  type VaultItem,
  type VaultStatus,
  type VaultSummary,
} from '../lib/types'
import { useSettings } from './SettingsProvider'

export interface ImportResult {
  imported: number
  warnings: string[]
}

interface ProviderState {
  status: VaultStatus
  file: VaultFile | null
  session: VaultSession | null
  vaults: VaultSummary[]
  items: VaultItem[]
  warnings: string[]
  error: string | null
}

interface VaultContextValue extends ProviderState {
  create: (password: string, vaultName?: string) => Promise<void>
  unlock: (password: string) => Promise<void>
  /** Déverrouille après une authentification Touch ID ; false si annulée. */
  unlockWithBiometrics: () => Promise<boolean>
  /** Supprime puis réenregistre la clé biométrique du coffre courant. */
  resetBiometricKey: () => Promise<void>
  lock: () => void
  /** Vérifie le mot de passe maître sans changer l’état (export en clair). */
  confirmMasterPassword: (password: string) => Promise<boolean>
  addVault: (name: string) => Promise<void>
  renameVault: (vaultId: string, name: string) => Promise<void>
  deleteVault: (vaultId: string) => Promise<void>
  addItem: (draft: ItemDraft) => Promise<VaultItem>
  updateItem: (item: VaultItem) => Promise<VaultItem>
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
  exportVault: () => void
  importVault: (text: string, password: string) => Promise<void>
  verify: () => Promise<VaultIntegrityReport>
  reset: () => Promise<void>
  restoreFromBackup: (password: string, generation?: number) => Promise<void>
  dismissWarnings: () => void
}

const initialState: ProviderState = {
  status: 'loading',
  file: null,
  session: null,
  vaults: [],
  items: [],
  warnings: [],
  error: null,
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

function unlockedState(opened: OpenedVault): ProviderState {
  return {
    status: 'unlocked',
    file: opened.file,
    session: opened.session,
    vaults: opened.vaults,
    items: opened.items,
    warnings: opened.warnings,
    error: null,
  }
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
  // Identifiant du coffre dont la clé biométrique est déjà rangée. Évite de
  // réécrire l’entrée du trousseau à chaque déverrouillage, ce qui redéclenche
  // l’autorisation d’accès macOS.
  const biometricKeyFileRef = useRef<string | null>(null)

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

  /**
   * Enregistre `next`, calculé à partir de `base`. L’écriture est refusée si le
   * fichier enregistré n’est plus `base` (un autre onglet l’a modifié).
   */
  const persist = useCallback(
    (base: VaultFile, next: VaultFile) => saveVaultFile(next, { expected: base }),
    [],
  )

  /**
   * Applique le résultat d’une écriture réussie. Si le coffre a été verrouillé
   * pendant l’écriture, le fichier chiffré enregistré devient quand même la
   * référence (sinon le prochain déverrouillage repartirait d’une copie
   * périmée et l’écriture suivante effacerait la modification), mais aucun
   * contenu déchiffré n’est réinjecté dans l’état verrouillé.
   */
  const commit = useCallback(
    (
      epoch: number,
      file: VaultFile,
      update?: (previous: ProviderState) => Partial<ProviderState>,
    ) => {
      apply((previous) => {
        if (epochRef.current !== epoch) {
          return previous.file?.id === file.id ? { ...previous, file } : previous
        }
        return { ...previous, ...(update ? update(previous) : {}), file }
      })
    },
    [apply],
  )

  /**
   * Relit le fichier enregistré avant un déverrouillage : un autre onglet a pu
   * l’enregistrer depuis le chargement de celui-ci.
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

  /**
   * Purge les éléments dont la date de suppression dépasse la rétention
   * configurée. Si l’écriture échoue, le coffre reste ouvrable : on conserve
   * simplement la corbeille et on ajoute un avertissement.
   */
  const applyTrashRetention = useCallback(
    async (opened: OpenedVault, base?: VaultFile): Promise<OpenedVault> => {
      const expired = expiredTrashIds(opened.items, settingsRef.current.trashRetentionDays)
      if (expired.length === 0) return opened

      try {
        const file = deleteItems(opened.file, expired)
        await saveVaultFile(file, base ? { expected: base } : {})
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
    },
    [],
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
              const opened = await applyTrashRetention(
                await openVaultFileWithMasterKey(file, masterKey),
                file,
              )
              if (cancelled) {
                opened.session.lock()
                releaseVaultLock()
                return
              }
              epochRef.current += 1
              apply(() => unlockedState(opened))
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
  }, [apply, applyTrashRetention])

  /** Refuse l’ouverture si un autre onglet détient déjà la session. */
  const requireVaultLock = useCallback(async () => {
    if (await acquireVaultLock()) return
    throw new Error(
      'Coffre est déjà ouvert dans un autre onglet. Fermez cet onglet ou verrouillez-le avant de continuer.',
    )
  }, [])

  /**
   * Verrouille la session. `forgetQuickUnlock` retire aussi la clé du
   * trousseau silencieux : c’est le cas d’un verrouillage explicite, par
   * inactivité ou en arrière-plan. À la fermeture de la page, la clé est
   * conservée, ce qui est le but du déverrouillage rapide au relancement.
   */
  const lockWith = useCallback(
    (forgetQuickUnlock: boolean) => {
      const current = stateRef.current
      if (current.status !== 'unlocked') return
      epochRef.current += 1
      current.session?.lock()
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
      }))
    },
    [apply],
  )

  const lock = useCallback(() => lockWith(true), [lockWith])

  useEffect(() => {
    // Fermeture, rechargement ou mise en cache (bfcache) : la session est
    // effacée et l’état passe à « verrouillé », pour qu’une page restaurée
    // depuis le cache ne présente jamais un coffre ouvert sans clés.
    const onPageHide = () => lockWith(false)
    window.addEventListener('beforeunload', onPageHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('beforeunload', onPageHide)
      window.removeEventListener('pagehide', onPageHide)
      stateRef.current.session?.lock()
      releaseVaultLock()
    }
  }, [lockWith])

  /**
   * Remplace la session courante par un coffre ouvert depuis une autre source
   * (import, sauvegarde, récupération). En cas d’échec d’écriture, la nouvelle
   * session est effacée et le verrou d’onglet n’est relâché que s’il n’était
   * pas déjà détenu par la session courante.
   */
  const adoptOpened = useCallback(
    async (opened: OpenedVault, hadLock: boolean) => {
      try {
        await saveVaultFile(opened.file)
      } catch (error) {
        opened.session.lock()
        if (!hadLock) releaseVaultLock()
        throw error
      }
      const previous = stateRef.current
      if (previous.session !== opened.session) previous.session?.lock()
      epochRef.current += 1
      apply(() => unlockedState(opened))
      if (previous.file && previous.file.id !== opened.file.id) {
        biometricKeyFileRef.current = null
        await deleteVaultKey(previous.file.id)
        await deleteBiometricKey(previous.file.id)
      }
      rememberCurrentKey(true)
    },
    [apply, rememberCurrentKey],
  )

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
          await saveVaultFile(opened.file)
        } catch (error) {
          opened.session.lock()
          releaseVaultLock()
          throw error
        }
        epochRef.current += 1
        apply(() => unlockedState(opened))
        rememberCurrentKey()
      }),
    [apply, enqueue, rememberCurrentKey, requireVaultLock],
  )

  const unlock = useCallback(
    (password: string) =>
      enqueue(async () => {
        if (!stateRef.current.file) throw new Error('Aucun coffre local à déverrouiller')
        await requireVaultLock()
        let opened: OpenedVault
        try {
          const file = await reloadFile()
          opened = await applyTrashRetention(await unlockVaultFile(file, password), file)
        } catch (error) {
          releaseVaultLock()
          throw error
        }
        epochRef.current += 1
        apply(() => unlockedState(opened))
        rememberCurrentKey()
      }),
    [apply, applyTrashRetention, enqueue, reloadFile, rememberCurrentKey, requireVaultLock],
  )

  const unlockWithBiometrics = useCallback(
    () =>
      enqueue(async () => {
        if (!stateRef.current.file) throw new Error('Aucun coffre local à déverrouiller')
        await requireVaultLock()

        let file: VaultFile
        let result: Awaited<ReturnType<typeof loadBiometricKey>>
        try {
          file = await reloadFile()
          result = await loadBiometricKey(file.id)
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
          await deleteBiometricKey(file.id)
          throw new Error(
            'Aucune clé biométrique n’est enregistrée pour ce coffre. Déverrouillez avec le mot de passe, puis réactivez Touch ID.',
          )
        }

        const masterKey = fromBase64(result.secret)
        try {
          const opened = await applyTrashRetention(
            await openVaultFileWithMasterKey(file, masterKey),
            file,
          )
          epochRef.current += 1
          biometricKeyFileRef.current = file.id
          apply(() => unlockedState(opened))
          return true
        } catch {
          // Clé périmée (mot de passe changé, fichier remplacé) : on nettoie.
          releaseVaultLock()
          biometricKeyFileRef.current = null
          await deleteBiometricKey(file.id)
          throw new Error(
            'La clé biométrique n’est plus valide. Déverrouillez avec le mot de passe, puis réactivez Touch ID.',
          )
        } finally {
          wipe(masterKey)
        }
      }),
    [apply, applyTrashRetention, enqueue, reloadFile, requireVaultLock],
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

  const addVault = useCallback(
    (name: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const result = await addVaultToFile(current.file, current.session, name)
        await persist(current.file, result.file)
        commit(epoch, result.file, (previous) => ({
          vaults: [...previous.vaults, result.vault],
        }))
      }),
    [commit, enqueue, persist],
  )

  const renameVault = useCallback(
    (vaultId: string, name: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const file = await renameVaultInFile(current.file, current.session, vaultId, name)
        await persist(current.file, file)
        commit(epoch, file, (previous) => ({
          vaults: previous.vaults.map((vault) =>
            vault.id === vaultId ? { ...vault, name: name.trim() } : vault,
          ),
        }))
      }),
    [commit, enqueue, persist],
  )

  const deleteVault = useCallback(
    (vaultId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const file = await deleteVaultFromFile(current.file, current.session, vaultId)
        await persist(current.file, file)
        // La clé n’est retirée qu’une fois le fichier sans ce coffre enregistré.
        current.session.removeVaultKey(vaultId)
        commit(epoch, file, (previous) => ({
          vaults: previous.vaults.filter((vault) => vault.id !== vaultId),
          items: previous.items.filter((item) => item.vaultId !== vaultId),
        }))
      }),
    [commit, enqueue, persist],
  )

  const addItem = useCallback(
    (draft: ItemDraft) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const result = await createItem(current.file, current.session, draft)
        await persist(current.file, result.file)
        commit(epoch, result.file, (previous) => ({
          items: [...previous.items, result.item],
          vaults: previous.vaults.map((vault) =>
            vault.id === result.item.vaultId
              ? { ...vault, itemCount: vault.itemCount + 1 }
              : vault,
          ),
        }))
        return result.item
      }),
    [commit, enqueue, persist],
  )

  const updateItem = useCallback(
    (item: VaultItem) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const result = await updateItemInFile(current.file, current.session, item)
        await persist(current.file, result.file)
        commit(epoch, result.file, (previous) => ({
          items: previous.items.map((candidate) =>
            candidate.id === result.item.id ? result.item : candidate,
          ),
        }))
        return result.item
      }),
    [commit, enqueue, persist],
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
        await persist(current.file, result.file)
        commit(epoch, result.file, (previous) => ({
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
    [commit, enqueue, persist],
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
        let file = current.file
        const trashed: VaultItem[] = []
        for (const item of existing) {
          if (epochRef.current !== epoch) throw new VaultLockedError()
          const result = await trashItemInFile(file, current.session, item.id)
          file = result.file
          trashed.push(result.item)
        }
        await persist(current.file, file)

        const counts = new Map<string, number>()
        for (const item of existing) {
          counts.set(item.vaultId, (counts.get(item.vaultId) ?? 0) + 1)
        }
        commit(epoch, file, (previous) => ({
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
    [commit, enqueue, persist],
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
        let file = current.file
        const changed: VaultItem[] = []
        for (const item of existing) {
          if (epochRef.current !== epoch) throw new VaultLockedError()
          const result = await updateItemInFile(file, current.session, {
            ...item,
            favorite,
          })
          file = result.file
          changed.push(result.item)
        }
        await persist(current.file, file)
        commit(epoch, file, (previous) => ({
          items: previous.items.map(
            (item) => changed.find((entry) => entry.id === item.id) ?? item,
          ),
        }))
        return changed.length
      }),
    [commit, enqueue, persist],
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
        await persist(current.file, result.file)
        commit(epoch, result.file, (previous) => ({
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
    [commit, enqueue, persist],
  )

  const deleteItemPermanently = useCallback(
    (itemId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const existing = current.items.find((item) => item.id === itemId)
        if (!existing) return
        const epoch = epochRef.current
        const file = await deleteItem(current.file, itemId)
        await persist(current.file, file)
        commit(epoch, file, (previous) => ({
          items: previous.items.filter((item) => item.id !== itemId),
          vaults: previous.vaults.map((vault) =>
            vault.id === existing.vaultId && !existing.deletedAt
              ? { ...vault, itemCount: Math.max(0, vault.itemCount - 1) }
              : vault,
          ),
        }))
      }),
    [commit, enqueue, persist],
  )

  const emptyTrash = useCallback(
    () =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const ids = current.items
          .filter((item) => item.deletedAt)
          .map((item) => item.id)
        if (ids.length === 0) return 0

        const epoch = epochRef.current
        const file = deleteItems(current.file, ids)
        await persist(current.file, file)
        const removed = new Set(ids)
        commit(epoch, file, (previous) => ({
          items: previous.items.filter((item) => !removed.has(item.id)),
        }))
        return ids.length
      }),
    [commit, enqueue, persist],
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
        await persist(current.file, result.file)
        commit(epoch, result.file, (previous) => ({
          items: previous.items.map((item) =>
            item.id === result.item.id ? result.item : item,
          ),
        }))
        return result.item
      }),
    [commit, enqueue, persist],
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
          await persist(current.file, result.file)
          commit(epoch, result.file, (previous) => ({
            items: previous.items.map((candidate) =>
              candidate.id === result.item.id ? result.item : candidate,
            ),
          }))
          return result.item
        } finally {
          wipe(bytes)
        }
      }),
    [commit, enqueue, persist],
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
        await persist(current.file, result.file)
        commit(epoch, result.file, (previous) => ({
          items: previous.items.map((candidate) =>
            candidate.id === result.item.id ? result.item : candidate,
          ),
        }))
        return result.item
      }),
    [commit, enqueue, persist],
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

        // L’époque est capturée avant la boucle : un verrouillage pendant
        // l’import l’annule entièrement, sans écriture partielle.
        const epoch = epochRef.current
        const interrupted = () =>
          new Error('Le coffre a été verrouillé pendant l’import ; aucun élément n’a été ajouté.')
        let file = current.file
        const created: VaultItem[] = []
        const warnings: string[] = []

        for (const draft of drafts) {
          if (epochRef.current !== epoch || current.session.locked) throw interrupted()
          try {
            const result = await createItem(file, current.session, draft)
            file = result.file
            created.push(result.item)
          } catch (error) {
            if (error instanceof VaultLockedError) throw interrupted()
            warnings.push(
              `« ${draft.title || 'Sans titre'} » : ${
                error instanceof Error ? error.message : 'import impossible'
              }`,
            )
          }
        }

        if (created.length === 0) return { imported: 0, warnings }
        if (epochRef.current !== epoch) throw interrupted()

        await persist(current.file, file)
        commit(epoch, file, (previous) => {
          const items = [...previous.items, ...created]
          return {
            items,
            vaults: previous.vaults.map((vault) => ({
              ...vault,
              itemCount: items.filter(
                (item) => item.vaultId === vault.id && !item.deletedAt,
              ).length,
            })),
          }
        })

        return { imported: created.length, warnings }
      }),
    [commit, enqueue, persist],
  )

  /**
   * Enregistre un fichier dont les clés ont changé, puis installe les
   * nouvelles clés dans la session. Si l’écriture échoue, les nouvelles clés
   * sont effacées et la session reste celle du fichier encore sur disque.
   */
  const commitRekey = useCallback(
    async (base: VaultFile, session: VaultSession, rekeyed: RekeyedVault) => {
      const epoch = epochRef.current
      try {
        await persist(base, rekeyed.file)
      } catch (error) {
        rekeyed.discard()
        throw error
      }
      if (epochRef.current !== epoch || session.locked) {
        // Verrouillé pendant l’écriture : le fichier enregistré devient la
        // référence ; les nouvelles clés ne servent plus.
        rekeyed.discard()
        commit(epoch, rekeyed.file)
        return false
      }
      rekeyed.install(session)
      commit(epoch, rekeyed.file)
      return true
    },
    [commit, persist],
  )

  const changePassword = useCallback(
    (currentPassword: string, newPassword: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')

        const candidate = await deriveMasterKey(currentPassword, current.file.kdf)
        const matches = equalBytes(candidate, current.session.masterKey)
        wipe(candidate)
        if (!matches) throw new Error('Le mot de passe actuel est incorrect')

        const rekeyed = await changeMasterPassword(current.file, current.session, newPassword)
        const installed = await commitRekey(current.file, current.session, rekeyed)
        // La session porte désormais la nouvelle clé maîtresse : le
        // déverrouillage rapide est mis à jour à partir d’elle.
        if (installed) rememberCurrentKey(true)
      }),
    [commitRekey, enqueue, rememberCurrentKey],
  )

  const setRecoveryPhrase = useCallback(
    (phrase: string | null) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const rekeyed = phrase
          ? await enableRecovery(current.file, current.session, phrase)
          : await disableRecovery(current.file, current.session)
        await commitRekey(current.file, current.session, rekeyed)
      }),
    [commitRekey, enqueue],
  )

  const recoverWithPhrase = useCallback(
    (phrase: string, newPassword: string) =>
      enqueue(async () => {
        if (!stateRef.current.file) throw new Error('Aucun coffre local à récupérer')
        const hadLock = stateRef.current.status === 'unlocked'
        await requireVaultLock()

        let opened: OpenedVault
        try {
          const file = await reloadFile()
          opened = await applyTrashRetention(
            await recoverVaultFile(file, phrase, newPassword),
          )
        } catch (error) {
          if (!hadLock) releaseVaultLock()
          throw error
        }
        await adoptOpened(opened, hadLock)
      }),
    [adoptOpened, applyTrashRetention, enqueue, reloadFile, requireVaultLock],
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
        const hadLock = stateRef.current.status === 'unlocked'
        await requireVaultLock()
        let opened: OpenedVault
        try {
          const file = parseVaultFileText(text)
          opened = await applyTrashRetention(await unlockVaultFile(file, password))
        } catch (error) {
          if (!hadLock) releaseVaultLock()
          throw error
        }
        await adoptOpened(opened, hadLock)
      }),
    [adoptOpened, applyTrashRetention, enqueue, requireVaultLock],
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
        current.session?.lock()
        releaseVaultLock()
        void clearClipboardIfLastCopied()
        if (current.file) {
          biometricKeyFileRef.current = null
          await deleteVaultKey(current.file.id)
          await deleteBiometricKey(current.file.id)
        }
        apply(() => ({ ...initialState, status: 'empty' }))
      }),
    [apply, enqueue],
  )

  const restoreFromBackup = useCallback(
    (password: string, generation = 1) =>
      enqueue(async () => {
        const backup = await loadBackupVaultFile(generation)
        if (!backup) throw new Error('Aucune sauvegarde locale disponible')
        const hadLock = stateRef.current.status === 'unlocked'
        await requireVaultLock()
        let opened: OpenedVault
        try {
          opened = await applyTrashRetention(await unlockVaultFile(backup, password))
        } catch (error) {
          if (!hadLock) releaseVaultLock()
          throw error
        }
        await adoptOpened(opened, hadLock)
      }),
    [adoptOpened, applyTrashRetention, enqueue, requireVaultLock],
  )

  const dismissWarnings = useCallback(() => {
    apply((previous) => ({ ...previous, warnings: [] }))
  }, [apply])

  const value: VaultContextValue = {
    ...state,
    create,
    unlock,
    unlockWithBiometrics,
    resetBiometricKey,
    lock,
    confirmMasterPassword,
    addVault,
    renameVault,
    deleteVault,
    addItem,
    updateItem,
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
    exportVault,
    importVault,
    verify,
    reset,
    restoreFromBackup,
    dismissWarnings,
  }

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext)
  if (!context) throw new Error('useVault doit être utilisé dans VaultProvider')
  return context
}
