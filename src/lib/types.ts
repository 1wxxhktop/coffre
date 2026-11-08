/**
 * Types partagés du coffre.
 *
 * Le modèle d'éléments s'inspire de `protonpass/pass-contents-proto-definition`
 * (item_v1.proto) : types login / note / carte / identité, champs libres et
 * sections personnalisées. Le format de fichier, lui, est propre à Coffre.
 */

export const ITEM_TYPES = ['login', 'note', 'card', 'identity', 'passkey'] as const

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
  /**
   * Date d’échéance ou de révision (AAAA-MM-JJ), vide si aucune. Pour une
   * connexion, sert de rappel « mot de passe à changer avant ».
   */
  expiresAt: string
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
  /** Dates d’expiration des documents (AAAA-MM-JJ), vides si non renseignées. */
  passportExpiry: string
  idCardExpiry: string
  licenseExpiry: string
}

/**
 * Passkey WebAuthn. La clé privée PKCS#8 et la clé publique COSE sont stockées
 * dans le contenu chiffré de l’élément ; l’extension ne les reçoit jamais.
 */
export interface PasskeyItem extends ItemBase {
  type: 'passkey'
  /** Domaine du relying party (sans schéma). */
  rpId: string
  /** Identifiant utilisateur WebAuthn, base64url. */
  userHandle: string
  userName: string
  /** Identifiant de credential, base64url. */
  credentialId: string
  /** Clé privée ECDSA P-256 PKCS#8, base64. */
  privateKey: string
  /** Clé publique COSE ES256, base64. */
  publicKeyCose: string
  signCount: number
}

export type VaultItem =
  | LoginItem
  | NoteItem
  | CardItem
  | IdentityItem
  | PasskeyItem

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

/**
 * Horloge de Lamport d’un enregistrement (format 4). `rev` est incrémenté à
 * chaque mutation et `writer` identifie l’appareil qui a écrit en dernier ; le
 * couple sert à départager les modifications concurrentes lors d’une fusion.
 */
export interface RecordClock {
  rev: number
  writer: string
}

export interface EncryptedVaultRecord {
  id: string
  key: Sealed
  name: Sealed
  createdAt: string
  updatedAt: string
  clock?: RecordClock
}

export interface EncryptedItemRecord {
  id: string
  vaultId: string
  key: Sealed
  content: Sealed
  createdAt: string
  updatedAt: string
  clock?: RecordClock
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
 * Suppression définitive conservée en clair pour que les autres appareils
 * puissent la rejouer lors d’une fusion. Le contenu supprimé n’est plus présent.
 */
export interface VaultTombstone {
  kind: 'item' | 'vault'
  id: string
  deletedAt: string
}

/**
 * MAC global du fichier. `key` est une clé HMAC aléatoire scellée par la clé
 * maîtresse ; `mac` couvre un manifeste canonique de tous les enregistrements.
 */
export interface VaultIntegrity {
  mac: string
  key: Sealed
}

/** Plus haute révision vue pour un fichier, conservée hors du fichier. */
export interface VaultRevisionState {
  fileId: string
  revision: number
  updatedAt: string
}

/**
 * Format de fichier `.coffre` (versions 1 à 4).
 *
 * Tout le contenu (noms des coffres, éléments, identifiants de connexion, notes,
 * historique) est chiffré. Seuls les identifiants aléatoires, les dates, les
 * paramètres KDF et, si elle est configurée, l’enveloppe de récupération sont
 * visibles. Les fichiers versions 1 et 2 restent lisibles et sont migrés à
 * l’écriture.
 *
 * La version 4 ajoute les champs `writer`, `revision`, `keyEpoch`, `tombstones`
 * et `integrity`. Ils sont absents d’un fichier antérieur ; la première
 * écriture le migre.
 */
export interface VaultFile {
  format: 'coffre'
  version: 1 | 2 | 3 | 4
  id: string
  createdAt: string
  updatedAt: string
  kdf: KdfParams
  vaults: EncryptedVaultRecord[]
  items: EncryptedItemRecord[]
  attachments: EncryptedAttachmentRecord[]
  versions: EncryptedVersionRecord[]
  recovery?: RecoveryEnvelope
  /** Identifiant aléatoire de l’appareil qui a écrit en dernier (v4). */
  writer?: string
  /** Compteur monotone du fichier, incrémenté à chaque écriture (v4). */
  revision?: number
  /** Époque des clés, incrémentée à chaque rotation (v4). */
  keyEpoch?: number
  /** Suppressions définitives récentes, pour la synchronisation (v4). */
  tombstones?: VaultTombstone[]
  /** MAC global (v4). */
  integrity?: VaultIntegrity
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
  /** Langue de l’interface et des dates. */
  language: 'fr' | 'en'
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
  /** Afficher des notifications locales pour les échéances proches. */
  expiryNotifications: boolean
  /** Vérifier les mots de passe dans les fuites connues, en k-anonymat. */
  breachCheck: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'fr',
  theme: 'dark',
  autoLockMinutes: 5,
  clipboardClearSeconds: 30,
  lockOnHide: true,
  lockOnFocusLoss: false,
  trashRetentionDays: 30,
  keychainUnlock: false,
  biometricUnlock: false,
  expiryNotifications: false,
  breachCheck: false,
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
    expiresAt: '',
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
        passportExpiry: '',
        idCardExpiry: '',
        licenseExpiry: '',
      }
    case 'passkey':
      return {
        ...base,
        type: 'passkey',
        rpId: '',
        userHandle: '',
        userName: '',
        credentialId: '',
        privateKey: '',
        publicKeyCose: '',
        signCount: 0,
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
    case 'passkey':
      return item.userName || item.rpId || 'Passkey'
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
    case 'passkey':
      return 'Passkey'
  }
}
