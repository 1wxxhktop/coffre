/**
 * Formatage de saisie des numéros.
 *
 * Ces fonctions ne valident pas les données : elles ajoutent seulement les
 * séparateurs habituels pendant la frappe. L’enregistrement reste responsable
 * de la normalisation finale.
 */

/** IBAN : majuscules, sans séparateur, groupes de quatre caractères. */
export function formatIbanInput(value: string): string {
  const compact = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 34)
  return compact.replace(/(.{4})(?=.)/g, '$1 ').trim()
}

/** Numéro de carte : chiffres groupés par quatre, format Amex 4-6-5. */
export function formatCardNumberInput(value: string): string {
  const compact = value.replace(/\D/g, '').slice(0, 19)
  if (compact.startsWith('34') || compact.startsWith('37')) {
    return [
      compact.slice(0, 4),
      compact.slice(4, 10),
      compact.slice(10, 15),
    ]
      .filter(Boolean)
      .join(' ')
  }
  return compact.replace(/(.{4})(?=.)/g, '$1 ').trim()
}

/** Chiffres et espaces d’un numéro de carte, sans groupement automatique. */
export function sanitizeCardNumber(value: string): string {
  return value.replace(/[^\d ]/g, '')
}

/**
 * Téléphone : format français national (`06 12 34 56 78`) ou international
 * `+33 6 12 34 56 78`. Les autres formats sont laissés tels quels.
 */
export function formatPhoneInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const plus = trimmed.startsWith('+')
  const compact = trimmed.replace(/\D/g, '').slice(0, 15)

  if (plus && compact.startsWith('33') && compact.length <= 11) {
    const rest = compact.slice(2)
    const grouped =
      rest.length > 1
        ? `${rest[0]} ${rest.slice(1).replace(/(\d{2})(?=\d)/g, '$1 ')}`
        : rest
    return grouped ? `+33 ${grouped}` : '+33'
  }

  if (!plus && compact.startsWith('0') && compact.length <= 10) {
    return compact.replace(/(\d{2})(?=\d)/g, '$1 ')
  }

  return trimmed
}

/** Code de routage / sort code : paires (6 chiffres) ou 3-3-3 (9 chiffres). */
export function formatSortCodeInput(value: string): string {
  const trimmed = value.trim()
  // Certains pays utilisent un code alphanumérique : ne pas le destructurer.
  if (!trimmed) return ''
  if (!/^[\d\s-]+$/.test(trimmed)) return trimmed
  const compact = trimmed.replace(/\D/g, '').slice(0, 9)
  if (compact.length === 0) return ''
  if (compact.length <= 6) {
    return compact.replace(/(\d{2})(?=\d)/g, '$1-')
  }
  return `${compact.slice(0, 3)}-${compact.slice(3, 6)}-${compact.slice(6)}`
}
