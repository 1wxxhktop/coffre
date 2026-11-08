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
  VaultValidationError,
  type ItemVersion,
  type OpenedVault,
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
   * Purge les éléments dont la date de suppression dépasse la rétention
   * configurée. Si l’écriture échoue, le coffre reste ouvrable : on conserve
   * simplement la corbeille et on ajoute un avertissement.
   */
  const applyTrashRetention = useCallback(async (opened: OpenedVault): Promise<OpenedVault> => {
    const expired = expiredTrashIds(opened.items, settingsRef.current.trashRetentionDays)
    if (expired.length === 0) return opened

    try {
      const file = deleteItems(opened.file, expired)
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
                items: opened.items,
                warnings: opened.warnings,
                error: null,
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
  }, [apply, applyTrashRetention])

  useEffect(() => {
    const onBeforeUnload = () => {
      stateRef.current.session?.lock()
      releaseVaultLock()
      void clearClipboardIfLastCopied()
    }
    const onPageHide = () => {
      stateRef.current.session?.lock()
      releaseVaultLock()
      void clearClipboardIfLastCopied()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onPageHide)
      stateRef.current.session?.lock()
      releaseVaultLock()
    }
  }, [])

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
          await saveVaultFile(opened.file)
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
          items: opened.items,
          warnings: opened.warnings,
          error: null,
        }))
        rememberCurrentKey()
      }),
    [apply, enqueue, rememberCurrentKey, requireVaultLock],
  )

  const unlock = useCallback(
    (password: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file) throw new Error('Aucun coffre local à déverrouiller')
        await requireVaultLock()
        let opened: OpenedVault
        try {
          opened = await applyTrashRetention(
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
          items: opened.items,
          warnings: opened.warnings,
          error: null,
        }))
        rememberCurrentKey()
      }),
    [apply, applyTrashRetention, enqueue, rememberCurrentKey, requireVaultLock],
  )

  const unlockWithBiometrics = useCallback(
    () =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file) throw new Error('Aucun coffre local à déverrouiller')
        await requireVaultLock()

        let result: Awaited<ReturnType<typeof loadBiometricKey>>
        try {
          result = await loadBiometricKey(current.file.id, 'Déverrouiller Coffre')
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
          const opened = await applyTrashRetention(
            await openVaultFileWithMasterKey(current.file, masterKey),
          )
          epochRef.current += 1
          biometricKeyFileRef.current = current.file.id
          apply(() => ({
            status: 'unlocked',
            file: opened.file,
            session: opened.session,
            vaults: opened.vaults,
            items: opened.items,
            warnings: opened.warnings,
            error: null,
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
    [apply, applyTrashRetention, enqueue, requireVaultLock],
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

  const lock = useCallback(() => {
    const current = stateRef.current
    if (current.status !== 'unlocked') return
    epochRef.current += 1
    current.session?.lock()
    releaseVaultLock()
    void clearClipboardIfLastCopied()
    if (current.file) {
      void deleteVaultKey(current.file.id)
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
  }, [apply])

  const addVault = useCallback(
    (name: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const result = await addVaultToFile(current.file, current.session, name)
        await saveVaultFile(result.file)
        if (epochRef.current !== epoch) return
        apply((previous) => ({
          ...previous,
          file: result.file,
          vaults: [...previous.vaults, result.vault],
        }))
      }),
    [apply, enqueue],
  )

  const renameVault = useCallback(
    (vaultId: string, name: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const file = await renameVaultInFile(current.file, current.session, vaultId, name)
        await saveVaultFile(file)
        if (epochRef.current !== epoch) return
        apply((previous) => ({
          ...previous,
          file,
          vaults: previous.vaults.map((vault) =>
            vault.id === vaultId ? { ...vault, name: name.trim() } : vault,
          ),
        }))
      }),
    [apply, enqueue],
  )

  const deleteVault = useCallback(
    (vaultId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const file = await deleteVaultFromFile(current.file, current.session, vaultId)
        await saveVaultFile(file)
        if (epochRef.current !== epoch) return
        apply((previous) => ({
          ...previous,
          file,
          vaults: previous.vaults.filter((vault) => vault.id !== vaultId),
          items: previous.items.filter((item) => item.vaultId !== vaultId),
        }))
      }),
    [apply, enqueue],
  )

  const addItem = useCallback(
    (draft: ItemDraft) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const result = await createItem(current.file, current.session, draft)
        await saveVaultFile(result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file: result.file,
          items: [...previous.items, result.item],
          vaults: previous.vaults.map((vault) =>
            vault.id === result.item.vaultId
              ? { ...vault, itemCount: vault.itemCount + 1 }
              : vault,
          ),
        }))
        return result.item
      }),
    [apply, enqueue],
  )

  const updateItem = useCallback(
    (item: VaultItem) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')
        const epoch = epochRef.current
        const result = await updateItemInFile(current.file, current.session, item)
        await saveVaultFile(result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file: result.file,
          items: previous.items.map((candidate) =>
            candidate.id === result.item.id ? result.item : candidate,
          ),
        }))
        return result.item
      }),
    [apply, enqueue],
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
        await saveVaultFile(result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file: result.file,
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
    [apply, enqueue],
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
          const result = await trashItemInFile(file, current.session, item.id)
          file = result.file
          trashed.push(result.item)
        }
        await saveVaultFile(file)
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
    [apply, enqueue],
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
          const result = await updateItemInFile(file, current.session, {
            ...item,
            favorite,
          })
          file = result.file
          changed.push(result.item)
        }
        await saveVaultFile(file)
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
    [apply, enqueue],
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
        await saveVaultFile(result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file: result.file,
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
    [apply, enqueue],
  )

  const deleteItemPermanently = useCallback(
    (itemId: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file) throw new Error('Coffre verrouillé')
        const existing = current.items.find((item) => item.id === itemId)
        if (!existing) return
        const epoch = epochRef.current
        const file = await deleteItem(current.file, itemId)
        await saveVaultFile(file)
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
    [apply, enqueue],
  )

  const emptyTrash = useCallback(
    () =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file) throw new Error('Coffre verrouillé')
        const ids = current.items
          .filter((item) => item.deletedAt)
          .map((item) => item.id)
        if (ids.length === 0) return 0

        const epoch = epochRef.current
        const file = deleteItems(current.file, ids)
        await saveVaultFile(file)
        if (epochRef.current !== epoch) return ids.length
        const removed = new Set(ids)
        apply((previous) => ({
          ...previous,
          file,
          items: previous.items.filter((item) => !removed.has(item.id)),
        }))
        return ids.length
      }),
    [apply, enqueue],
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
        await saveVaultFile(result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file: result.file,
          items: previous.items.map((item) =>
            item.id === result.item.id ? result.item : item,
          ),
        }))
        return result.item
      }),
    [apply, enqueue],
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
          await saveVaultFile(result.file)
          if (epochRef.current !== epoch) return result.item
          apply((previous) => ({
            ...previous,
            file: result.file,
            items: previous.items.map((candidate) =>
              candidate.id === result.item.id ? result.item : candidate,
            ),
          }))
          return result.item
        } finally {
          wipe(bytes)
        }
      }),
    [apply, enqueue],
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
        await saveVaultFile(result.file)
        if (epochRef.current !== epoch) return result.item
        apply((previous) => ({
          ...previous,
          file: result.file,
          items: previous.items.map((candidate) =>
            candidate.id === result.item.id ? result.item : candidate,
          ),
        }))
        return result.item
      }),
    [apply, enqueue],
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

        let file = current.file
        const created: VaultItem[] = []
        const warnings: string[] = []

        for (const draft of drafts) {
          try {
            const result = await createItem(file, current.session, draft)
            file = result.file
            created.push(result.item)
          } catch (error) {
            warnings.push(
              `« ${draft.title || 'Sans titre'} » : ${
                error instanceof Error ? error.message : 'import impossible'
              }`,
            )
          }
        }

        if (created.length === 0) return { imported: 0, warnings }

        const epoch = epochRef.current
        await saveVaultFile(file)
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
    [apply, enqueue],
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

        const epoch = epochRef.current
        const file = await changeMasterPassword(current.file, current.session, newPassword)
        try {
          await saveVaultFile(file)
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
    [apply, enqueue, lock],
  )

  const setRecoveryPhrase = useCallback(
    (phrase: string | null) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file || !current.session) throw new Error('Coffre verrouillé')

        const epoch = epochRef.current
        const file = phrase
          ? await enableRecovery(current.file, current.session, phrase)
          : disableRecovery(current.file, current.session)
        try {
          await saveVaultFile(file)
        } catch (error) {
          lock()
          throw error
        }
        if (epochRef.current !== epoch) return
        apply((previous) => ({ ...previous, file }))
      }),
    [apply, enqueue, lock],
  )

  const recoverWithPhrase = useCallback(
    (phrase: string, newPassword: string) =>
      enqueue(async () => {
        const current = stateRef.current
        if (!current.file) throw new Error('Aucun coffre local à récupérer')
        await requireVaultLock()

        let opened: OpenedVault
        try {
          opened = await applyTrashRetention(
            await recoverVaultFile(current.file, phrase, newPassword),
          )
        } catch (error) {
          releaseVaultLock()
          throw error
        }
        await saveVaultFile(opened.file)
        current.session?.lock()
        epochRef.current += 1
        apply(() => ({
          status: 'unlocked',
          file: opened.file,
          session: opened.session,
          vaults: opened.vaults,
          items: opened.items,
          warnings: opened.warnings,
          error: null,
        }))
        rememberCurrentKey(true)
      }),
    [apply, applyTrashRetention, enqueue, rememberCurrentKey, requireVaultLock],
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
          opened = await applyTrashRetention(
            await unlockVaultFile(file, password),
          )
        } catch (error) {
          releaseVaultLock()
          throw error
        }
        await saveVaultFile(opened.file)
        const previous = stateRef.current
        previous.session?.lock()
        epochRef.current += 1
        apply(() => ({
          status: 'unlocked',
          file: opened.file,
          session: opened.session,
          vaults: opened.vaults,
          items: opened.items,
          warnings: opened.warnings,
          error: null,
        }))
        if (previous.file && previous.file.id !== opened.file.id) {
          biometricKeyFileRef.current = null
          await deleteVaultKey(previous.file.id)
          await deleteBiometricKey(previous.file.id)
        }
        rememberCurrentKey(true)
      }),
    [apply, applyTrashRetention, enqueue, rememberCurrentKey, requireVaultLock],
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
        await requireVaultLock()
        let opened: OpenedVault
        try {
          opened = await applyTrashRetention(
            await unlockVaultFile(backup, password),
          )
        } catch (error) {
          releaseVaultLock()
          throw error
        }
        await saveVaultFile(opened.file)
        const previous = stateRef.current
        previous.session?.lock()
        epochRef.current += 1
        apply(() => ({
          status: 'unlocked',
          file: opened.file,
          session: opened.session,
          vaults: opened.vaults,
          items: opened.items,
          warnings: opened.warnings,
          error: null,
        }))
        if (previous.file && previous.file.id !== opened.file.id) {
          biometricKeyFileRef.current = null
          await deleteVaultKey(previous.file.id)
          await deleteBiometricKey(previous.file.id)
        }
        rememberCurrentKey(true)
      }),
    [apply, applyTrashRetention, enqueue, rememberCurrentKey, requireVaultLock],
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
