/**
 * Codes de secours 2FA : import par collage, état d’utilisation et alertes.
 *
 * Les codes sont des secrets : ce module ne les journalise jamais et ne les
 * indexe pas dans la recherche. La liste est chiffrée avec le contenu de
 * l’élément.
 */

import type {
  RecoveryCode,
  RecoveryCodesItem,
  VaultItem,
} from './types'

/** Nombre maximal de codes par élément, aligné sur le schéma Zod. */
export const MAX_RECOVERY_CODES = 100

/** Nombre restant à partir duquel le tableau de bord alerte. */
export const LOW_RECOVERY_CODE_THRESHOLD = 2

const HEADER_LINE =
  /^(?:codes?\s+de\s+secours|recovery\s+codes?|backup\s+codes?)\b/i
const SHORT_HEADER = /^(?:codes?|secours|utilisé|used)\s*:?\s*$/i

function cleanToken(value: string): string {
  return value
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/[.,;:]+$/g, '')
    .trim()
}

/**
 * Extrait les codes d’un bloc de texte : un par ligne, ou séparés par des
 * espaces, virgules ou points-virgules. Les puces et numéros de liste sont
 * ignorés. Les doublons sont supprimés sans tenir compte de la casse.
 */
export function parseRecoveryCodes(input: string): string[] {
  const codes: string[] = []
  const seen = new Set<string>()
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || HEADER_LINE.test(trimmed) || SHORT_HEADER.test(trimmed)) {
      continue
    }
    const withoutBullet = trimmed.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '')
    for (const part of withoutBullet.split(/[\s,;]+/)) {
      const token = cleanToken(part)
      if (token.length < 4 || token.length > 200) continue
      if (!/[A-Za-z0-9]/.test(token)) continue
      const key = token.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      codes.push(token)
      if (codes.length >= MAX_RECOVERY_CODES) return codes
    }
  }
  return codes
}

/** Nombre de codes encore utilisables. */
export function remainingRecoveryCodes(item: RecoveryCodesItem): number {
  return item.codes.filter((code) => !code.usedAt).length
}

/** Éléments actifs dont il reste au plus deux codes. */
export function lowRecoveryCodeItems(items: VaultItem[]): RecoveryCodesItem[] {
  return items.filter(
    (item): item is RecoveryCodesItem =>
      item.type === 'recovery-codes' &&
      !item.deletedAt &&
      remainingRecoveryCodes(item) <= LOW_RECOVERY_CODE_THRESHOLD,
  )
}

/** Marque un code utilisé, ou le rend de nouveau disponible. */
export function setRecoveryCodeUsed(
  item: RecoveryCodesItem,
  codeId: string,
  usedAt: string | null,
): RecoveryCodesItem {
  return {
    ...item,
    codes: item.codes.map((code) =>
      code.id === codeId ? { ...code, usedAt } : code,
    ),
  }
}

/** Texte long utilisé par les exports CSV, CXF et KDBX. */
export function recoveryCodesExportText(item: RecoveryCodesItem): string {
  return item.codes
    .map((code) =>
      code.usedAt ? `${code.code} (utilisé le ${code.usedAt})` : code.code,
    )
    .join('\n')
}

/** Convertit des codes bruts en entrées prêtes à être enregistrées. */
export function createRecoveryCodeEntries(
  codes: string[],
  idFactory: () => string,
): RecoveryCode[] {
  return codes.map((code) => ({ id: idFactory(), code, usedAt: null }))
}
