/**
 * Protocole local entre l’application Coffre et son extension navigateur.
 *
 * L’extension ne stocke aucun secret : elle demande à l’onglet Coffre
 * déverrouillé les identifiants du site courant, puis les injecte dans la page
 * active. Aucun message ne quitte la machine.
 */

import type { LoginItem, VaultItem } from './types'

export const EXTENSION_BRIDGE_VERSION = 1
export const EXTENSION_MAX_RESULTS = 50

export interface ExtensionLoginSummary {
  id: string
  title: string
  username: string
  host: string
  hasTotp: boolean
}

export interface ExtensionCredentials {
  id: string
  title: string
  username: string
  password: string
  totp: string
}

export interface CoffreExtensionBridge {
  version: number
  search: (query: string) => Promise<ExtensionLoginSummary[]>
  fill: (itemId: string) => Promise<ExtensionCredentials | null>
}

declare global {
  interface Window {
    __coffreExtension?: CoffreExtensionBridge
  }
}

export function hostFromUrl(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function hostMatches(itemHost: string, pageHost: string): boolean {
  if (!itemHost || !pageHost) return false
  return (
    itemHost === pageHost ||
    itemHost.endsWith(`.${pageHost}`) ||
    pageHost.endsWith(`.${itemHost}`)
  )
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Classe les connexions correspondant à une URL ou à un texte libre.
 * Sans requête, renvoie les connexions les plus récentes (limitées).
 */
export function searchLogins(
  items: VaultItem[],
  query: string,
): ExtensionLoginSummary[] {
  const raw = query.trim()
  const host = raw.includes('.') || raw === 'localhost' ? hostFromUrl(raw) : ''
  const text = normalize(raw)

  const scored = items
    .filter(
      (item): item is LoginItem => item.type === 'login' && !item.deletedAt,
    )
    .map((item) => {
      const hosts = item.urls.map(hostFromUrl).filter(Boolean)
      const hostMatch = host ? hosts.some((entry) => hostMatches(entry, host)) : false
      const textMatch =
        text.length > 0 &&
        (normalize(item.title).includes(text) ||
          normalize(item.username).includes(text) ||
          hosts.some((entry) => entry.includes(text)))
      const score = hostMatch ? 2 : textMatch ? 1 : 0
      return { item, hosts, score }
    })

  const matches = scored.filter((entry) => entry.score > 0)
  const selected = raw ? matches : scored

  return selected
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.title.localeCompare(b.item.title, 'fr', { sensitivity: 'base' }),
    )
    .slice(0, EXTENSION_MAX_RESULTS)
    .map(({ item, hosts }) => ({
      id: item.id,
      title: item.title,
      username: item.username,
      host: hosts[0] ?? '',
      hasTotp: Boolean(item.totp),
    }))
}
