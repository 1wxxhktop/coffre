/**
 * Types partagés du coffre.
 *
 * Le modèle d'éléments s'inspire de `protonpass/pass-contents-proto-definition`
 * (item_v1.proto) : types login / note / carte / identité, champs libres et
 * sections personnalisées. Le format de fichier, lui, est propre à Coffre.
 */

export const ITEM_TYPES = ['login', 'note', 'card', 'identity'] as const

export type ItemType = (typeof ITEM_TYPES)[number]

export const CUSTOM_FIELD_TYPES = ['text', 'hidden', 'url', 'multiline'] as const

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

/** Champ libre défini par l’utilisateur, chiffré avec le contenu de l’élément. */
export interface CustomField {
  id: string
  label: string
  value: string
  type: CustomFieldType
}

/** Métadonnées d’une pièce jointe ; le contenu binaire est chiffré séparément. */
export interface AttachmentMeta {
  id: string
  name: string
  mime: string
  size: number
  createdAt: string
}

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_ITEM = 10
export const MAX_ATTACHMENTS_TOTAL_BYTES = 25 * 1024 * 1024
export const MAX_VAULT_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const MAX_CUSTOM_FIELDS = 30
/** Nombre de versions conservées par élément. */
export const MAX_ITEM_VERSIONS = 20
/** Plafond global pour éviter qu’un historique ne fasse exploser le fichier. */
export const MAX_STORED_VERSIONS = 2_000

export interface ItemBase {
  id: string
  vaultId: string
  type: ItemType
  title: string
  favorite: boolean
  notes: string
  tags: string[]
  customFields: CustomField[]
  attachments: AttachmentMeta[]
  /** Date de mise à la corbeille ; `null` pour un élément actif. */
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface LoginItem extends ItemBase {
  type: 'login'
  username: string
  password: string
  urls: string[]
  totp: string
}

export interface NoteItem extends ItemBase {
  type: 'note'
}

export interface CardItem extends ItemBase {
  type: 'card'
  cardholder: string
  number: string
  expiry: string
  cvc: string
  pin: string
  brand: string
}

export interface IdentityItem extends ItemBase {
  type: 'identity'
  firstName: string
  lastName: string
  email: string
  phone: string
  address: string
  city: string
  postalCode: string
  country: string
  birthDate: string
}

export type VaultItem = LoginItem | NoteItem | CardItem | IdentityItem

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** Contenu déchiffré d'un élément, sans les métadonnées de stockage. */
export type ItemContent = DistributiveOmit<
  VaultItem,
  'id' | 'vaultId' | 'createdAt' | 'updatedAt'
>

export type ItemDraft = ItemContent & { id?: string; vaultId: string }

/** Paramètres Argon2id stockés en clair dans l'en-tête du fichier. */
export interface KdfParams {
  algorithm: 'argon2id'
  salt: string
  memoryKiB: number
  iterations: number
  parallelism: number
  keyLength: number
}

/** Données scellées : nonce + ciphertext, encodés en base64. */
export interface Sealed {
  n: string
  c: string
}

export interface EncryptedVaultRecord {
  id: string
  key: Sealed
  name: Sealed
  createdAt: string
  updatedAt: string
}

export interface EncryptedItemRecord {
  id: string
  vaultId: string
  key: Sealed
  content: Sealed
  createdAt: string
  updatedAt: string
}

/** Pièce jointe chiffrée avec la clé de son élément. */
export interface EncryptedAttachmentRecord {
  id: string
  itemId: string
  vaultId: string
  data: Sealed
  createdAt: string
}

/**
 * Version précédente du contenu d’un élément, chiffrée avec la clé de cet
 * élément et une AAD propre à la version.
 */
export interface EncryptedVersionRecord {
  id: string
  itemId: string
  vaultId: string
  content: Sealed
  createdAt: string
}

/**
 * Enveloppe de récupération optionnelle.
 *
 * La phrase de récupération dérive une clé qui scelle `key` (clé de récupération
 * aléatoire). Cette même clé est scellée une seconde fois par la clé maîtresse
 * (`guard`) afin que l’application puisse maintenir l’enveloppe sans redemander
 * la phrase, par exemple à l’ajout d’un coffre ou au changement de mot de passe.
 * Chaque clé de coffre est ensuite scellée par la clé de récupération.
 */
export interface RecoveryWrap {
  vaultId: string
  key: Sealed
}

export interface RecoveryEnvelope {
  version: 1
  /** Paramètres Argon2id propres à la phrase de récupération. */
  kdf: KdfParams
  createdAt: string
  key: Sealed
  guard: Sealed
  wraps: RecoveryWrap[]
}

/**
 * Format de fichier `.coffre` (version 3).
 *
 * Tout le contenu (noms des coffres, éléments, identifiants de connexion, notes,
 * historique) est chiffré. Seuls les identifiants aléatoires, les dates, les
 * paramètres KDF et, si elle est configurée, l’enveloppe de récupération sont
 * visibles. Les fichiers versions 1 et 2 restent lisibles et sont migrés à
 * l’écriture.
 */
export interface VaultFile {
  format: 'coffre'
  version: 1 | 2 | 3
  id: string
  createdAt: string
  updatedAt: string
  kdf: KdfParams
  vaults: EncryptedVaultRecord[]
  items: EncryptedItemRecord[]
  attachments: EncryptedAttachmentRecord[]
  versions: EncryptedVersionRecord[]
  recovery?: RecoveryEnvelope
}

export interface VaultSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  itemCount: number
}

