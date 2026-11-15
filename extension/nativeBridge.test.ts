// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBridgeKeyPair } from '../src/lib/bridgeProtocol'

interface FakePort {
  onMessage: { addListener: (listener: (message: unknown) => void) => void }
  onDisconnect: { addListener: (listener: () => void) => void }
  postMessage: (message: Record<string, unknown>) => void
  disconnect: () => void
}

interface Harness {
  chrome: Record<string, unknown>
  nativePair: () => Promise<{ ok?: true; error?: string }>
  state: {
    pairBegins: number
    unlockRequests: number
    helloLaunches: boolean[]
    paired: boolean
  }
}

async function createHarness(): Promise<Harness> {
  const state = {
    pairBegins: 0,
    unlockRequests: 0,
    helloLaunches: [] as boolean[],
    paired: false,
  }
  let unlocked = false
  let session = 'session-test'
  let portListeners: Array<(message: unknown) => void> = []
  const storage: Record<string, unknown> = {}

  const reply = (message: Record<string, unknown>) => {
    for (const listener of portListeners) listener(message)
  }

  const handle = async (
    message: Record<string, unknown>,
    send: (response: Record<string, unknown>) => void,
  ) => {
    const id = String(message.id ?? '')
    if (message.type === 'hello') {
      state.helloLaunches.push(message.launch === true)
      send({
        id,
        type: 'hello',
        session,
        paired: state.paired,
        unlocked,
      })
      return
    }
    if (message.type === 'status') {
      send({
        id,
        type: 'status',
        unlocked,
        paired: state.paired,
        extensionVersion: '0.16.0',
      })
      return
    }
    if (message.type === 'unlock-request') {
      state.unlockRequests += 1
      unlocked = true
      send({ id, type: 'focused' })
      return
    }
    if (message.type === 'pair-begin') {
      state.pairBegins += 1
      const app = await createBridgeKeyPair()
      setTimeout(() => {
        send({
          id,
          type: 'pair-pending',
          code: '123456',
          publicKey: app.publicKey,
        })
        // Laisser le temps à l’extension de traiter la clé publique avant
        // l’acceptation.
        setTimeout(() => {
          state.paired = true
          send({ id, type: 'pair-accepted', session })
        }, 20)
      }, 0)
      return
    }
    if (message.type === 'enc') {
      // La vérification post-appairage peut échouer transitoirement : elle ne
      // doit pas invalider une clé déjà enregistrée des deux côtés.
      send({ id, type: 'protocol-error', error: 'locked' })
    }
  }

  const chrome = {
    runtime: {
      connectNative: () => {
        portListeners = []
        const port: FakePort = {
          onMessage: {
            addListener: (listener) => portListeners.push(listener),
          },
          onDisconnect: { addListener: () => undefined },
          postMessage: (message) => {
            void handle(message, reply)
          },
          disconnect: () => undefined,
        }
        return port
      },
      getPlatformInfo: async () => ({}),
      getManifest: () => ({ version: '0.16.0' }),
      sendMessage: async () => undefined,
    },
    storage: {
      local: {
        get: async (key: string) =>
          key in storage ? { [key]: storage[key] } : {},
        set: async (values: Record<string, unknown>) => {
          Object.assign(storage, values)
        },
        remove: async (key: string) => {
          delete storage[key]
        },
      },
    },
  }

  vi.stubGlobal('chrome', chrome)
  vi.resetModules()
  const module = await import('./nativeBridge')
  return { chrome, nativePair: module.nativePair, state }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('appairage du pont natif', () => {
  it('lance Coffre, attend le déverrouillage et ne crée qu’une tentative', async () => {
    const harness = await createHarness()
    const first = harness.nativePair()
    const second = harness.nativePair()
    expect(second).toBe(first)

    await expect(first).resolves.toEqual({ ok: true })
    await expect(second).resolves.toEqual({ ok: true })

    expect(harness.state.helloLaunches).toEqual([true])
    expect(harness.state.unlockRequests).toBe(1)
    expect(harness.state.pairBegins).toBe(1)
    expect(harness.state.paired).toBe(true)
  })

  it('ne remplace pas une association existante', async () => {
    const harness = await createHarness()
    await harness.nativePair()
    await expect(harness.nativePair()).resolves.toEqual({ ok: true })
    // Un nouveau clic sur « Associer » ne doit pas générer une nouvelle clé.
    expect(harness.state.pairBegins).toBe(1)
  })
})
