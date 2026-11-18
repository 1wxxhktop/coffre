/**
 * Catalogue de champs prédéfinis proposés dans les champs personnalisés.
 *
 * Chaque entrée reprend un champ réellement proposé par un formulaire
 * d’élément. Choisir une entrée renseigne le libellé et le type de saisie ;
 * l’utilisateur reste libre de modifier le libellé ensuite.
 */

import type { CustomFieldType } from './types'

export interface CustomFieldPreset {
  label: string
  type: CustomFieldType
  group: string
}

export const CUSTOM_FIELD_PRESETS: CustomFieldPreset[] = [
  { group: 'Connexion', label: 'Identifiant', type: 'text' },
  { group: 'Connexion', label: 'Mot de passe', type: 'password' },
  { group: 'Connexion', label: 'Adresse web', type: 'url' },
  { group: 'Connexion', label: 'Clé TOTP', type: 'totp' },
  { group: 'Connexion', label: 'Alias e-mail', type: 'email' },

  { group: 'Compte et carte', label: 'Titulaire du compte', type: 'text' },
  { group: 'Compte et carte', label: 'Banque', type: 'text' },
  { group: 'Compte et carte', label: 'IBAN', type: 'iban' },
  { group: 'Compte et carte', label: 'BIC / SWIFT', type: 'bic' },
  { group: 'Compte et carte', label: 'Numéro de compte', type: 'hidden' },
  { group: 'Compte et carte', label: 'Routing / sort code', type: 'text' },
  { group: 'Compte et carte', label: 'Agence', type: 'text' },
  { group: 'Compte et carte', label: 'Devise', type: 'currency' },
  { group: 'Compte et carte', label: 'Titulaire de la carte', type: 'text' },
  { group: 'Compte et carte', label: 'Numéro de carte', type: 'card' },
  { group: 'Compte et carte', label: 'Expiration de la carte', type: 'month' },
  { group: 'Compte et carte', label: 'CVC', type: 'pin' },
  { group: 'Compte et carte', label: 'Code PIN', type: 'pin' },
  { group: 'Compte et carte', label: 'Réseau / type', type: 'text' },

  { group: 'Identité', label: 'Prénom', type: 'text' },
  { group: 'Identité', label: 'Nom', type: 'text' },
  { group: 'Identité', label: 'E-mail', type: 'email' },
  { group: 'Identité', label: 'Téléphone', type: 'phone' },
  { group: 'Identité', label: 'Adresse', type: 'text' },
  { group: 'Identité', label: 'Ville', type: 'text' },
  { group: 'Identité', label: 'Code postal', type: 'text' },
  { group: 'Identité', label: 'Pays', type: 'text' },
  { group: 'Identité', label: 'Date de naissance', type: 'date' },
  { group: 'Identité', label: 'Expiration du passeport', type: 'date' },
  { group: 'Identité', label: 'Expiration de la carte d’identité', type: 'date' },
  { group: 'Identité', label: 'Expiration du permis de conduire', type: 'date' },

  { group: 'Clé SSH', label: 'Clé privée', type: 'multiline' },
  { group: 'Clé SSH', label: 'Clé publique', type: 'multiline' },
  { group: 'Clé SSH', label: 'Empreinte', type: 'text' },
  { group: 'Clé SSH', label: 'Commentaire', type: 'text' },

  { group: 'Wi-Fi', label: 'SSID', type: 'text' },
  { group: 'Wi-Fi', label: 'Mot de passe Wi-Fi', type: 'password' },
  { group: 'Wi-Fi', label: 'Sécurité', type: 'text' },
  { group: 'Wi-Fi', label: 'Réseau masqué', type: 'checkbox' },

  { group: 'Identifiant d’API', label: 'Identifiant de clé', type: 'text' },
  { group: 'Identifiant d’API', label: 'Secret', type: 'password' },
  { group: 'Identifiant d’API', label: 'Environnement', type: 'text' },
  { group: 'Identifiant d’API', label: 'Point de terminaison', type: 'url' },
  { group: 'Identifiant d’API', label: 'Échéance', type: 'date' },

  { group: 'Licence logicielle', label: 'Clé de licence', type: 'multiline' },
  { group: 'Licence logicielle', label: 'Licencié à', type: 'text' },
  { group: 'Licence logicielle', label: 'Version', type: 'text' },
  { group: 'Licence logicielle', label: 'Site web', type: 'url' },
  { group: 'Licence logicielle', label: 'Date d’achat', type: 'date' },

  { group: 'Document', label: 'Type de document', type: 'text' },
  { group: 'Document', label: 'Émetteur', type: 'text' },
  { group: 'Document', label: 'Numéro du document', type: 'text' },
  { group: 'Document', label: 'Date d’émission', type: 'date' },

  { group: 'Note', label: 'Contenu de la note', type: 'multiline' },
  { group: 'Codes de secours', label: 'Code de secours', type: 'multiline' },
  { group: 'Passkey', label: 'Site (RP ID)', type: 'text' },
  { group: 'Passkey', label: 'Identifiant utilisateur', type: 'text' },
]

/** Entrées uniques par libellé, dans l’ordre du catalogue. */
export const UNIQUE_CUSTOM_FIELD_PRESETS: CustomFieldPreset[] = (() => {
  const seen = new Set<string>()
  return CUSTOM_FIELD_PRESETS.filter((preset) => {
    const key = preset.label.toLocaleLowerCase('fr')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
})()

/** Catalogue unique regroupé par domaine, pour les listes déroulantes. */
export const CUSTOM_FIELD_PRESET_GROUPS: Array<{
  group: string
  presets: CustomFieldPreset[]
}> = (() => {
  const groups: Array<{ group: string; presets: CustomFieldPreset[] }> = []
  for (const preset of UNIQUE_CUSTOM_FIELD_PRESETS) {
    const existing = groups.find((entry) => entry.group === preset.group)
    if (existing) existing.presets.push(preset)
    else groups.push({ group: preset.group, presets: [preset] })
  }
  return groups
})()

/** Retrouve un préréglage par son libellé exact (insensible à la casse). */
export function customFieldPresetForLabel(
  label: string,
): CustomFieldPreset | undefined {
  const normalized = label.trim().toLocaleLowerCase('fr')
  if (!normalized) return undefined
  return UNIQUE_CUSTOM_FIELD_PRESETS.find(
    (preset) => preset.label.toLocaleLowerCase('fr') === normalized,
  )
}
