import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AtSign,
  CalendarClock,
  Check,
  Clock,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileUp,
  FolderInput,
  Globe,
  History,
  Keyboard,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Share2,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { Modal } from './Modal'
import { Menu } from './Menu'
import { ConfirmDialog } from './ConfirmDialog'
import { GeneratorDialog } from './GeneratorDialog'
import { HistoryDialog } from './HistoryDialog'
import { ShareItemDialog } from './ShareItemDialog'
import { AutoTypeDialog } from './AutoTypeDialog'
import { EmailAliasDialog } from './EmailAliasDialog'
import { TotpCode } from './TotpCode'
import { ItemIcon } from './ItemIcon'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'
import { copySensitive } from '../lib/clipboard'
import { randomId } from '../lib/crypto'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { decryptBlob, encryptBlob, newBlobKey, previewBlob, removeBlob } from '../lib/blobStore'
import { formatDateTime } from '../lib/settings'
import {
  cardExpiryDate,
  daysUntil,
  expiryBadgeLabel,
  expiryDescription,
  expiryTone,
  formatExpiryDate,
  parseDateOnly,
} from '../lib/expiry'
import {
  analyzeSecurity,
  itemSecurityIssue,
  type ItemSecurityIssue,
  type SecurityReport,
} from '../lib/security'
import { changePasswordUrl, safeExternalUrl as safeUrl } from '../lib/url'
import { handleExternalClick, isTauriRuntime, openExternal } from '../lib/external'
import { isTotpUri } from '../lib/totp'
import { qrDataUrl } from '../lib/qr'
import { wifiQrPayload } from '../lib/wifi'
import {
  CUSTOM_FIELD_TYPES,
  emptyDraft,
  itemTypeLabel,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_CUSTOM_FIELDS,
  WIFI_SECURITY,
  type AttachmentMeta,
  type CustomField,
  type CustomFieldType,
  type ItemDraft,
  type ItemType,
  type WifiSecurity,
  type VaultItem,
  type VaultSummary,
} from '../lib/types'

interface ItemDialogProps {
  item?: VaultItem
  initialType?: ItemType
  vaults: VaultSummary[]
  defaultVaultId: string
  onClose: () => void
  /** Ouvre directement le formulaire d’édition. */
  initialEditing?: boolean
  /**
   * `dialog` (par défaut) affiche une modale ; `panel` intègre le contenu dans
   * la colonne de détail de la disposition desktop.
   */
  presentation?: 'dialog' | 'panel'
  /** Notifie la création ou la mise à jour d’un élément. */
  onSaved?: (item: VaultItem) => void
  /** Signale une utilisation réelle (copie d’un champ, par exemple). */
  onUsed?: () => void
  /** Analyse déjà calculée par la vue principale. */
  securityReport?: SecurityReport
}

interface DialogSurfaceProps {
  panel: boolean
  title: string
  subtitle: string
  icon?: ReactNode
  favorite?: ReactNode
  onClose: () => void
  actions: ReactNode
  footer?: ReactNode
  children: ReactNode
}

/**
 * Enveloppe commune aux deux présentations : modale (petits écrans hors
 * panneau) et colonne de détail persistante sur desktop.
 */
function DialogSurface({
  panel,
  title,
  subtitle,
  icon,
  favorite,
  onClose,
  actions,
  footer,
  children,
}: DialogSurfaceProps) {
  if (panel) {
    return (
      <section className="item-panel" aria-label={title}>
        <header className="item-panel__toolbar">
          <div className="item-panel__identity">
            {icon}
            <div className="item-panel__heading">
              <span className="item-panel__eyebrow">{subtitle}</span>
              <div className="item-panel__title-row">
                <h2>{title}</h2>
                {favorite}
              </div>
            </div>
          </div>
          <div className="item-panel__actions">{actions}</div>
        </header>
        <div className="item-panel__body">{children}</div>
      </section>
    )
  }

  return (
    <Modal
      title={title}
      description={subtitle}
      size="lg"
      onClose={onClose}
      footer={footer ?? actions}
    >
      {children}
    </Modal>
  )
}

function mask(value: string): string {
  return '•'.repeat(Math.min(Math.max(value.length, 6), 24))
}

function formatCardNumber(value: string): string {
  return value.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

const CUSTOM_FIELD_LABELS: Record<CustomFieldType, string> = {
  text: 'Texte',
  hidden: 'Masqué',
  url: 'Adresse web',
  multiline: 'Texte long',
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} o`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`
}

function ExpiryBadge({ daysLeft }: { daysLeft: number }) {
  return (
    <span
      className={`expiry-badge expiry-badge--${expiryTone(daysLeft)}`}
      title={expiryDescription(daysLeft)}
    >
      <CalendarClock size={11} aria-hidden="true" />
      {expiryBadgeLabel(daysLeft)}
    </span>
  )
}

/** Ligne de détail pour une date d’échéance AAAA-MM-JJ. */
function ExpiryDetail({ label, value }: { label: string; value: string }) {
  const date = parseDateOnly(value)
  if (!date) return null
  const daysLeft = daysUntil(date)
  return (
    <div className="detail-row">
      <span className="detail-row__label">{label}</span>
      <div className="detail-row__value">
        {formatExpiryDate(value)}
        <ExpiryBadge daysLeft={daysLeft} />
      </div>
    </div>
  )
}

/** Ligne d’expiration d’une carte (MM/AA, valable jusqu’à la fin du mois). */
function CardExpiryRow({ value }: { value: string }) {
  const { tt } = useI18n()
  const date = cardExpiryDate(value)
  const daysLeft = date ? daysUntil(date) : null
  return (
    <div className="detail-row">
      <span className="detail-row__label">{tt("Expiration")}</span>
      <div className="detail-row__value mono">
        {value || '—'}
        {daysLeft !== null && <ExpiryBadge daysLeft={daysLeft} />}
      </div>
    </div>
  )
}