export type VaultStatus = 'loading' | 'empty' | 'locked' | 'unlocked' | 'error'

export type ThemePreference = 'dark' | 'light' | 'system'

export interface AppSettings {
  theme: ThemePreference
  autoLockMinutes: number
  clipboardClearSeconds: number
  lockOnHide: boolean
  /** Desktop : verrouiller lorsque la fenêtre perd le focus. */
  lockOnFocusLoss: boolean
  /** Durée de conservation de la corbeille ; 0 = jamais purger automatiquement. */
  trashRetentionDays: number
  /** Desktop : mémoriser la clé maîtresse dans le trousseau du système. */
  keychainUnlock: boolean
  /** Desktop macOS : déverrouiller par empreinte (Touch ID). */
  biometricUnlock: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  autoLockMinutes: 5,
  clipboardClearSeconds: 30,
  lockOnHide: true,
  lockOnFocusLoss: false,
  trashRetentionDays: 30,
  keychainUnlock: false,
  biometricUnlock: false,
}

export function isItemType(value: unknown): value is ItemType {
  return typeof value === 'string' && (ITEM_TYPES as readonly string[]).includes(value)
}

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return (
    typeof value === 'string' &&
    (CUSTOM_FIELD_TYPES as readonly string[]).includes(value)
  )
}

export function emptyDraft(type: ItemType, vaultId: string): ItemDraft {
  const base = {
    vaultId,
    type,
    title: '',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
  }

  switch (type) {
    case 'login':
      return { ...base, type: 'login', username: '', password: '', urls: [''], totp: '' }
    case 'note':
      return { ...base, type: 'note' }
    case 'card':
      return {
        ...base,
        type: 'card',
        cardholder: '',
        number: '',
        expiry: '',
        cvc: '',
        pin: '',
        brand: '',
      }
    case 'identity':
      return {
        ...base,
        type: 'identity',
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        postalCode: '',
        country: '',
        birthDate: '',
      }
  }
}

export function itemSubtitle(item: VaultItem): string {
  switch (item.type) {
    case 'login':
      return item.username || item.urls.find(Boolean) || 'Connexion'
    case 'note':
      return item.notes.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Note sécurisée'
    case 'card':
      return item.number ? `•••• ${item.number.replace(/\s/g, '').slice(-4)}` : 'Carte bancaire'
    case 'identity': {
      const name = [item.firstName, item.lastName].filter(Boolean).join(' ')
      return name || item.email || 'Identité'
    }
  }
}

export function itemTypeLabel(type: ItemType): string {
  switch (type) {
    case 'login':
      return 'Connexion'
    case 'note':
      return 'Note'
    case 'card':
      return 'Carte'
    case 'identity':
      return 'Identité'
  }
}
