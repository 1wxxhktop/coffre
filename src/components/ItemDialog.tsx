import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import {
  AtSign,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
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
import { PasswordStrength } from './PasswordStrength'
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
  itemSecurityFacts,
  itemSecurityIssue,
  PASSWORD_ISSUE_CATEGORIES,
  type ItemSecurityFacts,
  type ItemSecurityIssue,
  type SecurityReport,
} from '../lib/security'
import { estimateEntropy, passwordStrength } from '../lib/strength'
import { cx } from '../lib/cx'
import { moveEntry } from '../lib/palette'
import { changePasswordUrl, safeExternalUrl as safeUrl } from '../lib/url'
import { handleExternalClick, isTauriRuntime, openExternal } from '../lib/external'
import { hostFromUrl } from '../lib/extensionProtocol'
import { normalizeHostname, registrableDomain } from '../lib/domains'
import { siteSecurityForHost } from '../lib/siteSecurity'
import { isTotpUri, normalizeTotpUri, totpInputValue } from '../lib/totp'
import {
  CUSTOM_FIELD_TYPE_LABELS,
  formatCustomDate,
  formatCustomMonth,
  isCustomFieldValueValid,
  isSecretFieldType,
} from '../lib/customFields'
import { qrDataUrl } from '../lib/qr'
import { wifiQrPayload } from '../lib/wifi'
import {
  createRecoveryCodeEntries,
  MAX_RECOVERY_CODES,
  parseRecoveryCodes,
  remainingRecoveryCodes,
  setRecoveryCodeUsed,
} from '../lib/recoveryCodes'
import {
  CUSTOM_FIELD_TYPES,
  emptyDraft,
  itemTypeLabel,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_CUSTOM_FIELDS,
  WIFI_SECURITY,
  DOCUMENT_KINDS,
  type AttachmentMeta,
  type CustomField,
  type CustomFieldType,
  type ItemDraft,
  type ItemType,
  type RecoveryCode,
  type WifiSecurity,
  type DocumentKind,
  type VaultItem,
  type VaultSummary,
} from '../lib/types'

const TWO_FACTOR_LABELS: Record<string, string> = {
  totp: 'TOTP',
  sms: 'SMS',
  call: 'Appel',
  email: 'E-mail',
  u2f: 'Clé matérielle',
  'custom-software': 'Application',
  'custom-hardware': 'Matériel',
}

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
  /** Copie créée par « Dupliquer » : le panneau l’ouvre en modification. */
  onDuplicated?: (item: VaultItem) => void
  /** Signale une utilisation réelle (copie d’un champ, par exemple). */
  onUsed?: () => void
  /** Ouvre un autre élément, par exemple un compte qui partage le mot de passe. */
  onOpenItem?: (itemId: string) => void
  /** Analyse déjà calculée par la vue principale. */
  securityReport?: SecurityReport
}

interface DialogSurfaceProps {
  panel: boolean
  title: string
  subtitle: string
  icon?: ReactNode
  favorite?: ReactNode
  /** Panneau : action principale, sur la ligne du titre. */
  primary?: ReactNode
  /** Panneau : autres actions, sur une seule ligne sous le titre. */
  secondary?: ReactNode
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
  primary,
  secondary,
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
            {primary && <div className="item-panel__primary">{primary}</div>}
          </div>
          {secondary && <div className="item-panel__actions">{secondary}</div>}
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
  onDuplicated,
  onUsed,
  onOpenItem,
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
    recordGeneratedPassword,
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
  // Texte tapé dans le champ TOTP (clé ou lien), tant qu’il correspond au
  // lien actuellement dans le brouillon : évite que le curseur saute.
  const [dragFieldId, setDragFieldId] = useState<string | null>(null)
  const [dropFieldId, setDropFieldId] = useState<string | null>(null)
  const [totpTyped, setTotpTyped] = useState<{ text: string; uri: string } | null>(
    null,
  )
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
  const [recoveryImport, setRecoveryImport] = useState('')
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<RecoveryCode | null>(null)

  const vault = useMemo(
    () => vaults.find((candidate) => candidate.id === draft.vaultId),
    [vaults, draft.vaultId],
  )

  const report = useMemo(
    () => securityReport ?? analyzeSecurity(items),
    [securityReport, items],
  )
  const issue = current ? itemSecurityIssue(current, report) : null
  const facts = useMemo(
    () => (current ? itemSecurityFacts(current, report) : null),
    [current, report],
  )
  const hasPasskeyForItem = useMemo(() => {
    if (!current || current.type !== 'login') return false
    const domains = new Set(
      current.urls
        .map(hostFromUrl)
        .filter(Boolean)
        .map((host) => registrableDomain(host)),
    )
    if (domains.size === 0) return false
    return items.some(
      (candidate) =>
        candidate.type === 'passkey' &&
        !candidate.deletedAt &&
        domains.has(registrableDomain(normalizeHostname(candidate.rpId))),
    )
  }, [current, items])

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