export function ItemDialog({
  item,
  initialType = 'login',
  vaults,
  defaultVaultId,
  onClose,
  initialEditing = false,
  presentation = 'dialog',
  onSaved,
  onUsed,
  securityReport,
}: ItemDialogProps) {
  const {
    items,
    addItem,
    updateItem,
    moveItem,
    trashItem,
    restoreItem,
    deleteItemPermanently,
    addAttachment,
    removeAttachment,
    downloadAttachment,
  } = useVault()
  const { settings } = useSettings()
  const { tt } = useI18n()
  const { toast } = useToast()

  const [current, setCurrent] = useState<VaultItem | undefined>(item)
  const [editing, setEditing] = useState(!item || initialEditing)
  const [draft, setDraft] = useState<ItemDraft>(() =>
    item ? { ...item } : emptyDraft(initialType, defaultVaultId),
  )
  const [tagsInput, setTagsInput] = useState(item?.tags.join(', ') ?? '')
  const [showPassword, setShowPassword] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [showGenerator, setShowGenerator] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showPermanentDelete, setShowPermanentDelete] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showAutoType, setShowAutoType] = useState(false)
  const [showAlias, setShowAlias] = useState(false)
  const [preview, setPreview] = useState<{ name: string; mime: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [attachmentBusy, setAttachmentBusy] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [attachmentToDelete, setAttachmentToDelete] = useState<AttachmentMeta | null>(null)

  const vault = useMemo(
    () => vaults.find((candidate) => candidate.id === draft.vaultId),
    [vaults, draft.vaultId],
  )

  const report = useMemo(
    () => securityReport ?? analyzeSecurity(items),
    [securityReport, items],
  )
  const issue = current ? itemSecurityIssue(current, report) : null

  const patch = (partial: Record<string, unknown>) => {
    setDraft((previous) => ({ ...previous, ...partial }) as ItemDraft)
    setError(null)
  }

  const toggleReveal = (key: string) => {
    setRevealed((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const addCustomField = () => {
    const fields = draft.customFields ?? []
    if (fields.length >= MAX_CUSTOM_FIELDS) return
    patch({
      customFields: [
        ...fields,
        { id: randomId('f'), label: '', value: '', type: 'text' },
      ],
    })
  }

  const updateCustomField = (id: string, partial: Partial<CustomField>) => {
    patch({
      customFields: (draft.customFields ?? []).map((field) =>
        field.id === id ? { ...field, ...partial } : field,
      ),
    })
  }

  const deleteCustomField = (id: string) => {
    patch({
      customFields: (draft.customFields ?? []).filter((field) => field.id !== id),
    })
  }

  const uploadAttachments = async (files: FileList | null) => {
    if (!current || !files || files.length === 0) return
    setAttachmentBusy(true)
    setAttachmentError(null)
    let active = current
    let added = 0

    try {
      for (const file of Array.from(files)) {
        if (file.size === 0) throw new Error(`« ${file.name} » est vide.`)
        if (file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`« ${file.name} » dépasse la limite de 5 Mo.`)
        }
        if (active.attachments.length >= MAX_ATTACHMENTS_PER_ITEM) {
          throw new Error(
            `Un élément ne peut pas contenir plus de ${MAX_ATTACHMENTS_PER_ITEM} pièces jointes.`,
          )
        }
        const total = active.attachments.reduce(
          (sum, attachment) => sum + attachment.size,
          0,
        )
        if (total + file.size > MAX_ATTACHMENTS_TOTAL_BYTES) {
          throw new Error('Les pièces jointes de cet élément dépasseraient 25 Mo.')
        }

        active = await addAttachment(active, file)
        added += 1
        setCurrent(active)
        setDraft((previous) => ({ ...previous, attachments: active.attachments }))
      }
      toast(
        added > 1 ? 'Pièces jointes ajoutées' : 'Pièce jointe ajoutée',
        'success',
      )
    } catch (caught) {
      setAttachmentError(
        caught instanceof Error ? caught.message : 'Ajout de la pièce jointe impossible',
      )
    } finally {
      setAttachmentBusy(false)
    }
  }

  const deleteAttachment = async () => {
    if (!current || !attachmentToDelete) return
    setAttachmentBusy(true)
    setAttachmentError(null)
    try {
      if (attachmentToDelete.storage === 'blob' && attachmentToDelete.blobId) {
        await removeBlob(attachmentToDelete.blobId).catch(() => undefined)
      }
      const updated = await removeAttachment(current, attachmentToDelete.id)
      setCurrent(updated)
      setDraft((previous) => ({ ...previous, attachments: updated.attachments }))
      setAttachmentToDelete(null)
      toast(tt('Pièce jointe supprimée'), 'info')
    } catch (caught) {
      setAttachmentError(
        caught instanceof Error ? caught.message : 'Suppression de la pièce jointe impossible',
      )
    } finally {
      setAttachmentBusy(false)
    }
  }

  const uploadLargeAttachment = async () => {
    if (!current) return
    setAttachmentBusy(true)
    setAttachmentError(null)
    try {
      const selected = await openDialog({
        multiple: false,
        title: tt('Choisir un document volumineux'),
      })
      if (typeof selected !== 'string') return
      if (current.attachments.length >= MAX_ATTACHMENTS_PER_ITEM) {
        throw new Error(
          `Un élément ne peut pas contenir plus de ${MAX_ATTACHMENTS_PER_ITEM} pièces jointes.`,
        )
      }
      const blobId = randomId('blob')
      const blobKey = newBlobKey()
      const info = await encryptBlob({ id: blobId, sourcePath: selected, key: blobKey })
      const name = selected.split(/[\\/]/).pop() || 'document'
      const extension = name.split('.').pop()?.toLowerCase() ?? ''
      const mime =
        extension === 'pdf'
          ? 'application/pdf'
          : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)
            ? `image/${extension === 'jpg' ? 'jpeg' : extension}`
            : 'application/octet-stream'
      const updated = await updateItem({
        ...current,
        attachments: [
          ...current.attachments,
          {
            id: randomId('a'),
            name,
            mime,
            size: info.size,
            createdAt: new Date().toISOString(),
            storage: 'blob',
            blobId,
            blobKey,
            sha256: info.sha256,
          },
        ],
      })
      setCurrent(updated)
      setDraft((previous) => ({ ...previous, attachments: updated.attachments }))
      toast(tt('Document chiffré ajouté'), 'success')
    } catch (caught) {
      setAttachmentError(
        caught instanceof Error ? caught.message : tt('Ajout du document impossible'),
      )
    } finally {
      setAttachmentBusy(false)
    }
  }

  const previewAttachment = async (attachment: AttachmentMeta) => {
    if (
      attachment.storage !== 'blob' ||
      !attachment.blobId ||
      !attachment.blobKey ||
      !(attachment.mime.startsWith('image/') || attachment.mime === 'application/pdf')
    ) {
      return
    }
    setAttachmentBusy(true)
    setAttachmentError(null)
    try {
      const base64 = await previewBlob({
        id: attachment.blobId,
        key: attachment.blobKey,
        maxBytes: 16 * 1024 * 1024,
      })
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: attachment.mime }))
      setPreview({ name: attachment.name, mime: attachment.mime, url })
    } catch (caught) {
      setAttachmentError(
        caught instanceof Error ? caught.message : tt('Aperçu impossible'),
      )
    } finally {
      setAttachmentBusy(false)
    }
  }

  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  const saveAttachment = async (attachmentId: string) => {
    if (!current) return
    setAttachmentBusy(true)
    setAttachmentError(null)
    try {
      const attachment = current.attachments.find((entry) => entry.id === attachmentId)
      if (attachment?.storage === 'blob' && attachment.blobId && attachment.blobKey) {
        const target = await saveDialog({ defaultPath: attachment.name })
        if (typeof target !== 'string') return
        await decryptBlob({
          id: attachment.blobId,
          targetPath: target,
          key: attachment.blobKey,
        })
      } else {
        await downloadAttachment(current, attachmentId)
      }
      toast(tt('Pièce jointe téléchargée'), 'success')
    } catch (caught) {
      setAttachmentError(
        caught instanceof Error ? caught.message : 'Téléchargement de la pièce jointe impossible',
      )
    } finally {
      setAttachmentBusy(false)
    }
  }

  const copyValue = async (value: string, label: string) => {
    if (!value) return
    const success = await copySensitive(value, settings.clipboardClearSeconds, () =>
      toast(tt('Presse-papiers effacé'), 'info'),
    )
    if (!success) {
      toast(tt('Impossible de copier'), 'error')
      return
    }
    onUsed?.()
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
    const suffix =
      settings.clipboardClearSeconds > 0
        ? ` · effacement dans ${settings.clipboardClearSeconds} s`
        : ''
    toast(`${label} copié${suffix}`, 'success')
  }

  const switchType = (type: ItemType) => {
    if (current) return
    setDraft((previous) => ({
      ...emptyDraft(type, previous.vaultId),
      title: previous.title,
      notes: previous.notes,
      tags: previous.tags,
      favorite: previous.favorite,
      customFields: previous.customFields,
      attachments: previous.attachments,
    }))
    setTagsInput(draft.tags.join(', '))
    setError(null)
  }

  const save = async () => {
    if (!draft.title.trim()) {
      setError('Le titre est obligatoire.')
      return
    }

    const tags = tagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)

    const nextDraft = { ...draft, tags }
    setBusy(true)
    setError(null)

    try {
      if (current) {
        const updated = await updateItem({
          ...current,
          ...nextDraft,
          id: current.id,
          vaultId: current.vaultId,
          createdAt: current.createdAt,
          updatedAt: current.updatedAt,
        } as VaultItem)
        setCurrent(updated)
        onSaved?.(updated)
        toast(tt('Élément enregistré'), 'success')
      } else {
        const created = await addItem(nextDraft)
        setCurrent(created)
        onSaved?.(created)
        toast(tt('Élément créé'), 'success')
      }
      setEditing(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Enregistrement impossible')
    } finally {
      setBusy(false)
    }
  }

  const toggleFavorite = async () => {
    if (!current) return
    try {
      const updated = await updateItem({ ...current, favorite: !current.favorite })
      setCurrent(updated)
    } catch (caught) {
      toast(
        caught instanceof Error
          ? caught.message
          : tt('Impossible de modifier le favori'),
        'error',
      )
    }
  }

  const deleteCurrent = async () => {
    if (!current) return
    await trashItem(current.id)
    toast(tt('Élément déplacé dans la corbeille'), 'info')
    onClose()
  }

  const restoreCurrent = async () => {
    if (!current) return
    try {
      const restored = await restoreItem(current.id)
      setCurrent(restored)
      setDraft({ ...restored })
      setTagsInput(restored.tags.join(', '))
      toast(tt('Élément restauré'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : 'Restauration impossible',
        'error',
      )
    }
  }

  const deleteForever = async () => {
    if (!current) return
    await deleteItemPermanently(current.id)
    toast(tt('Élément supprimé définitivement'), 'info')
    onClose()
  }

  const startEditing = () => {
    if (!current) return
    setDraft({ ...current })
    setTagsInput(current.tags.join(', '))
    setEditing(true)
  }

  const applyGeneratedPassword = async (value: string) => {
    if (editing || !current) {
      patch({ password: value })
      return
    }
    if (current.type !== 'login') return
    try {
      const updated = await updateItem({ ...current, password: value })
      setCurrent(updated)
      setDraft({ ...updated })
      toast(tt('Mot de passe remplacé'), 'success')
      onSaved?.(updated)
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : 'Remplacement impossible',
        'error',
      )
    }
  }

  const duplicateCurrent = async () => {
    if (!current) return
    try {
      const {
        id: _id,
        vaultId: _vaultId,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...content
      } = current
      const created = await addItem({
        ...content,
        vaultId: current.vaultId,
        title: `${current.title} (copie)`,
        favorite: false,
        attachments: [],
      } as ItemDraft)
      toast(
        current.attachments.length > 0
          ? 'Élément dupliqué, sans les pièces jointes'
          : 'Élément dupliqué',
        'success',
      )
      onSaved?.(created)
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : tt('Duplication impossible'), 'error')
    }
  }

  const moveToVault = async (targetVaultId: string) => {
    if (!current || targetVaultId === current.vaultId) return
    try {
      const moved = await moveItem(current.id, targetVaultId)
      setCurrent(moved)
      setDraft({ ...moved })
      setTagsInput(moved.tags.join(', '))
      toast(
        `Élément déplacé vers ${
          vaults.find((candidate) => candidate.id === targetVaultId)?.name ?? 'le coffre'
        }`,
        'success',
      )
      onSaved?.(moved)
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : tt('Déplacement impossible'), 'error')
    }
  }

  const cancelEditing = () => {
    if (!current) {
      onClose()
      return
    }
    setDraft({ ...current })
    setTagsInput(current.tags.join(', '))
    setEditing(false)
    setError(null)
  }

  // En mode panneau, Échap annule l’édition en cours au lieu de désélectionner
  // l’élément et de perdre les modifications. Les dialogues ouverts au-dessus
  // (confirmation, historique) gardent la priorité.
  useEffect(() => {
    if (presentation !== 'panel' || !editing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelector('.modal-overlay')) return
      event.preventDefault()
      event.stopPropagation()
      if (current) {
        setDraft({ ...current })
        setTagsInput(current.tags.join(', '))
        setEditing(false)
        setError(null)
      } else {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [current, editing, onClose, presentation])

  const trashed = Boolean(current?.deletedAt)
  const itemType = current?.type ?? draft.type
  const title = current ? current.title : 'Nouvel élément'
  const subtitle = `${itemTypeLabel(itemType)} · ${vault?.name ?? 'Coffre'}${
    trashed ? ' · Corbeille' : ''
  }`
  const headerIcon = (
    <span className={`item-icon item-icon--${itemType} item-icon--lg`}>
      <ItemIcon type={itemType} size={22} />
    </span>
  )

  const favoriteButton =
    current && !editing && !trashed ? (
      <button
        type="button"
        className={`icon-button icon-button--sm ${current.favorite ? 'is-favorite' : ''}`}
        onClick={() => void toggleFavorite()}
        aria-label={tt(
          current.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris',
        )}
        title={tt(current.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris')}
      >
        <Star size={17} fill={current.favorite ? 'currentColor' : 'none'} />
      </button>
    ) : undefined

  const overflowItems = current ? (
    trashed ? (
      <button
        type="button"
        role="menuitem"
        className="menu__item menu__item--danger"
        onClick={() => setShowPermanentDelete(true)}
      >
        <Trash2 size={16} />
        Supprimer définitivement
      </button>
    ) : (
      <>
        <button
          type="button"
          role="menuitem"
          className="menu__item"
          onClick={() => setShowHistory(true)}
        >
          <History size={16} />
          Historique
        </button>
        {vaults.length > 1 && (
          <>
            <div className="menu__label">{tt("Déplacer vers")}</div>
            {vaults
              .filter((candidate) => candidate.id !== current.vaultId)
              .map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  role="menuitem"
                  className="menu__item"
                  onClick={() => void moveToVault(candidate.id)}
                >
                  <FolderInput size={16} />
                  {candidate.name}
                </button>
              ))}
          </>
        )}
        {current?.type !== 'passkey' && (
          <>
            <button
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => setShowShare(true)}
            >
              <Share2 size={16} />
              Partager hors ligne
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => void duplicateCurrent()}
            >
              <CopyPlus size={16} />
              Dupliquer
            </button>
          </>
        )}
        <div className="menu__separator" />
        <button
          type="button"
          role="menuitem"
          className="menu__item menu__item--danger"
          onClick={() => setShowDelete(true)}
        >
          <Trash2 size={16} />
          Supprimer…
        </button>
      </>
    )
  ) : null

  const moreMenu = (
    <Menu
      label="Plus d’actions"
      title={tt('Plus d’actions')}
      trigger={<MoreHorizontal size={18} />}
      triggerClassName="icon-button"
    >
      {overflowItems}
    </Menu>
  )

  const headerActions = editing ? (
    <>
      <button type="button" className="button button--ghost" onClick={cancelEditing}>
        Annuler
      </button>
      <button
        type="button"
        className="button button--primary"
        onClick={() => void save()}
        disabled={busy || !draft.title.trim()}
      >
        {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
        {busy ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </>
  ) : trashed ? (
    <>
      <button
        type="button"
        className="button button--primary"
        onClick={() => void restoreCurrent()}
      >
        <RotateCcw size={16} />
        Restaurer
      </button>
      {moreMenu}
    </>
  ) : (
    <>
      {current?.type !== 'passkey' && (
        <button type="button" className="button button--primary" onClick={startEditing}>
          <Pencil size={16} />
          Modifier
        </button>
      )}
      {current?.type === 'login' && (
        <>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void copyValue(current.password, 'Mot de passe')}
          >
            <Copy size={16} />
            Copier le mot de passe
          </button>
          {isTauriRuntime() && (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setShowAutoType(true)}
            >
              <Keyboard size={16} />
              Saisie automatique
            </button>
          )}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setShowAlias(true)}
          >
            <AtSign size={16} />
            Alias e-mail
          </button>
        </>
      )}
      {moreMenu}
    </>
  )

  return (
    <>
      <DialogSurface
        panel={presentation === 'panel'}
        title={title}
        subtitle={subtitle}
        icon={headerIcon}
        favorite={favoriteButton}
        onClose={onClose}
        actions={headerActions}
        footer={headerActions}
      >
        <div className="item-dialog">
          {editing ? (
            <>
              {!current && (
                <div
                  className="type-picker"
                  role="tablist"
                  aria-label={tt('Type d’élément')}
                >
                  {(['login', 'note', 'card', 'identity', 'ssh-key', 'wifi', 'api-credential'] as ItemType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      role="tab"
                      aria-selected={draft.type === type}
                      className={`type-picker__item ${draft.type === type ? 'is-active' : ''}`}
                      onClick={() => switchType(type)}
                    >
                      <span className={`item-icon item-icon--${type}`}>
                        <ItemIcon type={type} size={17} />
                      </span>
                      {itemTypeLabel(type)}
                    </button>
                  ))}
                </div>
              )}

              <div className="form-grid">
                <label className="field field--full">
                  <span className="field__label">{tt("Titre")}</span>
                  <input
                    className="input"
                    value={draft.title}
                    onChange={(event) => patch({ title: event.target.value })}
                    placeholder={
                      draft.type === 'login'
                        ? 'Ex. GitHub'
                        : draft.type === 'card'
                          ? 'Ex. Carte perso'
                          : 'Titre de l’élément'
                    }
                    maxLength={200}
                    autoFocus
                    data-autofocus
                  />
                </label>

                <label className="field">
                  <span className="field__label">{tt("Coffre")}</span>
                  <select
                    className="input"
                    value={draft.vaultId}
                    onChange={(event) => patch({ vaultId: event.target.value })}
                    disabled={Boolean(current)}
                  >
                    {vaults.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field__label">{tt("Étiquettes")}</span>
                  <input
                    className="input"
                    value={tagsInput}
                    onChange={(event) => setTagsInput(event.target.value)}
                    placeholder={tt('travail, perso')}
                    maxLength={200}
                  />
                  <span className="field__hint">{tt("Séparées par des virgules.")}</span>
                </label>

                {draft.type !== 'card' && (
                  <label className="field field--full">
                    <span className="field__label">{tt("Rappel d’échéance")}</span>
                    <input
                      className="input"
                      type="date"
                      value={draft.expiresAt}
                      onChange={(event) => patch({ expiresAt: event.target.value })}
                    />
                    <span className="field__hint">
                      {draft.type === 'login'
                        ? 'Date à laquelle penser à changer ce mot de passe. Un rappel apparaît soixante jours avant.'
                        : 'Optionnel. Un rappel apparaît soixante jours avant cette date.'}
                    </span>
                  </label>
                )}
              </div>

              {draft.type === 'login' && (
                <div className="form-grid">
                  <label className="field field--full">
                    <span className="field__label">{tt("Identifiant")}</span>
                    <input
                      className="input"
                      value={draft.username}
                      onChange={(event) => patch({ username: event.target.value })}
                      autoComplete="off"
                      placeholder={tt('email ou nom d’utilisateur')}
                      maxLength={500}
                    />
                  </label>

                  <label className="field field--full">
                    <span className="field__label">{tt("Mot de passe")}</span>
                    <span className="input-group">
                      <input
                        className="input input--mono"
                        type={showPassword ? 'text' : 'password'}
                        value={draft.password}
                        onChange={(event) => patch({ password: event.target.value })}
                        autoComplete="new-password"
                        placeholder={tt('Saisissez votre mot de passe')}
                      />
                      <button
                        type="button"
                        className="input-group__action"
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={
                          showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'
                        }
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                      <button
                        type="button"
                        className="input-group__action"
                        onClick={() => setShowGenerator(true)}
                        aria-label={tt('Générer un mot de passe')}
                        title={tt('Générer un mot de passe')}
                      >
                        <Wand2 size={18} />
                      </button>
                    </span>
                  </label>

                  <div className="field field--full">
                    <span className="field__label">{tt("Adresses du site")}</span>
                    <div className="url-list">
                      {draft.urls.map((url, index) => (
                        <div key={index} className="url-row">
                          <Globe size={16} className="url-row__icon" />
                          <input
                            className="input"
                            value={url}
                            onChange={(event) => {
                              const urls = [...draft.urls]
                              urls[index] = event.target.value
                              patch({ urls })
                            }}
                            placeholder="https://exemple.com"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() =>
                              patch({ urls: draft.urls.filter((_, i) => i !== index) })
                            }
                            aria-label={tt('Retirer l’adresse')}
                            disabled={draft.urls.length <= 1}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                      {draft.urls.length < 10 && (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => patch({ urls: [...draft.urls, ''] })}
                        >
                          <Plus size={15} />
                          Ajouter une adresse
                        </button>
                      )}
                    </div>
                  </div>

                  <label className="field field--full">
                    <span className="field__label">{tt("Code TOTP (otpauth://)")}</span>
                    <input
                      className="input input--mono"
                      value={draft.totp}
                      onChange={(event) => patch({ totp: event.target.value })}
                      placeholder="otpauth://totp/…"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {draft.totp.trim() && !isTotpUri(draft.totp) ? (
                      <span className="field__hint field__hint--error">
                        URI invalide. Format attendu : otpauth://totp/…
                      </span>
                    ) : (
                      <span className="field__hint">
                        Collez l’URI fournie par le service lors de l’activation de la 2FA.
                      </span>
                    )}
                    {isTotpUri(draft.totp) && <TotpCode uri={draft.totp} compact />}
                  </label>
                </div>
              )}

              {draft.type === 'card' && (
                <div className="form-grid">
                  <label className="field field--full">
                    <span className="field__label">{tt("Titulaire")}</span>
                    <input
                      className="input"
                      value={draft.cardholder}
                      onChange={(event) => patch({ cardholder: event.target.value })}
                      placeholder={tt('Nom sur la carte')}
                      maxLength={200}
                    />
                  </label>
                  <label className="field field--full">
                    <span className="field__label">{tt("Numéro de carte")}</span>
                    <input
                      className="input input--mono"
                      value={draft.number}
                      onChange={(event) =>
                        patch({ number: event.target.value.replace(/[^\d ]/g, '') })
                      }
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="4242 4242 4242 4242"
                      maxLength={25}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Expiration")}</span>
                    <input
                      className="input input--mono"
                      value={draft.expiry}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/\D/g, '').slice(0, 4)
                        patch({
                          expiry:
                            digits.length > 2
                              ? `${digits.slice(0, 2)}/${digits.slice(2)}`
                              : digits,
                        })
                      }}
                      placeholder="MM/AA"
                      inputMode="numeric"
                      maxLength={5}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("CVC")}</span>
                    <input
                      className="input input--mono"
                      value={draft.cvc}
                      onChange={(event) =>
                        patch({ cvc: event.target.value.replace(/\D/g, '').slice(0, 4) })
                      }
                      placeholder="123"
                      inputMode="numeric"
                      maxLength={4}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Code PIN")}</span>
                    <input
                      className="input input--mono"
                      value={draft.pin}
                      onChange={(event) =>
                        patch({ pin: event.target.value.replace(/\D/g, '').slice(0, 6) })
                      }
                      placeholder={tt('Optionnel')}
                      inputMode="numeric"
                      maxLength={6}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Réseau / type")}</span>
                    <input
                      className="input"
                      value={draft.brand}
                      onChange={(event) => patch({ brand: event.target.value })}
                      placeholder="Visa, Mastercard…"
                      maxLength={40}
                    />
                  </label>
                </div>
              )}

              {draft.type === 'identity' && (
                <div className="form-grid">
                  <label className="field">
                    <span className="field__label">{tt("Prénom")}</span>
                    <input
                      className="input"
                      value={draft.firstName}
                      onChange={(event) => patch({ firstName: event.target.value })}
                      maxLength={200}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Nom")}</span>
                    <input
                      className="input"
                      value={draft.lastName}
                      onChange={(event) => patch({ lastName: event.target.value })}
                      maxLength={200}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("E-mail")}</span>
                    <input
                      className="input"
                      type="email"
                      value={draft.email}
                      onChange={(event) => patch({ email: event.target.value })}
                      maxLength={500}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Téléphone")}</span>
                    <input
                      className="input"
                      value={draft.phone}
                      onChange={(event) => patch({ phone: event.target.value })}
                      maxLength={100}
                    />
                  </label>
                  <label className="field field--full">
                    <span className="field__label">{tt("Adresse")}</span>
                    <input
                      className="input"
                      value={draft.address}
                      onChange={(event) => patch({ address: event.target.value })}
                      maxLength={500}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Ville")}</span>
                    <input
                      className="input"
                      value={draft.city}
                      onChange={(event) => patch({ city: event.target.value })}
                      maxLength={200}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Code postal")}</span>
                    <input
                      className="input"
                      value={draft.postalCode}
                      onChange={(event) => patch({ postalCode: event.target.value })}
                      maxLength={40}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Pays")}</span>
                    <input
                      className="input"
                      value={draft.country}
                      onChange={(event) => patch({ country: event.target.value })}
                      maxLength={200}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Date de naissance")}</span>
                    <input
                      className="input"
                      type="date"
                      value={draft.birthDate}
                      onChange={(event) => patch({ birthDate: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Expiration du passeport")}</span>
                    <input
                      className="input"
                      type="date"
                      value={draft.passportExpiry}
                      onChange={(event) => patch({ passportExpiry: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Expiration de la carte d’identité")}</span>
                    <input
                      className="input"
                      type="date"
                      value={draft.idCardExpiry}
                      onChange={(event) => patch({ idCardExpiry: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt("Expiration du permis de conduire")}</span>
                    <input
                      className="input"
                      type="date"
                      value={draft.licenseExpiry}
                      onChange={(event) => patch({ licenseExpiry: event.target.value })}
                    />
                  </label>
                </div>
              )}

              {draft.type === 'ssh-key' && (
                <div className="form-grid">
                  <label className="field field--full">
                    <span className="field__label">{tt('Clé privée')}</span>
                    <textarea
                      className="input input--mono"
                      rows={6}
                      value={draft.privateKey}
                      onChange={(event) => patch({ privateKey: event.target.value })}
                      placeholder={tt('-----BEGIN OPENSSH PRIVATE KEY-----')}
                      spellCheck={false}
                    />
                  </label>
                  <label className="field field--full">
                    <span className="field__label">{tt('Clé publique')}</span>
                    <textarea
                      className="input input--mono"
                      rows={3}
                      value={draft.publicKey}
                      onChange={(event) => patch({ publicKey: event.target.value })}
                      placeholder={tt('ssh-ed25519 AAAA…')}
                      spellCheck={false}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Empreinte')}</span>
                    <input
                      className="input input--mono"
                      value={draft.fingerprint}
                      onChange={(event) => patch({ fingerprint: event.target.value })}
                      placeholder={tt('SHA256:…')}
                      spellCheck={false}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Commentaire')}</span>
                    <input
                      className="input"
                      value={draft.comment}
                      onChange={(event) => patch({ comment: event.target.value })}
                      maxLength={500}
                    />
                  </label>
                </div>
              )}

              {draft.type === 'wifi' && (
                <div className="form-grid">
                  <label className="field field--full">
                    <span className="field__label">{tt('SSID')}</span>
                    <input
                      className="input"
                      value={draft.ssid}
                      onChange={(event) => patch({ ssid: event.target.value })}
                      maxLength={100}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Mot de passe')}</span>
                    <input
                      className="input"
                      type="password"
                      value={draft.password}
                      onChange={(event) => patch({ password: event.target.value })}
                      maxLength={500}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Sécurité')}</span>
                    <select
                      className="input"
                      value={draft.security}
                      onChange={(event) =>
                        patch({ security: event.target.value as WifiSecurity })
                      }
                    >
                      {WIFI_SECURITY.map((security) => (
                        <option key={security} value={security}>
                          {security === 'WPA'
                            ? tt('WPA/WPA2/WPA3')
                            : security === 'WEP'
                              ? tt('WEP')
                              : tt('Sans mot de passe')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox field--full">
                    <input
                      type="checkbox"
                      checked={draft.hidden}
                      onChange={(event) => patch({ hidden: event.target.checked })}
                    />
                    <span>{tt('Réseau masqué')}</span>
                  </label>
                </div>
              )}

              {draft.type === 'api-credential' && (
                <div className="form-grid">
                  <label className="field field--full">
                    <span className="field__label">{tt('Identifiant de clé')}</span>
                    <input
                      className="input input--mono"
                      value={draft.keyId}
                      onChange={(event) => patch({ keyId: event.target.value })}
                      maxLength={500}
                    />
                  </label>
                  <label className="field field--full">
                    <span className="field__label">{tt('Secret')}</span>
                    <input
                      className="input input--mono"
                      type="password"
                      value={draft.secret}
                      onChange={(event) => patch({ secret: event.target.value })}
                      maxLength={10_000}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Environnement')}</span>
                    <input
                      className="input"
                      value={draft.environment}
                      onChange={(event) => patch({ environment: event.target.value })}
                      maxLength={100}
                      placeholder={tt('Production')}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Point de terminaison')}</span>
                    <input
                      className="input input--mono"
                      value={draft.endpoint}
                      onChange={(event) => patch({ endpoint: event.target.value })}
                      maxLength={2_000}
                      placeholder={tt('https://api.exemple.fr')}
                    />
                  </label>
                </div>
              )}

              <label className="field">
                <span className="field__label">{tt("Notes")}</span>
                <textarea
                  className="input textarea"
                  value={draft.notes}
                  onChange={(event) => patch({ notes: event.target.value })}
                  rows={4}
                  placeholder={tt('Informations complémentaires…')}
                  maxLength={100_000}
                />
              </label>

              <div className="custom-fields">
                <div className="custom-fields__head">
                  <span className="field__label">{tt("Champs personnalisés")}</span>
                  <button
                    type="button"
                    className="link-button"
                    onClick={addCustomField}
                    disabled={(draft.customFields ?? []).length >= MAX_CUSTOM_FIELDS}
                  >
                    <Plus size={14} />
                    Ajouter un champ
                  </button>
                </div>
                {(draft.customFields ?? []).length === 0 ? (
                  <p className="field__hint">
                    Stockez un identifiant secondaire, une clé API ou toute autre
                    information utile.
                  </p>
                ) : (
                  <div className="custom-fields__list">
                    {(draft.customFields ?? []).map((field) => (
                      <div className="custom-field" key={field.id}>
                        <input
                          className="input"
                          value={field.label}
                          onChange={(event) =>
                            updateCustomField(field.id, { label: event.target.value })
                          }
                          placeholder={tt('Nom du champ')}
                          maxLength={80}
                          aria-label={tt('Nom du champ personnalisé')}
                        />
                        <select
                          className="input"
                          value={field.type}
                          onChange={(event) =>
                            updateCustomField(field.id, {
                              type: event.target.value as CustomFieldType,
                            })
                          }
                          aria-label={tt('Type du champ personnalisé')}
                        >
                          {CUSTOM_FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {CUSTOM_FIELD_LABELS[type]}
                            </option>
                          ))}
                        </select>
                        {field.type === 'multiline' ? (
                          <textarea
                            className="input textarea custom-field__value"
                            value={field.value}
                            onChange={(event) =>
                              updateCustomField(field.id, { value: event.target.value })
                            }
                            rows={2}
                            maxLength={10_000}
                            placeholder={tt('Valeur')}
                            aria-label={`Valeur de ${field.label || 'champ'}`}
                          />
                        ) : (
                          <input
                            className="input custom-field__value"
                            value={field.value}
                            onChange={(event) =>
                              updateCustomField(field.id, { value: event.target.value })
                            }
                            maxLength={10_000}
                            placeholder={tt('Valeur')}
                            autoComplete="off"
                            aria-label={`Valeur de ${field.label || 'champ'}`}
                          />
                        )}
                        <button
                          type="button"
                          className="icon-button icon-button--sm"
                          onClick={() => deleteCustomField(field.id)}
                          aria-label={`Supprimer le champ ${field.label || 'sans nom'}`}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <AttachmentsSection
                attachments={draft.attachments}
                busy={attachmentBusy}
                error={attachmentError}
                canAdd={Boolean(current)}
                hint={
                  current
                    ? undefined
                    : 'Enregistrez d’abord l’élément pour pouvoir y ajouter une pièce jointe.'
                }
                onAdd={uploadAttachments}
                onAddLarge={isTauriRuntime() ? uploadLargeAttachment : undefined}
                onPreview={previewAttachment}
                onDownload={saveAttachment}
                onDelete={setAttachmentToDelete}
              />

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.favorite}
                  onChange={(event) => patch({ favorite: event.target.checked })}
                />
                <span>{tt("Marquer comme favori")}</span>
              </label>

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </>
          ) : current ? (
            <>
              {trashed && current.deletedAt && (
                <div className="trash-banner" role="status">
                  <Trash2 size={17} />
                  <div>
                    <strong>
                      Dans la corbeille depuis le {formatDateTime(current.deletedAt)}
                    </strong>
                    <span>
                      Cet élément reste chiffré. Vous pouvez le restaurer à tout
                      moment
                      {settings.trashRetentionDays > 0
                        ? ` ; il sera purgé automatiquement après ${settings.trashRetentionDays} jours.`
                        : '.'}
                    </span>
                  </div>
                </div>
              )}
              <ItemDetails
                item={current}
                vaultName={vault?.name ?? 'Coffre'}
                revealed={revealed}
                toggleReveal={toggleReveal}
                copyValue={copyValue}
                copied={copied}
                onToggleFavorite={() => void toggleFavorite()}
                readOnly={trashed}
                issue={issue}
                onGeneratePassword={() => setShowGenerator(true)}
                onEditItem={startEditing}
                attachmentBusy={attachmentBusy}
                attachmentError={attachmentError}
                onAddAttachment={uploadAttachments}
                onDownloadAttachment={saveAttachment}
                onDeleteAttachment={setAttachmentToDelete}
              />
            </>
          ) : null}
        </div>
      </DialogSurface>

      {presentation === 'panel' && (
        <div
          className={`detail-actionbar ${
            editing || !current || trashed || current.type !== 'login'
              ? 'detail-actionbar--simple'
              : ''
          }`}
          role="toolbar"
          aria-label={tt('Actions de l’élément')}
        >
          {editing ? (
            <>
              <button
                type="button"
                className="button button--ghost"
                onClick={cancelEditing}
              >
                <X size={18} />
                Annuler
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void save()}
                disabled={busy || !draft.title.trim()}
              >
                <Check size={18} />
                Enregistrer
              </button>
            </>
          ) : trashed ? (
            <>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void restoreCurrent()}
              >
                <RotateCcw size={18} />
                Restaurer
              </button>
              {moreMenu}
            </>
          ) : current ? (
            <>
              {current.type === 'login' && (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void copyValue(current.username, 'Identifiant')}
                  disabled={!current.username}
                >
                  <Copy size={18} />
                  {tt("Identifiant")}
                </button>
              )}
              {current.type === 'login' && (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void copyValue(current.password, 'Mot de passe')}
                  disabled={!current.password}
                >
                  <Copy size={18} />
                  {tt("Mot de passe")}
                </button>
              )}
              {current.type !== 'passkey' && (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={startEditing}
                >
                  <Pencil size={18} />
                  Modifier
                </button>
              )}
              {moreMenu}
            </>
          ) : null}
        </div>
      )}

      {showGenerator && (
        <GeneratorDialog
          onClose={() => setShowGenerator(false)}
          onUse={(value) => void applyGeneratedPassword(value)}
        />
      )}

      {showDelete && current && (
        <ConfirmDialog
          title={tt('Déplacer vers la corbeille ?')}
          description={`« ${current.title} » sera déplacé dans la corbeille. Vous pourrez le restaurer à tout moment${
            settings.trashRetentionDays > 0
              ? ` pendant ${settings.trashRetentionDays} jours`
              : ''
          }.`}
          confirmLabel={tt('Mettre à la corbeille')}
          onClose={() => setShowDelete(false)}
          onConfirm={deleteCurrent}
        />
      )}

      {showPermanentDelete && current && (
        <ConfirmDialog
          title={tt('Supprimer définitivement ?')}
          description={`« ${current.title} », ses pièces jointes et son historique seront définitivement effacés. Cette action est irréversible.`}
          confirmLabel={tt('Supprimer définitivement')}
          requireText="SUPPRIMER"
          onClose={() => setShowPermanentDelete(false)}
          onConfirm={deleteForever}
        />
      )}

      {showHistory && current && (
        <HistoryDialog
          item={current}
          onClose={() => setShowHistory(false)}
          onRestored={(restored) => {
            setCurrent(restored)
            setDraft({ ...restored })
            setTagsInput(restored.tags.join(', '))
          }}
        />
      )}

      {showShare && current && (
        <ShareItemDialog item={current} onClose={() => setShowShare(false)} />
      )}
      {showAutoType && current?.type === 'login' && (
        <AutoTypeDialog item={current} onClose={() => setShowAutoType(false)} />
      )}
      {preview && (
        <Modal
          title={preview.name}
          description={tt('Aperçu en mémoire, sans écriture en clair sur le disque.')}
          size="lg"
          onClose={closePreview}
        >
          {preview.mime.startsWith('image/') ? (
            <img className="blob-preview" src={preview.url} alt={preview.name} />
          ) : (
            <iframe className="blob-preview-frame" src={preview.url} title={preview.name} />
          )}
        </Modal>
      )}
      {showAlias && current?.type === 'login' && (
        <EmailAliasDialog
          item={current}
          onApply={(alias) => {
            void updateItem({
              ...current,
              emailAlias: alias,
              username: current.username || alias,
            })
              .then(() => toast(tt('Alias e-mail enregistré'), 'success'))
              .catch(() => toast(tt('Alias e-mail impossible'), 'error'))
          }}
          onClose={() => setShowAlias(false)}
        />
      )}

      {attachmentToDelete && (
        <ConfirmDialog
          title={tt('Supprimer cette pièce jointe ?')}
          description={`« ${attachmentToDelete.name} » sera définitivement supprimée de cet élément.`}
          confirmLabel={tt('Supprimer')}
          onClose={() => setAttachmentToDelete(null)}
          onConfirm={deleteAttachment}
        />
      )}
    </>
  )
}

interface ItemDetailsProps {
  item: VaultItem
  vaultName: string
  revealed: Set<string>
  toggleReveal: (key: string) => void
  copyValue: (value: string, label: string) => Promise<void>
  copied: string | null
  onToggleFavorite: () => void
  /** Élément en corbeille : lecture seule, ni favori ni pièces jointes modifiables. */
  readOnly?: boolean
  issue: ItemSecurityIssue | null
  onGeneratePassword: () => void
  onEditItem: () => void
  attachmentBusy: boolean
  attachmentError: string | null
  onAddAttachment: (files: FileList | null) => Promise<void>
  onDownloadAttachment: (attachmentId: string) => Promise<void>
  onDeleteAttachment: (attachment: AttachmentMeta) => void
}

function ItemDetails({
  item,
  vaultName,
  revealed,
  toggleReveal,
  copyValue,
  copied,
  onToggleFavorite,
  readOnly = false,
  issue,
  onGeneratePassword,
  onEditItem,
  attachmentBusy,
  attachmentError,
  onAddAttachment,
  onDownloadAttachment,
  onDeleteAttachment,
}: ItemDetailsProps) {
  const { tt } = useI18n()
  const [showWifiQr, setShowWifiQr] = useState(false)
  const changeUrl = item.type === 'login' ? changePasswordUrl(item.urls) : null

  return (
    <div className="item-detail">
      <div className="item-detail__toolbar">
        <div className="item-detail__identity">
          <span className={`item-icon item-icon--${item.type} item-icon--lg`}>
            <ItemIcon type={item.type} size={22} />
          </span>
          <div>
            <span className="item-detail__type">{itemTypeLabel(item.type)}</span>
            <span className="item-detail__vault">{vaultName}</span>
          </div>
        </div>
        {!readOnly && (
          <button
            type="button"
            className={`icon-button ${item.favorite ? 'is-favorite' : ''}`}
            onClick={onToggleFavorite}
            aria-label={tt(
              item.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris',
            )}
            title={tt(item.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris')}
          >
            <Star size={19} fill={item.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      {issue && (
        <div
          className={`alert-banner ${issue.category === 'weak' ? 'alert-banner--danger' : ''}`}
          role="status"
        >
          <ShieldAlert size={17} />
          <div className="alert-banner__body">
            <strong>{issue.label}</strong>
            <p>{issue.description}</p>
          </div>
          <div className="alert-banner__actions">
            {issue.category === 'weak' ||
            issue.category === 'reused' ||
            issue.category === 'similar' ? (
              <button
                type="button"
                className="button button--secondary button--sm"
                onClick={onGeneratePassword}
              >
                <Wand2 size={15} />
                Générer
              </button>
            ) : issue.category === 'no2fa' || issue.category === 'incomplete' ? (
              <button
                type="button"
                className="button button--secondary button--sm"
                onClick={onEditItem}
              >
                <Pencil size={15} />
                Compléter
              </button>
            ) : null}
            {changeUrl && (
              <button
                type="button"
                className="button button--secondary button--sm"
                onClick={() => void openExternal(changeUrl)}
              >
                <ExternalLink size={15} />
                Changer sur le site
              </button>
            )}
          </div>
        </div>
      )}

      {item.type === 'login' && (
        <div className="detail-list">
          <DetailRow
            label="Identifiant"
            value={item.username}
            onCopy={() => void copyValue(item.username, 'Identifiant')}
            copied={copied === 'Identifiant'}
          />
          <SecretRow
            label="Mot de passe"
            value={item.password}
            revealed={revealed.has('password')}
            onToggle={() => toggleReveal('password')}
            onCopy={() => void copyValue(item.password, 'Mot de passe')}
            copied={copied === 'Mot de passe'}
          />
          {item.urls.filter(Boolean).length > 0 && (
            <div className="detail-row">
              <span className="detail-row__label">{tt("Adresses")}</span>
              <div className="detail-row__value detail-row__links">
                {item.urls.filter(Boolean).map((url) => {
                  const target = safeUrl(url)
                  return (
                    <span key={url} className="detail-link">
                      <Link2 size={14} />
                      {target ? (
                        <a
                        href={target}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(event) => handleExternalClick(event, target)}
                      >
                        {url}
                        <ExternalLink size={12} />
                      </a>
                      ) : (
                        <span>{url}</span>
                      )}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          {item.totp.trim() && (
            <div className="detail-row">
              <span className="detail-row__label">{tt("Code 2FA")}</span>
              <div className="detail-row__value">
                <TotpCode uri={item.totp} />
              </div>
            </div>
          )}
        </div>
      )}

      {item.type === 'card' && (
        <div className="detail-list">
          <DetailRow label="Titulaire" value={item.cardholder} />
          <SecretRow
            label="Numéro"
            value={formatCardNumber(item.number)}
            revealed={revealed.has('card-number')}
            onToggle={() => toggleReveal('card-number')}
            onCopy={() => void copyValue(item.number.replace(/\s/g, ''), 'Numéro de carte')}
            copied={copied === 'Numéro de carte'}
            mono
          />
          <CardExpiryRow value={item.expiry} />
          <SecretRow
            label="CVC"
            value={item.cvc}
            revealed={revealed.has('cvc')}
            onToggle={() => toggleReveal('cvc')}
            onCopy={() => void copyValue(item.cvc, 'CVC')}
            copied={copied === 'CVC'}
            mono
          />
          {item.pin && (
            <SecretRow
              label="Code PIN"
              value={item.pin}
              revealed={revealed.has('pin')}
              onToggle={() => toggleReveal('pin')}
              onCopy={() => void copyValue(item.pin, 'Code PIN')}
              copied={copied === 'Code PIN'}
              mono
            />
          )}
          {item.brand && <DetailRow label="Réseau" value={item.brand} />}
        </div>
      )}

      {item.type === 'identity' && (
        <div className="detail-list">
          <DetailRow
            label="Nom complet"
            value={[item.firstName, item.lastName].filter(Boolean).join(' ')}
          />
          <DetailRow
            label="E-mail"
            value={item.email}
            onCopy={() => void copyValue(item.email, 'E-mail')}
            copied={copied === 'E-mail'}
          />
          <DetailRow
            label="Téléphone"
            value={item.phone}
            onCopy={() => void copyValue(item.phone, 'Téléphone')}
            copied={copied === 'Téléphone'}
          />
          <DetailRow label="Adresse" value={item.address} />
          <DetailRow
            label="Ville"
            value={[item.postalCode, item.city].filter(Boolean).join(' ')}
          />
          <DetailRow label="Pays" value={item.country} />
          <DetailRow label="Naissance" value={item.birthDate} />
          {item.passportExpiry && (
            <ExpiryDetail label="Passeport" value={item.passportExpiry} />
          )}
          {item.idCardExpiry && (
            <ExpiryDetail label="Carte d’identité" value={item.idCardExpiry} />
          )}
          {item.licenseExpiry && (
            <ExpiryDetail label="Permis" value={item.licenseExpiry} />
          )}
        </div>
      )}

      {item.type === 'passkey' && (
        <div className="detail-list">
          <DetailRow label="Site (RP ID)" value={item.rpId} />
          <DetailRow label="Compte" value={item.userName} />
          <div className="detail-row">
            <span className="detail-row__label">{tt("Type")}</span>
            <div className="detail-row__value">
              Passkey WebAuthn · clé privée conservée dans le coffre
            </div>
          </div>
        </div>
      )}

      {item.type === 'ssh-key' && (
        <div className="detail-list">
          <SecretRow
            label="Clé privée"
            value={item.privateKey}
            revealed={revealed.has('ssh-private')}
            onToggle={() => toggleReveal('ssh-private')}
            onCopy={() => void copyValue(item.privateKey, 'Clé privée')}
            copied={copied === 'Clé privée'}
          />
          <DetailRow
            label="Clé publique"
            value={item.publicKey}
            onCopy={() => void copyValue(item.publicKey, 'Clé publique')}
            copied={copied === 'Clé publique'}
          />
          <DetailRow
            label="Empreinte"
            value={item.fingerprint}
            onCopy={() => void copyValue(item.fingerprint, 'Empreinte')}
            copied={copied === 'Empreinte'}
          />
          <DetailRow label="Commentaire" value={item.comment} />
        </div>
      )}

      {item.type === 'wifi' && (
        <>
          <div className="detail-list">
            <DetailRow
              label="SSID"
              value={item.ssid}
              onCopy={() => void copyValue(item.ssid, 'SSID')}
              copied={copied === 'SSID'}
            />
            <SecretRow
              label="Mot de passe"
              value={item.password}
              revealed={revealed.has('wifi-password')}
              onToggle={() => toggleReveal('wifi-password')}
              onCopy={() => void copyValue(item.password, 'Mot de passe')}
              copied={copied === 'Mot de passe'}
            />
            <DetailRow
              label="Sécurité"
              value={item.security === 'nopass' ? tt('Sans mot de passe') : item.security}
            />
            <DetailRow label="Réseau masqué" value={item.hidden ? tt('Oui') : tt('Non')} />
          </div>
          <div className="detail-list detail-list--custom">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setShowWifiQr((visible) => !visible)}
            >
              {showWifiQr
                ? tt('Masquer le QR code Wi-Fi')
                : tt('Afficher le QR code Wi-Fi')}
            </button>
            {showWifiQr && (
              <div className="offline-share__qr">
                <img src={qrDataUrl(wifiQrPayload(item))} alt={tt('QR code Wi-Fi')} />
                <span>{tt('Scannez ce code pour rejoindre le réseau.')}</span>
              </div>
            )}
          </div>
        </>
      )}

      {item.type === 'api-credential' && (
        <div className="detail-list">
          <DetailRow
            label="Identifiant de clé"
            value={item.keyId}
            onCopy={() => void copyValue(item.keyId, 'Identifiant de clé')}
            copied={copied === 'Identifiant de clé'}
            mono
          />
          <SecretRow
            label="Secret"
            value={item.secret}
            revealed={revealed.has('api-secret')}
            onToggle={() => toggleReveal('api-secret')}
            onCopy={() => void copyValue(item.secret, 'Secret')}
            copied={copied === 'Secret'}
          />
          <DetailRow label="Environnement" value={item.environment} />
          <DetailRow
            label="Point de terminaison"
            value={item.endpoint}
            onCopy={() => void copyValue(item.endpoint, 'Point de terminaison')}
            copied={copied === 'Point de terminaison'}
            mono
          />
        </div>
      )}

      {item.expiresAt && (
        <div className="detail-list detail-list--custom">
          <ExpiryDetail
            label={item.type === 'login' ? 'Mot de passe à changer' : 'Échéance'}
            value={item.expiresAt}
          />
        </div>
      )}

      {item.customFields.length > 0 && (
        <div className="detail-list detail-list--custom">
          {item.customFields.map((field) => {
            if (field.type === 'hidden') {
              return (
                <SecretRow
                  key={field.id}
                  label={field.label}
                  value={field.value}
                  revealed={revealed.has(`custom:${field.id}`)}
                  onToggle={() => toggleReveal(`custom:${field.id}`)}
                  onCopy={() => void copyValue(field.value, field.label)}
                  copied={copied === field.label}
                />
              )
            }

            if (field.type === 'url') {
              const target = safeUrl(field.value)
              return (
                <div className="detail-row" key={field.id}>
                  <span className="detail-row__label">{field.label}</span>
                  <span className="detail-row__value detail-row__links">
                    {field.value ? (
                      target ? (
                        <span className="detail-link">
                          <Link2 size={14} />
                          <a
                          href={target}
                          target="_blank"
                          rel="noreferrer noopener"
                          onClick={(event) => handleExternalClick(event, target)}
                        >
                          {field.value}
                          <ExternalLink size={12} />
                        </a>
                        </span>
                      ) : (
                        <span>{field.value}</span>
                      )
                    ) : (
                      <span className="is-empty">—</span>
                    )}
                  </span>
                  {field.value && (
                    <span className="detail-row__actions">
                      <button
                        type="button"
                        className="icon-button icon-button--sm"
                        onClick={() => void copyValue(field.value, field.label)}
                        aria-label={`Copier ${field.label}`}
                      >
                        {copied === field.label ? <Check size={15} /> : <Copy size={15} />}
                      </button>
                    </span>
                  )}
                </div>
              )
            }

            if (field.type === 'multiline') {
              return (
                <div className="detail-row detail-row--multiline" key={field.id}>
                  <span className="detail-row__label">{field.label}</span>
                  <p className="detail-row__value detail-notes">{field.value || '—'}</p>
                </div>
              )
            }

            return (
              <DetailRow
                key={field.id}
                label={field.label}
                value={field.value}
                onCopy={() => void copyValue(field.value, field.label)}
                copied={copied === field.label}
              />
            )
          })}
        </div>
      )}

      {item.tags.length > 0 && (
        <div className="tag-list">
          {item.tags.map((tag) => (
            <span key={tag} className="tag">
              <Tag size={12} />
              {tag}
            </span>
          ))}
        </div>
      )}

      {item.notes.trim() && (
        <div className="detail-section">
          <span className="detail-row__label">{tt("Notes")}</span>
          <p className="detail-notes">{item.notes}</p>
        </div>
      )}

      <AttachmentsSection
        attachments={item.attachments}
        busy={attachmentBusy}
        error={attachmentError}
        canAdd={!readOnly}
        canDelete={!readOnly}
        onAdd={onAddAttachment}
        onDownload={onDownloadAttachment}
        onDelete={onDeleteAttachment}
      />

      <div className="detail-meta">
        <Clock size={14} />
        Créé le {formatDateTime(item.createdAt)} · modifié le {formatDateTime(item.updatedAt)}
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  onCopy,
  copied,
  mono = false,
}: {
  label: string
  value: string
  onCopy?: () => void
  copied?: boolean
  mono?: boolean
}) {
  return (
    <div className="detail-row">
      <span className="detail-row__label">{label}</span>
      <span className={`detail-row__value ${mono ? 'mono' : ''} ${value ? '' : 'is-empty'}`}>
        <span className="detail-row__text">{value || '—'}</span>
        {value && onCopy && (
          <span className="detail-row__actions">
            <button
              type="button"
              className="icon-button icon-button--sm"
              onClick={onCopy}
              aria-label={`Copier ${label}`}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </span>
        )}
      </span>
    </div>
  )
}

function SecretRow({
  label,
  value,
  revealed,
  onToggle,
  onCopy,
  copied,
  mono = false,
}: {
  label: string
  value: string
  revealed: boolean
  onToggle: () => void
  onCopy: () => void
  copied?: boolean
  mono?: boolean
}) {
  return (
    <div className="detail-row">
      <span className="detail-row__label">{label}</span>
      <span className={`detail-row__value ${mono || !revealed ? 'mono' : ''}`}>
        <span className="detail-row__text">
          {value ? (revealed ? value : mask(value)) : '—'}
        </span>
        {value && (
          <span className="detail-row__actions">
            <button
              type="button"
              className="icon-button icon-button--sm"
              onClick={onToggle}
              aria-label={revealed ? `Masquer ${label}` : `Afficher ${label}`}
            >
              {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button
              type="button"
              className="icon-button icon-button--sm"
              onClick={onCopy}
              aria-label={`Copier ${label}`}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </span>
        )}
      </span>
    </div>
  )
}

interface AttachmentsSectionProps {
  attachments: AttachmentMeta[]
  busy: boolean
  error: string | null
  canAdd: boolean
  canDelete?: boolean
  hint?: string
  onAdd: (files: FileList | null) => Promise<void>
  onAddLarge?: () => Promise<void>
  onPreview?: (attachment: AttachmentMeta) => Promise<void>
  onDownload: (attachmentId: string) => Promise<void>
  onDelete: (attachment: AttachmentMeta) => void
}

function AttachmentsSection({
  attachments,
  busy,
  error,
  canAdd,
  canDelete = true,
  hint,
  onAdd,
  onAddLarge,
  onPreview,
  onDownload,
  onDelete,
}: AttachmentsSectionProps) {
  const { tt } = useI18n()
  return (
    <div className="attachments">
      <div className="custom-fields__head">
        <span className="field__label">
          Pièces jointes
          {attachments.length > 0 && (
            <span className="attachments__count">{attachments.length}</span>
          )}
        </span>
        {canAdd && onAddLarge && (
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => void onAddLarge()}
            disabled={busy}
          >
            <FileUp size={14} />
            {tt('Document volumineux')}
          </button>
        )}
        {canAdd && (
          <label className={`button button--ghost button--sm ${busy ? 'is-disabled' : ''}`}>
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <FileUp size={14} />
            )}
            Ajouter
            <input
              className="file-input-hidden"
              type="file"
              multiple
              onChange={(event) => {
                void onAdd(event.target.files)
                event.target.value = ''
              }}
              disabled={busy}
            />
          </label>
        )}
      </div>

      {hint && <p className="field__hint">{hint}</p>}

      {attachments.length > 0 ? (
        <ul className="attachment-list">
          {attachments.map((attachment) => (
            <li className="attachment" key={attachment.id}>
              <span className="attachment__icon">
                <Paperclip size={16} />
              </span>
              <span className="attachment__body">
                <span className="attachment__name">{attachment.name}</span>
                <span className="attachment__meta">
                  {formatBytes(attachment.size)} · {attachment.mime}
                </span>
              </span>
              {onPreview &&
                attachment.storage === 'blob' &&
                (attachment.mime.startsWith('image/') ||
                  attachment.mime === 'application/pdf') && (
                  <button
                    type="button"
                    className="icon-button icon-button--sm"
                    onClick={() => void onPreview(attachment)}
                    disabled={busy}
                    aria-label={`Aperçu de ${attachment.name}`}
                    title={tt('Aperçu')}
                  >
                    <Eye size={15} />
                  </button>
                )}
              <button
                type="button"
                className="icon-button icon-button--sm"
                onClick={() => void onDownload(attachment.id)}
                disabled={busy}
                aria-label={`Télécharger ${attachment.name}`}
                title={tt('Télécharger')}
              >
                <Download size={15} />
              </button>
              {canDelete && (
                <button
                  type="button"
                  className="icon-button icon-button--sm icon-button--danger"
                  onClick={() => onDelete(attachment)}
                  disabled={busy}
                  aria-label={`Supprimer ${attachment.name}`}
                  title={tt('Supprimer')}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="field__hint">
          Aucune pièce jointe. Les fichiers sont chiffrés avec la clé de l’élément.
        </p>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
