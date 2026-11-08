import { useEffect } from 'react'
import { useVault } from '../state/VaultProvider'
import { generateTotp, isTotpUri, parseTotpUri } from '../lib/totp'
import {
  createPasskeyInVault,
  getPasskeyAssertion,
  toExtensionCreateResult,
  toExtensionGetResult,
} from '../lib/passkeyBridge'
import {
  EXTENSION_BRIDGE_VERSION,
  hostFromUrl,
  loginAllowsHost,
  searchLogins,
  type CoffreExtensionBridge,
} from '../lib/extensionProtocol'
import { emptyDraft, type LoginItem } from '../lib/types'

/**
 * Expose une passerelle locale à l’extension navigateur lorsque le coffre est
 * déverrouillé. Elle disparaît au verrouillage et ne persiste rien.
 */
export function ExtensionBridge() {
  const { status, items, vaults, addItem, updateItem } = useVault()

  useEffect(() => {
    if (status !== 'unlocked') {
      delete window.__coffreExtension
      return
    }

    const bridge: CoffreExtensionBridge = {
      version: EXTENSION_BRIDGE_VERSION,
      async search(query) {
        return searchLogins(items, query)
      },
      async fill(itemId, host) {
        const item = items.find(
          (candidate) => candidate.id === itemId && !candidate.deletedAt,
        )
        if (!item || item.type !== 'login') return null
        if (host && !loginAllowsHost(item, host)) return null

        let totp = ''
        if (item.totp && isTotpUri(item.totp)) {
          try {
            totp = await generateTotp(parseTotpUri(item.totp))
          } catch {
            totp = ''
          }
        }

        return {
          id: item.id,
          title: item.title,
          username: item.username,
          password: item.password,
          totp,
        }
      },
      async saveLogin(input) {
        const host = hostFromUrl(input.host) || input.host.trim().toLowerCase()
        if (!host || !input.password) return null
        const username = input.username.trim()
        const existing = items.find(
          (item): item is LoginItem =>
            item.type === 'login' &&
            !item.deletedAt &&
            item.username.trim().toLowerCase() === username.toLowerCase() &&
            loginAllowsHost(item, host),
        )
        if (existing) {
          await updateItem({
            ...existing,
            password: input.password,
            urls:
              existing.urls.filter(Boolean).length > 0
                ? existing.urls
                : [`https://${host}`],
          })
          return { id: existing.id, updated: true }
        }
        const vaultId = vaults[0]?.id
        if (!vaultId) return null
        const item = await addItem({
          ...emptyDraft('login', vaultId),
          title: input.title?.trim() || host,
          username,
          password: input.password,
          urls: [`https://${host}`],
          type: 'login',
          totp: '',
        })
        return { id: item.id, updated: false }
      },
      async passkeyCreate(input) {
        try {
          const result = await createPasskeyInVault(
            { items, vaults, addItem },
            {
              rpId: input.rpId,
              origin: input.origin,
              challenge: input.challenge,
              userName: input.userName,
              userHandle: input.userHandle,
              excludeCredentials: input.excludeCredentials,
            },
          )
          return toExtensionCreateResult(result)
        } catch {
          return null
        }
      },
      async passkeyGet(input) {
        try {
          const result = await getPasskeyAssertion(items, {
            rpId: input.rpId,
            origin: input.origin,
            challenge: input.challenge,
            allowCredentials: input.allowCredentials,
          })
          return result ? toExtensionGetResult(result) : null
        } catch {
          return null
        }
      },
    }

    window.__coffreExtension = bridge
    return () => {
      if (window.__coffreExtension === bridge) {
        delete window.__coffreExtension
      }
    }
  }, [status, items, vaults, addItem, updateItem])

  return null
}