  const moveCustomField = (fromId: string, toIndex: number) => {
    const fields = draft.customFields ?? []
    const from = fields.findIndex((field) => field.id === fromId)
    const next = moveEntry(fields, from, toIndex)
    if (next !== fields) patch({ customFields: next })
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

  const copyValue = async (
    value: string,
    label: string,
    options: { quiet?: boolean } = {},
  ) => {
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
    // Les lignes de la fiche affichent « Copié » sur place.
    if (!options.quiet) toast(`${label} copié${suffix}`, 'success')
  }

  const importRecoveryCodes = (replace: boolean) => {
    if (draft.type !== 'recovery-codes') return
    const parsed = parseRecoveryCodes(recoveryImport)
    if (parsed.length === 0) {
      toast(tt('Aucun code détecté dans le texte.'), 'error')
      return
    }
    const existing = replace ? [] : draft.codes
    const known = new Set(existing.map((entry) => entry.code.toLowerCase()))
    const additions = parsed.filter((code) => !known.has(code.toLowerCase()))
    const codes = [
      ...existing,
      ...createRecoveryCodeEntries(additions, () => randomId('rc')),
    ].slice(0, MAX_RECOVERY_CODES)
    patch({ codes })
    setRecoveryImport('')
    toast(
      additions.length > 0
        ? `${additions.length} code${additions.length > 1 ? 's' : ''} importé${
            additions.length > 1 ? 's' : ''
          }`
        : tt('Ces codes sont déjà présents.'),
      additions.length > 0 ? 'success' : 'info',
    )
  }

  const updateRecoveryCodes = async (codes: RecoveryCode[]) => {
    if (!current || current.type !== 'recovery-codes') return
    try {
      const updated = await updateItem({
        ...current,
        codes,
      } as VaultItem)
      setCurrent(updated)
      setDraft({ ...updated })
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : tt('Mise à jour impossible'),
        'error',
      )
    }
  }

  const toggleRecoveryCode = async (code: RecoveryCode) => {
    if (!current || current.type !== 'recovery-codes') return
    await updateRecoveryCodes(
      setRecoveryCodeUsed(
        current,
        code.id,
        code.usedAt ? null : new Date().toISOString(),
      ).codes,
    )
  }

