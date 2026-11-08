import { describe, expect, it } from 'vitest'
import {
  BridgeCryptoError,
  createBridgeKeyPair,
  decryptBridgePayload,
  deriveBridgeSessionKey,
  encryptBridgePayload,
  bridgePairingCode,
} from './bridgeProtocol'

describe('protocole du pont natif', () => {
  it('dérive la même clé de session des deux côtés', async () => {
    const app = await createBridgeKeyPair()
    const extension = await createBridgeKeyPair()

    const appKey = await deriveBridgeSessionKey(
      app.privateKey,
      app.publicKey,
      extension.publicKey,
    )
    const extensionKey = await deriveBridgeSessionKey(
      extension.privateKey,
      extension.publicKey,
      app.publicKey,
    )
    expect(appKey).toBe(extensionKey)
    expect(atob(appKey)).toHaveLength(32)
  })

  it('chiffre et déchiffre une requête dans les deux sens', async () => {
    const app = await createBridgeKeyPair()
    const extension = await createBridgeKeyPair()
    const key = await deriveBridgeSessionKey(
      app.privateKey,
      app.publicKey,
      extension.publicKey,
    )

    const request = { type: 'search', query: 'github' }
    const encrypted = await encryptBridgePayload(
      key,
      'session-1',
      1,
      'extension-to-app',
      request,
    )
    await expect(
      decryptBridgePayload(key, 'session-1', 1, 'extension-to-app', encrypted),
    ).resolves.toEqual(request)

    const response = { type: 'search-result', items: [] }
    const encryptedResponse = await encryptBridgePayload(
      key,
      'session-1',
      1,
      'app-to-extension',
      response,
    )
    await expect(
      decryptBridgePayload(
        key,
        'session-1',
        1,
        'app-to-extension',
        encryptedResponse,
      ),
    ).resolves.toEqual(response)
  })

  it('refuse un mauvais compteur, une mauvaise direction ou une autre clé', async () => {
    const app = await createBridgeKeyPair()
    const extension = await createBridgeKeyPair()
    const other = await createBridgeKeyPair()
    const key = await deriveBridgeSessionKey(
      app.privateKey,
      app.publicKey,
      extension.publicKey,
    )
    const otherKey = await deriveBridgeSessionKey(
      other.privateKey,
      other.publicKey,
      extension.publicKey,
    )

    const encrypted = await encryptBridgePayload(
      key,
      'session-1',
      4,
      'extension-to-app',
      { type: 'search' },
    )

    await expect(
      decryptBridgePayload(key, 'session-1', 3, 'extension-to-app', encrypted),
    ).rejects.toBeInstanceOf(BridgeCryptoError)
    await expect(
      decryptBridgePayload(key, 'session-1', 4, 'app-to-extension', encrypted),
    ).rejects.toBeInstanceOf(BridgeCryptoError)
    await expect(
      decryptBridgePayload(otherKey, 'session-1', 4, 'extension-to-app', encrypted),
    ).rejects.toBeInstanceOf(BridgeCryptoError)
    await expect(
      decryptBridgePayload(key, 'session-2', 4, 'extension-to-app', encrypted),
    ).rejects.toBeInstanceOf(BridgeCryptoError)
  })

  it('génère un code d’appairage à six chiffres', () => {
    for (let index = 0; index < 20; index++) {
      expect(bridgePairingCode()).toMatch(/^\d{6}$/)
    }
  })
})
