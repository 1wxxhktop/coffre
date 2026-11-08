/**
 * Mode voyage (F6).
 *
 * L’état est local à l’appareil et n’est jamais synchronisé : il ne doit pas
 * propager une suppression de coffres aux autres appareils. Les enregistrements
 * masqués sont retirés du fichier local sans pierre tombale, puis restaurés
 * depuis une source de synchronisation à la désactivation.
 */

import type { VaultFile } from './types'

export interface TravelModeState {
  enabled: boolean
  safeVaultIds: string[]
}

const STORAGE_KEY = 'coffre.travel-mode.v1'

function readAll(): Record<string, TravelModeState> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, TravelModeState>
  } catch {
    return {}
  }
}

function writeAll(value: Record<string, TravelModeState>): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

export function getTravelMode(fileId: string): TravelModeState | null {
  const state = readAll()[fileId]
  if (!state || typeof state.enabled !== 'boolean') return null
  return {
    enabled: state.enabled,
    safeVaultIds: Array.isArray(state.safeVaultIds)
      ? state.safeVaultIds.filter((id): id is string => typeof id === 'string')
      : [],
  }
}

export function setTravelMode(fileId: string, state: TravelModeState): void {
  const all = readAll()
  all[fileId] = {
    enabled: state.enabled,
    safeVaultIds: Array.from(new Set(state.safeVaultIds)),
  }
  writeAll(all)
}

export function clearTravelMode(fileId: string): void {
  const all = readAll()
  delete all[fileId]
  writeAll(all)
}

/**
 * Retire du fichier les coffres non marqués « sûrs pour le voyage », ainsi que
 * leurs éléments, pièces jointes et versions. Les pierres tombales existantes
 * sont conservées : elles ne contiennent aucun ciphertext et servent à la
 * fusion.
 */
export function stripVaultForTravel(
  file: VaultFile,
  safeVaultIds: string[],
): VaultFile {
  const safe = new Set(safeVaultIds)
  if (safe.size === 0) {
    throw new Error('Sélectionnez au moins un coffre sûr pour le voyage.')
  }
  const hiddenVaultIds = new Set(
    file.vaults.map((vault) => vault.id).filter((id) => !safe.has(id)),
  )
  const hiddenItemIds = new Set(
    file.items
      .filter((item) => hiddenVaultIds.has(item.vaultId))
      .map((item) => item.id),
  )
  return {
    ...file,
    vaults: file.vaults.filter((vault) => safe.has(vault.id)),
    items: file.items.filter((item) => !hiddenVaultIds.has(item.vaultId)),
    attachments: file.attachments.filter(
      (attachment) => !hiddenVaultIds.has(attachment.vaultId),
    ),
    versions: file.versions.filter(
      (version) => !hiddenItemIds.has(version.itemId),
    ),
  }
}

/** Vrai si le fichier ne contient plus de ciphertext pour ces coffres. */
export function hasHiddenVaultCiphertext(
  file: VaultFile,
  hiddenVaultIds: string[],
): boolean {
  const hidden = new Set(hiddenVaultIds)
  return (
    file.vaults.some((vault) => hidden.has(vault.id)) ||
    file.items.some((item) => hidden.has(item.vaultId)) ||
    file.attachments.some((attachment) => hidden.has(attachment.vaultId))
  )
}