  const copyRecoveryCode = async (code: RecoveryCode) => {
    await copyValue(code.code, 'Code de secours')
    if (!code.usedAt && !trashed && vault?.role !== 'read') {
      setPendingRecoveryCode(code)
    }
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

    const nextDraft: ItemDraft = { ...draft, tags }
    // Une clé TOTP saisie devient un lien otpauth:// avec le titre et
    // l’identifiant définitifs ; un lien existant est conservé tel quel.
    if (
      nextDraft.type === 'login' &&
      draft.type === 'login' &&
      totpTyped &&
      totpTyped.uri === draft.totp
    ) {
      nextDraft.totp = normalizeTotpUri(
        totpTyped.text,
        nextDraft.title,
        nextDraft.username,
      )
    }
    if (nextDraft.type === 'recovery-codes') {
      nextDraft.codes = nextDraft.codes
        .map((entry) => ({
          ...entry,
          code: entry.code.trim(),
          usedAt: entry.usedAt || null,
        }))
        .filter((entry) => entry.code)
        .slice(0, MAX_RECOVERY_CODES)
    }
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
    // Repartir de la valeur enregistrée : la clé TOTP s’affiche normalisée.
    setTotpTyped(null)
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
        title: tt('{title} (copie)').replace('{title}', current.title),
        favorite: false,
        attachments: [],
      } as ItemDraft)
      toast(
        current.attachments.length > 0
          ? tt('Élément dupliqué, sans les pièces jointes')
          : tt('Élément dupliqué'),
        'success',
      )
      if (onDuplicated) onDuplicated(created)
      else onSaved?.(created)
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
      <ItemIcon type={itemType} item={current} size={22} />
    </span>
  )

  const canDuplicate = Boolean(
    current && !editing && !trashed && current.type !== 'passkey',
  )

  // ⌘D / Ctrl+D duplique l’élément affiché dans le panneau de détail.
  useEffect(() => {
    if (presentation !== 'panel' || !canDuplicate) return
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'd') return
      if (document.querySelector('.modal-overlay')) return
      event.preventDefault()
      void duplicateCurrent()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const duplicateButton = canDuplicate ? (
    <button
      type="button"
      className="icon-button icon-button--sm"
      onClick={() => void duplicateCurrent()}
      aria-label={tt('Dupliquer')}
      title={tt('Dupliquer (⌘D)')}
    >
      <CopyPlus size={17} />
    </button>
  ) : null

  const favoriteButton =
    current && !editing && !trashed ? (
      <>
      {duplicateButton}
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
      </>
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

  // Libellé masquable : le bouton devient une icône quand la place manque
  // (requêtes de conteneur sur le panneau), avec un nom accessible conservé.
  const label = (text: string, short?: string) =>
    short ? (
      <>
        <span className="button__label button__label--full">{text}</span>
        <span className="button__label button__label--short">{short}</span>
      </>
    ) : (
      <span className="button__label">{text}</span>
    )

  const primaryAction = editing ? (
    <>
      <button
        type="button"
        className="button button--ghost"
        onClick={cancelEditing}
        aria-label={tt('Annuler')}
        title={tt('Annuler')}
      >
        <X size={16} className="button__icon-compact" />
        {label(tt('Annuler'))}
      </button>
      <button
        type="button"
        className="button button--primary"
        onClick={() => void save()}
        disabled={busy || !draft.title.trim()}
        aria-label={tt('Enregistrer')}
        title={tt('Enregistrer')}
      >
        {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
        {label(busy ? tt('Enregistrement…') : tt('Enregistrer'))}
      </button>
    </>
  ) : trashed ? (
    <button
      type="button"
      className="button button--primary"
      onClick={() => void restoreCurrent()}
      aria-label={tt('Restaurer')}
      title={tt('Restaurer')}
    >
      <RotateCcw size={16} />
      {label(tt('Restaurer'))}
    </button>
  ) : current?.type !== 'passkey' ? (
    <button
      type="button"
      className="button button--primary"
      onClick={startEditing}
      aria-label={tt('Modifier')}
      title={tt('Modifier')}
    >
      <Pencil size={16} />
      {label(tt('Modifier'))}
    </button>
  ) : null

  const secondaryActions = editing ? null : (
    <>
      {!trashed && current?.type === 'login' && (
        <>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void copyValue(current.password, 'Mot de passe')}
            aria-label={tt('Copier le mot de passe')}
            title={tt('Copier le mot de passe')}
          >
            <Copy size={16} />
            {label(tt('Copier le mot de passe'), tt('Copier'))}
          </button>
          {isTauriRuntime() && (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setShowAutoType(true)}
              aria-label={tt('Saisie automatique')}
              title={tt('Saisie automatique')}
            >
              <Keyboard size={16} />
              {label(tt('Saisie automatique'), tt('Saisie'))}
            </button>
          )}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setShowAlias(true)}
            aria-label={tt('Alias e-mail')}
            title={tt('Alias e-mail')}
          >
            <AtSign size={16} />
            {label(tt('Alias e-mail'), tt('Alias'))}
          </button>
        </>
      )}
      {moreMenu}
    </>
  )

  // Fenêtre modale (création) : toutes les actions dans le pied.
  const headerActions = (
    <>
      {primaryAction}
      {secondaryActions}
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
        primary={primaryAction}
        secondary={secondaryActions}
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
                  {(['login', 'note', 'card', 'identity', 'ssh-key', 'wifi', 'api-credential', 'software-license', 'document', 'recovery-codes'] as ItemType[]).map((type) => (
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
                    <span className="field__label">{tt('Clé TOTP (2FA)')}</span>
                    <input
                      className="input input--mono"
                      value={
                        totpTyped && totpTyped.uri === draft.totp
                          ? totpTyped.text
                          : totpInputValue(draft.totp)
                      }
                      onChange={(event) => {
                        const text = event.target.value
                        const uri = normalizeTotpUri(text, draft.title, draft.username)
                        setTotpTyped({ text, uri })
                        patch({ totp: uri })
                      }}
                      placeholder="JBSW Y3DP EHPK 3PXP"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {draft.totp.trim() && !isTotpUri(draft.totp) ? (
                      <span className="field__hint field__hint--error">
                        {tt(
                          'Clé invalide : lettres A à Z et chiffres 2 à 7 (au moins 8 caractères), ou lien otpauth://.',
                        )}
                      </span>
                    ) : (
                      <span className="field__hint">
                        {tt(
                          'Saisissez la clé affichée par le site lors de l’activation de la 2FA (souvent sous le QR code). Un lien otpauth:// fonctionne aussi.',
                        )}
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

              {draft.type === 'software-license' && (
                <div className="form-grid">
                  <label className="field field--full">
                    <span className="field__label">{tt('Clé de licence')}</span>
                    <textarea
                      className="input input--mono"
                      rows={3}
                      value={draft.licenseKey}
                      onChange={(event) => patch({ licenseKey: event.target.value })}
                      maxLength={10_000}
                      placeholder={tt('XXXX-XXXX-XXXX-XXXX')}
                      spellCheck={false}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Licencié à')}</span>
                    <input
                      className="input"
                      value={draft.licensedTo}
                      onChange={(event) => patch({ licensedTo: event.target.value })}
                      maxLength={500}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Version')}</span>
                    <input
                      className="input"
                      value={draft.version}
                      onChange={(event) => patch({ version: event.target.value })}
                      maxLength={100}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Site web')}</span>
                    <input
                      className="input input--mono"
                      value={draft.website}
                      onChange={(event) => patch({ website: event.target.value })}
                      maxLength={2_000}
                      placeholder={tt('https://exemple.fr')}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Date d’achat')}</span>
                    <input
                      className="input"
                      type="date"
                      value={draft.purchaseDate}
                      onChange={(event) => patch({ purchaseDate: event.target.value })}
                    />
                  </label>
                </div>
              )}

              {draft.type === 'recovery-codes' && (
                <>
                  <div className="form-grid">
                    <label className="field field--full">
                      <span className="field__label">
                        {tt('Coller des codes de secours')}
                      </span>
                      <textarea
                        className="input textarea input--mono"
                        value={recoveryImport}
                        onChange={(event) => setRecoveryImport(event.target.value)}
                        rows={4}
                        placeholder={tt('Un code par ligne ou séparés par des espaces')}
                        maxLength={20_000}
                      />
                      <span className="field__hint">
                        {tt(
                          'Les puces, numéros de liste et doublons sont ignorés. Les codes restent chiffrés dans le coffre.',
                        )}
                      </span>
                    </label>
                  </div>
                  <div className="settings-actions settings-actions--start">
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => importRecoveryCodes(false)}
                      disabled={!recoveryImport.trim()}
                    >
                      <Download size={16} />
                      {tt('Ajouter les codes')}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => importRecoveryCodes(true)}
                      disabled={!recoveryImport.trim()}
                    >
                      <RotateCcw size={16} />
                      {tt('Remplacer la liste')}
                    </button>
                  </div>

                  <div className="recovery-code-list">
                    {draft.codes.length === 0 ? (
                      <p className="settings-copy">
                        {tt('Aucun code pour le moment.')}
                      </p>
                    ) : (
                      draft.codes.map((entry) => (
                        <div key={entry.id} className="recovery-code-row">
                          <input
                            className="input input--mono"
                            value={entry.code}
                            onChange={(event) =>
                              patch({
                                codes: draft.codes.map((candidate) =>
                                  candidate.id === entry.id
                                    ? { ...candidate, code: event.target.value }
                                    : candidate,
                                ),
                              })
                            }
                            maxLength={200}
                            aria-label={tt('Code de secours')}
                          />
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={Boolean(entry.usedAt)}
                              onChange={(event) =>
                                patch({
                                  codes: draft.codes.map((candidate) =>
                                    candidate.id === entry.id
                                      ? {
                                          ...candidate,
                                          usedAt: event.target.checked
                                            ? new Date().toISOString()
                                            : null,
                                        }
                                      : candidate,
                                  ),
                                })
                              }
                            />
                            <span>{tt('Utilisé')}</span>
                          </label>
                          <button
                            type="button"
                            className="icon-button icon-button--sm"
                            aria-label={tt('Supprimer ce code')}
                            onClick={() =>
                              patch({
                                codes: draft.codes.filter(
                                  (candidate) => candidate.id !== entry.id,
                                ),
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  {draft.codes.length < MAX_RECOVERY_CODES && (
                    <div className="settings-actions settings-actions--start">
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() =>
                          patch({
                            codes: [
                              ...draft.codes,
                              { id: randomId('rc'), code: '', usedAt: null },
                            ],
                          })
                        }
                      >
                        <Plus size={16} />
                        {tt('Ajouter un code')}
                      </button>
                    </div>
                  )}
                </>
              )}

              {draft.type === 'document' && (
                <div className="form-grid">
                  <label className="field">
                    <span className="field__label">{tt('Type de document')}</span>
                    <select
                      className="input"
                      value={draft.documentKind}
                      onChange={(event) =>
                        patch({ documentKind: event.target.value as DocumentKind })
                      }
                    >
                      {DOCUMENT_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind === 'identity'
                            ? tt('Identité')
                            : kind === 'contract'
                              ? tt('Contrat')
                              : kind === 'invoice'
                                ? tt('Facture')
                                : kind === 'certificate'
                                  ? tt('Certificat')
                                  : tt('Autre')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Émetteur')}</span>
                    <input
                      className="input"
                      value={draft.issuer}
                      onChange={(event) => patch({ issuer: event.target.value })}
                      maxLength={500}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Numéro du document')}</span>
                    <input
                      className="input input--mono"
                      value={draft.documentNumber}
                      onChange={(event) => patch({ documentNumber: event.target.value })}
                      maxLength={500}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{tt('Date d’émission')}</span>
                    <input
                      className="input"
                      type="date"
                      value={draft.issuedAt}
                      onChange={(event) => patch({ issuedAt: event.target.value })}
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
                    {(draft.customFields ?? []).map((field, fieldIndex) => (
                      <div
                        className={cx(
                          'custom-field',
                          dragFieldId === field.id && 'is-dragging',
                          dropFieldId === field.id &&
                            dragFieldId !== field.id &&
                            'is-drop-target',
                        )}
                        key={field.id}
                        onDragOver={(event) => {
                          if (!dragFieldId) return
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                          if (dropFieldId !== field.id) setDropFieldId(field.id)
                        }}
                        onDrop={(event) => {
                          if (!dragFieldId) return
                          event.preventDefault()
                          moveCustomField(dragFieldId, fieldIndex)
                          setDragFieldId(null)
                          setDropFieldId(null)
                        }}
                      >
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
                              {tt(CUSTOM_FIELD_TYPE_LABELS[type])}
                            </option>
                          ))}
                        </select>
                        <CustomFieldInput
                          field={field}
                          onChange={(value) => updateCustomField(field.id, { value })}
                        />
                        <div className="custom-field__tools">
                          {(draft.customFields ?? []).length > 1 && (
                            <button
                              type="button"
                              className="icon-button icon-button--sm custom-field__grip"
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', field.id)
                                const row = event.currentTarget.closest('.custom-field')
                                if (row) event.dataTransfer.setDragImage(row, 12, 12)
                                setDragFieldId(field.id)
                              }}
                              onDragEnd={() => {
                                setDragFieldId(null)
                                setDropFieldId(null)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'ArrowUp') {
                                  event.preventDefault()
                                  moveCustomField(field.id, fieldIndex - 1)
                                } else if (event.key === 'ArrowDown') {
                                  event.preventDefault()
                                  moveCustomField(field.id, fieldIndex + 1)
                                }
                              }}
                              aria-label={`${tt('Déplacer le champ')} ${field.label || tt('sans nom')}`}
                              title={tt('Glisser pour déplacer (ou flèches haut et bas)')}
                            >
                              <GripVertical size={15} />
                            </button>
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
                facts={facts}
                breachCheck={settings.breachCheck}
                onToggleFavorite={() => void toggleFavorite()}
                readOnly={trashed || vault?.role === 'read'}
                vaultReadOnly={vault?.role === 'read'}
                issue={issue}
                hasPasskeyForItem={hasPasskeyForItem}
                onGeneratePassword={() => setShowGenerator(true)}
                onEditItem={startEditing}
                onOpenItem={onOpenItem}
                attachmentBusy={attachmentBusy}
                attachmentError={attachmentError}
                onAddAttachment={uploadAttachments}
                onDownloadAttachment={saveAttachment}
                onDeleteAttachment={setAttachmentToDelete}
                onCopyRecoveryCode={copyRecoveryCode}
                onToggleRecoveryCode={toggleRecoveryCode}
              />
            </>
          ) : null}
        </div>
      </DialogSurface>


      {showGenerator && (
        <GeneratorDialog
          onClose={() => setShowGenerator(false)}
          onUse={(value) => void applyGeneratedPassword(value)}
          url={draft.type === 'login' ? draft.urls[0] : undefined}
          onRecord={recordGeneratedPassword}
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

      {pendingRecoveryCode && current?.type === 'recovery-codes' && (
        <ConfirmDialog
          title={tt('Marquer ce code comme utilisé ?')}
          description={tt(
            'Le code copié sera daté et ne sera plus proposé. Vous pourrez le rétablir depuis la fiche.',
          )}
          confirmLabel={tt('Marquer utilisé')}
          tone="primary"
          onClose={() => setPendingRecoveryCode(null)}
          onConfirm={async () => {
            await updateRecoveryCodes(
              setRecoveryCodeUsed(
                current,
                pendingRecoveryCode.id,
                new Date().toISOString(),
              ).codes,
            )
            setPendingRecoveryCode(null)
          }}
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
  copyValue: (
    value: string,
    label: string,
    options?: { quiet?: boolean },
  ) => Promise<void>
  copied: string | null
  facts: ItemSecurityFacts | null
  breachCheck: boolean
  onToggleFavorite: () => void
  /** Élément en corbeille : lecture seule, ni favori ni pièces jointes modifiables. */
  readOnly?: boolean
  vaultReadOnly?: boolean
  issue: ItemSecurityIssue | null
  hasPasskeyForItem: boolean
  onGeneratePassword: () => void
  onEditItem: () => void
  onOpenItem?: (itemId: string) => void
  attachmentBusy: boolean
  attachmentError: string | null
  onAddAttachment: (files: FileList | null) => Promise<void>
  onDownloadAttachment: (attachmentId: string) => Promise<void>
  onDeleteAttachment: (attachment: AttachmentMeta) => void
  onCopyRecoveryCode: (code: RecoveryCode) => Promise<void>
  onToggleRecoveryCode: (code: RecoveryCode) => Promise<void>
}

function ItemDetails({
  item,
  vaultName,
  revealed,
  toggleReveal,
  copyValue: copyWithToast,
  copied,
  facts,
  breachCheck,
  onToggleFavorite,
  readOnly = false,
  vaultReadOnly = false,
  issue,
  hasPasskeyForItem,
  onGeneratePassword,
  onEditItem,
  onOpenItem,
  attachmentBusy,
  attachmentError,
  onAddAttachment,
  onDownloadAttachment,
  onDeleteAttachment,
  onCopyRecoveryCode,
  onToggleRecoveryCode,
}: ItemDetailsProps) {
  const { tt, intl } = useI18n()
  const [showWifiQr, setShowWifiQr] = useState(false)
  // Dans la fiche, la copie se confirme dans la ligne, sans notification.
  const copyValue = (value: string, label: string) =>
    copyWithToast(value, label, { quiet: true })
  const changeUrl = item.type === 'login' ? changePasswordUrl(item.urls) : null
  const siteInfo =
    item.type === 'login'
      ? item.urls
          .map(hostFromUrl)
          .map((host) => (host ? siteSecurityForHost(host) : null))
          .find((info) => info !== null) ?? null
      : null
  const documentationUrl = siteInfo?.documentation
    ? safeUrl(siteInfo.documentation)
    : null
  const passkeyUrl =
    item.type === 'login'
      ? item.urls.map((url) => safeUrl(url)).find((url) => Boolean(url)) ?? null
      : null

  const passwordIssue =
    issue && PASSWORD_ISSUE_CATEGORIES.includes(issue.category) ? issue : null
  const otherIssue = issue && !passwordIssue ? issue : null
  const strength =
    item.type === 'login' && item.password
      ? passwordStrength(estimateEntropy(item.password))
      : null
  const issueBanner = (current: ItemSecurityIssue, inline: boolean) => (
    <div
      className={cx(
        'alert-banner',
        inline && 'alert-banner--inline',
        (current.category === 'weak' || current.category === 'breached') &&
          'alert-banner--danger',
      )}
      role="status"
      title={inline ? current.description : undefined}
    >
      <ShieldAlert size={17} />
      <div className="alert-banner__body">
        <strong>{current.label}</strong>
        <p>{current.description}</p>
      </div>
      <div className="alert-banner__actions">
        {current.category === 'weak' ||
        current.category === 'reused' ||
        current.category === 'similar' ? (
          <button
            type="button"
            className="button button--secondary button--sm"
            onClick={onGeneratePassword}
          >
            <Wand2 size={15} />
            Générer
          </button>
        ) : current.category === 'no2fa' || current.category === 'incomplete' ? (
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
  )

  return (
    <div className="item-detail">
      <div className="item-detail__toolbar">
        <div className="item-detail__identity">
          <span className={`item-icon item-icon--${item.type} item-icon--lg`}>
            <ItemIcon type={item.type} item={item} size={22} />
          </span>
          <div>
            <span className="item-detail__type">{itemTypeLabel(item.type)}</span>
            <span className="item-detail__vault">
              {vaultName}
              {vaultReadOnly ? ` · ${tt('Lecture seule')}` : ''}
            </span>
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

      {otherIssue && issueBanner(otherIssue, false)}

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
          {strength && (
            <div className="detail-health">
              <PasswordStrength entropy={estimateEntropy(item.password)} />
              {passwordIssue && issueBanner(passwordIssue, true)}
            </div>
          )}
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
          {siteInfo && siteInfo.twoFactor.length > 0 && (
            <div className="detail-row">
              <span className="detail-row__label">{tt("2FA disponible")}</span>
              <div className="detail-row__value detail-row__links">
                <span>
                  {siteInfo.twoFactor
                    .map((method) => tt(TWO_FACTOR_LABELS[method] ?? method))
                    .join(' · ')}
                </span>
                {documentationUrl && (
                  <a
                    href={documentationUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(event) => handleExternalClick(event, documentationUrl)}
                  >
                    {tt("Documentation")}
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          )}
          {siteInfo?.passkeys && !hasPasskeyForItem && passkeyUrl && !readOnly && (
            <div className="detail-row">
              <span className="detail-row__label">{tt("Passkey disponible")}</span>
              <div className="detail-row__value">
                <span>{tt("Ce site accepte les passkeys.")}</span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void openExternal(passkeyUrl)}
                >
                  {tt("Créer une passkey")}
                  <ExternalLink size={12} />
                </button>
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

      {item.type === 'software-license' && (
        <div className="detail-list">
          <SecretRow
            label="Clé de licence"
            value={item.licenseKey}
            revealed={revealed.has('license-key')}
            onToggle={() => toggleReveal('license-key')}
            onCopy={() => void copyValue(item.licenseKey, 'Clé de licence')}
            copied={copied === 'Clé de licence'}
          />
          <DetailRow label="Licencié à" value={item.licensedTo} />
          <DetailRow label="Version" value={item.version} />
          <DetailRow
            label="Site web"
            value={item.website}
            onCopy={() => void copyValue(item.website, 'Site web')}
            copied={copied === 'Site web'}
          />
          <DetailRow label="Date d’achat" value={item.purchaseDate} />
        </div>
      )}

      {item.type === 'recovery-codes' && (
        <div className="detail-list">
          <DetailRow
            label="Codes restants"
            value={`${remainingRecoveryCodes(item)} / ${item.codes.length}`}
          />
          {item.codes.length === 0 ? (
            <p className="settings-copy">{tt('Aucun code enregistré.')}</p>
          ) : (
            <div className="recovery-code-list">
              {item.codes.map((entry) => (
                <div
                  key={entry.id}
                  className={`recovery-code-row ${entry.usedAt ? 'is-used' : ''}`}
                >
                  <code className="recovery-code-row__value">{entry.code}</code>
                  <span className="recovery-code-row__status">
                    {entry.usedAt
                      ? `${tt('Utilisé le')} ${formatDateTime(entry.usedAt)}`
                      : tt('Disponible')}
                  </span>
                  <button
                    type="button"
                    className="icon-button icon-button--sm"
                    aria-label={tt('Copier ce code')}
                    title={tt('Copier ce code')}
                    onClick={() => void onCopyRecoveryCode(entry)}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => void onToggleRecoveryCode(entry)}
                    disabled={readOnly}
                  >
                    {entry.usedAt ? tt('Rétablir') : tt('Marquer utilisé')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {item.type === 'document' && (
        <div className="detail-list">
          <DetailRow
            label="Type de document"
            value={
              item.documentKind === 'identity'
                ? tt('Identité')
                : item.documentKind === 'contract'
                  ? tt('Contrat')
                  : item.documentKind === 'invoice'
                    ? tt('Facture')
                    : item.documentKind === 'certificate'
                      ? tt('Certificat')
                      : tt('Autre')
            }
          />
          <DetailRow label="Émetteur" value={item.issuer} />
          <DetailRow
            label="Numéro du document"
            value={item.documentNumber}
            onCopy={() => void copyValue(item.documentNumber, 'Numéro du document')}
            copied={copied === 'Numéro du document'}
            mono
          />
          <DetailRow label="Date d’émission" value={item.issuedAt} />
          <DetailRow
            label="Pièce jointe principale"
            value={item.attachments[0]?.name ?? ''}
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
            if (field.type === 'totp') {
              return (
                <div className="detail-row" key={field.id}>
                  <span className="detail-row__label">{field.label}</span>
                  <div className="detail-row__value">
                    {isTotpUri(field.value) ? (
                      <TotpCode uri={field.value} />
                    ) : (
                      <span className="is-empty">{tt('Clé TOTP invalide')}</span>
                    )}
                  </div>
                </div>
              )
            }

            if (field.type === 'checkbox') {
              return (
                <DetailRow
                  key={field.id}
                  label={field.label}
                  value={field.value === 'true' ? tt('Oui') : tt('Non')}
                />
              )
            }

            if (field.type === 'date' || field.type === 'month') {
              return (
                <DetailRow
                  key={field.id}
                  label={field.label}
                  value={
                    field.type === 'date'
                      ? formatCustomDate(field.value, intl)
                      : formatCustomMonth(field.value, intl)
                  }
                  onCopy={() => void copyValue(field.value, field.label)}
                  copied={copied === field.label}
                />
              )
            }

            if (isSecretFieldType(field.type)) {
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
                        onClick={() => void copyWithToast(field.value, field.label)}
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
                mono={field.type === 'number' || field.type === 'phone'}
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

      {item.type === 'login' && facts && (
        <SecurityFacts
          facts={facts}
          strength={strength}
          breachCheck={breachCheck}
          hasTotp={Boolean(item.totp.trim())}
          twoFactorAvailable={Boolean(siteInfo && siteInfo.twoFactor.length > 0)}
          onOpenItem={onOpenItem}
        />
      )}

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
  const copyable = Boolean(value && onCopy)
  return (
    <div
      className={cx('detail-row', copyable && 'detail-row--copyable', copied && 'is-copied')}
      onClick={copyable ? (event) => copyFromRow(event, onCopy) : undefined}
    >
      <span className="detail-row__label">{label}</span>
      <span className={`detail-row__value ${mono ? 'mono' : ''} ${value ? '' : 'is-empty'}`}>
        <span className="detail-row__text">{value || '—'}</span>
        {value && onCopy && (
          <span className="detail-row__actions">
            <CopiedHint copied={copied} />
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

/** Copie au clic sur la ligne, sauf sur un bouton, un lien ou une sélection. */
function copyFromRow(event: ReactMouseEvent<HTMLElement>, onCopy?: () => void) {
  if (!onCopy) return
  const target = event.target as HTMLElement
  if (target.closest('button, a, input, select, textarea')) return
  if (window.getSelection()?.toString()) return
  onCopy()
}

function CopiedHint({ copied }: { copied?: boolean }) {
  const { tt } = useI18n()
  return (
    <span className="detail-row__copied" role="status">
      {copied ? tt('Copié') : ''}
    </span>
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
    <div
      className={cx('detail-row', value && 'detail-row--copyable', copied && 'is-copied')}
      onClick={value ? (event) => copyFromRow(event, onCopy) : undefined}
    >
      <span className="detail-row__label">{label}</span>
      <span className={`detail-row__value ${mono || !revealed ? 'mono' : ''}`}>
        <span className="detail-row__text">
          {value ? (revealed ? value : mask(value)) : '—'}
        </span>
        {value && (
          <span className="detail-row__actions">
            <CopiedHint copied={copied} />
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

type FactTone = 'ok' | 'warn' | 'danger' | 'neutral'

function SecurityFacts({
  facts,
  strength,
  breachCheck,
  hasTotp,
  twoFactorAvailable,
  onOpenItem,
}: {
  facts: ItemSecurityFacts
  strength: { score: number; label: string } | null
  breachCheck: boolean
  hasTotp: boolean
  twoFactorAvailable: boolean
  onOpenItem?: (itemId: string) => void
}) {
  const { tt } = useI18n()
  const age =
    facts.ageDays === null
      ? tt('Inconnue')
      : facts.ageDays === 0
        ? tt('Aujourd’hui')
        : facts.ageDays === 1
          ? tt('Hier')
          : facts.ageDays < 60
            ? tt('Il y a {count} jours').replace('{count}', String(facts.ageDays))
            : facts.ageDays < 365
              ? tt('Il y a {count} mois').replace(
                  '{count}',
                  String(Math.floor(facts.ageDays / 30)),
                )
              : tt('Il y a plus d’un an')
  const rows: { label: string; value: string; tone: FactTone }[] = [
    {
      label: tt('Robustesse'),
      value: strength ? tt(strength.label) : tt('Aucun mot de passe'),
      tone: !strength ? 'neutral' : strength.score <= 1 ? 'danger' : strength.score === 2 ? 'warn' : 'ok',
    },
    {
      label: tt('Dernière modification'),
      value: age,
      tone: facts.old ? 'warn' : 'neutral',
    },
    {
      label: tt('Réutilisation'),
      value:
        facts.reusedWith === 0
          ? facts.similar
            ? tt('Proche d’un autre mot de passe')
            : tt('Mot de passe unique')
          : facts.reusedWith === 1
            ? tt('Utilisé par 1 autre compte')
            : tt('Utilisé par {count} autres comptes').replace(
                '{count}',
                String(facts.reusedWith),
              ),
      tone: facts.reusedWith > 0 ? 'danger' : facts.similar ? 'warn' : 'ok',
    },
    {
      label: tt('Fuites connues'),
      value: !breachCheck
        ? tt('Vérification désactivée')
        : facts.breached
          ? tt('Présent dans une fuite')
          : tt('Aucune fuite connue'),
      tone: !breachCheck ? 'neutral' : facts.breached ? 'danger' : 'ok',
    },
    {
      label: tt('Double authentification'),
      value: hasTotp
        ? tt('Configurée')
        : twoFactorAvailable
          ? tt('Disponible, non configurée')
          : tt('Non renseignée'),
      tone: hasTotp ? 'ok' : twoFactorAvailable ? 'warn' : 'neutral',
    },
  ]

  return (
    <section className="detail-section security-facts" aria-label={tt('Sécurité')}>
      <span className="detail-row__label">{tt('Sécurité')}</span>
      <ul className="security-facts__list">
        {rows.map((row) => (
          <li key={row.label} className={`security-fact security-fact--${row.tone}`}>
            <span className="security-fact__dot" aria-hidden="true" />
            <span className="security-fact__label">{row.label}</span>
            <span className="security-fact__value">{row.value}</span>
          </li>
        ))}
      </ul>
      {facts.reusedWithItems.length > 0 && (
        <div className="security-reuse">
          <span className="security-reuse__title">
            {tt('Comptes qui partagent ce mot de passe')}
          </span>
          <ul className="security-reuse__list">
            {facts.reusedWithItems.map((other) => {
              const host =
                other.urls
                  .map((url) => hostFromUrl(url))
                  .find((value) => Boolean(value)) ?? ''
              const meta = [other.username.trim(), host].filter(Boolean).join(' · ')
              const label =
                other.title.trim() || other.username.trim() || tt('Sans titre')
              const content = (
                <>
                  <span
                    className={`item-icon item-icon--${other.type} security-reuse__icon`}
                  >
                    <ItemIcon type={other.type} item={other} size={15} />
                  </span>
                  <span className="security-reuse__identity">
                    <span className="security-reuse__name">{label}</span>
                    {meta && <span className="security-reuse__meta">{meta}</span>}
                  </span>
                  {onOpenItem && (
                    <ChevronRight
                      size={16}
                      className="security-reuse__chevron"
                      aria-hidden="true"
                    />
                  )}
                </>
              )
              return (
                <li key={other.id}>
                  {onOpenItem ? (
                    <button
                      type="button"
                      className="security-reuse__item"
                      onClick={() => onOpenItem(other.id)}
                      aria-label={tt('Ouvrir {title}').replace('{title}', label)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="security-reuse__item">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
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

/** Saisie d’une valeur de champ personnalisé, adaptée à son type. */
function CustomFieldInput({
  field,
  onChange,
}: {
  field: CustomField
  onChange: (value: string) => void
}) {
  const { tt } = useI18n()
  const [visible, setVisible] = useState(false)
  const label = `${tt('Valeur de')} ${field.label || tt('champ')}`
  const invalid = !isCustomFieldValueValid(field.type, field.value)

  let control: ReactNode
  if (field.type === 'multiline') {
    control = (
      <textarea
        className="input textarea custom-field__value"
        value={field.value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        maxLength={10_000}
        placeholder={tt('Valeur')}
        aria-label={label}
      />
    )
  } else if (field.type === 'checkbox') {
    control = (
      <label className="checkbox custom-field__value">
        <input
          type="checkbox"
          checked={field.value === 'true'}
          onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
          aria-label={label}
        />
        <span>{tt('Oui')}</span>
      </label>
    )
  } else if (isSecretFieldType(field.type) && field.type !== 'totp') {
    control = (
      <span className="custom-field__secret">
        <input
          className="input input--mono custom-field__value"
          type={visible ? 'text' : 'password'}
          value={field.value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={field.type === 'pin' ? 12 : 10_000}
          inputMode={field.type === 'pin' ? 'numeric' : undefined}
          placeholder={tt('Valeur')}
          autoComplete="off"
          aria-label={label}
        />
        <button
          type="button"
          className="icon-button icon-button--sm"
          onClick={() => setVisible((value) => !value)}
          aria-label={tt(visible ? 'Masquer' : 'Afficher')}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </span>
    )
  } else {
    const inputType =
      field.type === 'url'
        ? 'url'
        : field.type === 'email'
          ? 'email'
          : field.type === 'phone'
            ? 'tel'
            : field.type === 'date'
              ? 'date'
              : field.type === 'month'
                ? 'month'
                : 'text'
    control = (
      <input
        className={`input custom-field__value ${
          field.type === 'totp' || field.type === 'number' ? 'input--mono' : ''
        }`}
        type={inputType}
        value={field.type === 'totp' ? totpInputValue(field.value) : field.value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={10_000}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        placeholder={
          field.type === 'totp'
            ? 'JBSW Y3DP EHPK 3PXP'
            : field.type === 'email'
              ? 'nom@exemple.fr'
              : tt('Valeur')
        }
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
      />
    )
  }

  return (
    <span className="custom-field__input">
      {control}
      {invalid && (
        <span className="field__hint field__hint--error">
          {tt('Valeur inhabituelle pour ce type de champ.')}
        </span>
      )}
    </span>
  )
}
