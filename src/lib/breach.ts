/**
 * Surveillance optionnelle des fuites connues, en k-anonymat.
 *
 * Le mot de passe n’est jamais envoyé. Seuls les cinq premiers caractères
 * hexadécimaux de son SHA-1 sortent de l’appareil, avec l’en-tête
 * `Add-Padding` de Have I Been Pwned. Aucun hash ni résultat n’est persisté.
 */

import { invoke } from '@tauri-apps/api/core'
import { sha1Hex } from './crypto'
import { isTauriRuntime } from './external'
import type { LoginItem, VaultItem } from './types'

export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/'
export const HIBP_PREFIX_LENGTH = 5
const MAX_RANGE_BYTES = 2_000_000
const REQUEST_TIMEOUT_MS = 15_000

export class BreachCheckError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BreachCheckError'
  }
}

export interface BreachScanResult {
  /** Identifiants des éléments dont le mot de passe figure dans une fuite. */
  breachedItemIds: string[]
  /** Nombre de mots de passe distincts vérifiés. */
  checkedPasswords: number
  /** Nombre de préfixes réseau demandés. */
  checkedPrefixes: number
}

export type HibpRangeFetcher = (prefix: string) => Promise<string>

/** Valide et normalise le préfixe avant tout appel réseau. */
export function normalizeHibpPrefix(value: string): string {
  const prefix = value.trim().toUpperCase()
  if (!new RegExp(`^[0-9A-F]{${HIBP_PREFIX_LENGTH}}$`).test(prefix)) {
    throw new BreachCheckError('Préfixe HIBP invalide')
  }
  return prefix
}

/**
 * Parse la réponse HIBP : une ligne `SUFFIXE:OCCURRENCES` par hash. Les
 * lignes de remplissage (`Add-Padding`) sont conservées mais ne peuvent pas
 * correspondre à un suffixe réel.
 */
export function parseHibpRange(body: string): Map<string, number> {
  if (typeof body !== 'string' || body.length > MAX_RANGE_BYTES) {
    throw new BreachCheckError('Réponse HIBP invalide')
  }
  const range = new Map<string, number>()
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim().toUpperCase()
    const match = /^([0-9A-F]{35}):(\d+)$/.exec(line)
    if (!match) continue
    const count = Number(match[2])
    if (Number.isSafeInteger(count) && count >= 0) {
      range.set(match[1], count)
    }
  }
  return range
}

async function requestWebRange(prefix: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
      method: 'GET',
      headers: { 'Add-Padding': 'true' },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new BreachCheckError(`HIBP ${response.status}`)
    }
    const body = await response.text()
    if (body.length > MAX_RANGE_BYTES) {
      throw new BreachCheckError('Réponse HIBP trop volumineuse')
    }
    return body
  } catch (error) {
    if (error instanceof BreachCheckError) throw error
    throw new BreachCheckError('Vérification réseau impossible', {
      cause: error,
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Récupère une plage HIBP. Sur desktop, la requête passe par Rust afin que la
 * CSP de la WebView reste sans `connect-src` externe. Sur le Web, l’hôte
 * `api.pwnedpasswords.com` est autorisé dans `public/_headers`.
 */
export async function fetchHibpRange(prefix: string): Promise<string> {
  const normalized = normalizeHibpPrefix(prefix)
  if (isTauriRuntime()) {
    try {
      return await invoke<string>('hibp_range', { prefix: normalized })
    } catch (error) {
      throw new BreachCheckError('Vérification réseau impossible', {
        cause: error,
      })
    }
  }
  return requestWebRange(normalized)
}

function activePasswordGroups(
  items: VaultItem[],
): Map<string, LoginItem[]> {
  const groups = new Map<string, LoginItem[]>()
  for (const item of items) {
    if (item.type !== 'login' || item.deletedAt || !item.password) continue
    const group = groups.get(item.password)
    if (group) group.push(item)
    else groups.set(item.password, [item])
  }
  return groups
}

/**
 * Vérifie tous les mots de passe actifs. Le fetcher est injectable pour les
 * tests réseau : il ne reçoit qu’un préfixe de cinq caractères.
 */
export async function scanBreaches(
  items: VaultItem[],
  fetcher: HibpRangeFetcher = fetchHibpRange,
): Promise<BreachScanResult> {
  const groups = activePasswordGroups(items)
  if (groups.size === 0) {
    return {
      breachedItemIds: [],
      checkedPasswords: 0,
      checkedPrefixes: 0,
    }
  }

  const byPrefix = new Map<
    string,
    Array<{ suffix: string; items: LoginItem[] }>
  >()
  for (const [password, passwordItems] of groups) {
    const hash = await sha1Hex(password)
    const prefix = hash.slice(0, HIBP_PREFIX_LENGTH)
    const suffix = hash.slice(HIBP_PREFIX_LENGTH)
    const entries = byPrefix.get(prefix)
    if (entries) entries.push({ suffix, items: passwordItems })
    else byPrefix.set(prefix, [{ suffix, items: passwordItems }])
  }

  const breached = new Set<string>()
  for (const [prefix, entries] of byPrefix) {
    const range = parseHibpRange(await fetcher(prefix))
    for (const entry of entries) {
      if ((range.get(entry.suffix) ?? 0) <= 0) continue
      for (const item of entry.items) breached.add(item.id)
    }
  }

  return {
    breachedItemIds: [...breached],
    checkedPasswords: groups.size,
    checkedPrefixes: byPrefix.size,
  }
}
