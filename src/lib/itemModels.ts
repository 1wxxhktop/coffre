/**
 * Modèles intégrés pour tous les types d’éléments du coffre.
 *
 * Ces descriptions sont la référence affichée dans Réglages → Modèles. Elles
 * reprennent les champs réellement proposés par le formulaire de chaque type ;
 * les champs communs (titre, coffre, étiquettes, notes, pièces jointes) sont
 * ajoutés à la carte.
 */

import type { ItemType } from './types'

export type ModelFieldKind =
  | 'text'
  | 'secret'
  | 'url'
  | 'date'
  | 'multiline'
  | 'select'
  | 'boolean'
  | 'number'
  | 'file'

export interface ModelField {
  label: string
  kind: ModelFieldKind
}

export interface ItemModel {
  type: ItemType
  name: string
  icon: string
  description: string
  fields: ModelField[]
  /** Les passkeys se créent par WebAuthn, pas à la main. */
  creatable: boolean
}

export const COMMON_MODEL_FIELDS: ModelField[] = [
  { label: 'Titre', kind: 'text' },
  { label: 'Coffre', kind: 'select' },
  { label: 'Étiquettes', kind: 'text' },
  { label: 'Rappel d’échéance', kind: 'date' },
  { label: 'Notes', kind: 'multiline' },
  { label: 'Champs personnalisés', kind: 'text' },
  { label: 'Pièces jointes', kind: 'file' },
]

export const ITEM_MODELS: ItemModel[] = [
  {
    type: 'login',
    name: 'Connexion',
    icon: '🔑',
    description: 'Identifiants, mot de passe, adresses du site et 2FA.',
    creatable: true,
    fields: [
      { label: 'Identifiant', kind: 'text' },
      { label: 'Mot de passe', kind: 'secret' },
      { label: 'Adresses du site', kind: 'url' },
      { label: 'Code TOTP (otpauth://)', kind: 'secret' },
    ],
  },
  {
    type: 'note',
    name: 'Note sécurisée',
    icon: '📝',
    description: 'Texte libre, secrets ponctuels et champs personnalisés.',
    creatable: true,
    fields: [{ label: 'Contenu de la note', kind: 'multiline' }],
  },
  {
    type: 'card',
    name: 'Carte bancaire',
    icon: '💳',
    description: 'Carte de paiement avec titulaire, numéro, CVC et PIN.',
    creatable: true,
    fields: [
      { label: 'Titulaire', kind: 'text' },
      { label: 'Numéro de carte', kind: 'secret' },
      { label: 'Expiration', kind: 'text' },
      { label: 'CVC', kind: 'secret' },
      { label: 'Code PIN', kind: 'secret' },
      { label: 'Réseau / type', kind: 'text' },
    ],
  },
  {
    type: 'identity',
    name: 'Identité',
    icon: '🪪',
    description: 'État civil, coordonnées et dates des documents.',
    creatable: true,
    fields: [
      { label: 'Prénom', kind: 'text' },
      { label: 'Nom', kind: 'text' },
      { label: 'E-mail', kind: 'text' },
      { label: 'Téléphone', kind: 'text' },
      { label: 'Adresse', kind: 'text' },
      { label: 'Ville', kind: 'text' },
      { label: 'Code postal', kind: 'text' },
      { label: 'Pays', kind: 'text' },
      { label: 'Date de naissance', kind: 'date' },
      { label: 'Expiration du passeport', kind: 'date' },
      { label: 'Expiration de la carte d’identité', kind: 'date' },
      { label: 'Expiration du permis de conduire', kind: 'date' },
    ],
  },
  {
    type: 'passkey',
    name: 'Passkey',
    icon: '🔐',
    description: 'Clé WebAuthn liée à un domaine, créée depuis un site.',
    creatable: false,
    fields: [
      { label: 'Domaine (RP ID)', kind: 'text' },
      { label: 'Nom d’utilisateur', kind: 'text' },
      { label: 'Identifiant utilisateur', kind: 'secret' },
      { label: 'Identifiant de credential', kind: 'secret' },
      { label: 'Clé privée', kind: 'secret' },
      { label: 'Clé publique COSE', kind: 'secret' },
      { label: 'Compteur de signature', kind: 'number' },
    ],
  },
  {
    type: 'ssh-key',
    name: 'Clé SSH',
    icon: '🖥️',
    description: 'Paire de clés OpenSSH, empreinte et commentaire.',
    creatable: true,
    fields: [
      { label: 'Clé privée', kind: 'secret' },
      { label: 'Clé publique', kind: 'multiline' },
      { label: 'Empreinte', kind: 'text' },
      { label: 'Commentaire', kind: 'text' },
    ],
  },
  {
    type: 'wifi',
    name: 'Réseau Wi-Fi',
    icon: '📶',
    description: 'SSID, mot de passe, sécurité et réseau masqué.',
    creatable: true,
    fields: [
      { label: 'SSID', kind: 'text' },
      { label: 'Mot de passe', kind: 'secret' },
      { label: 'Sécurité', kind: 'select' },
      { label: 'Réseau masqué', kind: 'boolean' },
    ],
  },
  {
    type: 'api-credential',
    name: 'Identifiant d’API',
    icon: '🧩',
    description: 'Clé d’API, secret, environnement et point de terminaison.',
    creatable: true,
    fields: [
      { label: 'Identifiant de clé', kind: 'text' },
      { label: 'Secret', kind: 'secret' },
      { label: 'Environnement', kind: 'text' },
      { label: 'Point de terminaison', kind: 'url' },
    ],
  },
  {
    type: 'software-license',
    name: 'Licence logicielle',
    icon: '🏷️',
    description: 'Clé de licence, titulaire, version et site de l’éditeur.',
    creatable: true,
    fields: [
      { label: 'Clé de licence', kind: 'secret' },
      { label: 'Licencié à', kind: 'text' },
      { label: 'Version', kind: 'text' },
      { label: 'Site web', kind: 'url' },
      { label: 'Date d’achat', kind: 'date' },
    ],
  },
  {
    type: 'document',
    name: 'Document',
    icon: '📄',
    description: 'Document administratif avec émetteur, numéro et pièce jointe.',
    creatable: true,
    fields: [
      { label: 'Type de document', kind: 'select' },
      { label: 'Émetteur', kind: 'text' },
      { label: 'Numéro du document', kind: 'text' },
      { label: 'Date d’émission', kind: 'date' },
      { label: 'Pièce jointe principale', kind: 'file' },
    ],
  },
]

export function itemModel(type: ItemType): ItemModel {
  return ITEM_MODELS.find((model) => model.type === type) ?? ITEM_MODELS[0]
}
