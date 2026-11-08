import { useEffect } from 'react'
import { useVault } from '../state/VaultProvider'
import { generateTotp, isTotpUri, parseTotpUri } from '../lib/totp'
import {
  EXTENSION_BRIDGE_VERSION,
  hostFromUrl,
  searchLogins,
  type CoffreExtensionBridge,
} from '../lib/extensionProtocol'

/**
 * Expose une passerelle locale à l’extension navigateur lorsque le coffre est
 * déverrouillé. Elle disparaît au verrouillage et ne persiste rien.
 */
export function ExtensionBridge() {
  const { status, items } = useVault()

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
      async fill(itemId) {
        const item = items.find(
          (candidate) => candidate.id === itemId && !candidate.deletedAt,
        )
        if (!item || item.type !== 'login') return null

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
          hosts: item.urls.map(hostFromUrl).filter(Boolean),
        }
      },
    }

    window.__coffreExtension = bridge
    return () => {
      if (window.__coffreExtension === bridge) {
        delete window.__coffreExtension
      }
    }
  }, [status, items])

  return null
}
