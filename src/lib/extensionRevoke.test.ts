// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Clé d’appairage simulée côté application.
const native = vi.hoisted(() => ({
  key: null as string | null,
  failDelete: false,
  keepAfterDelete: false,
  calls: [] as string[],
}))

vi.mock('./invoke', () => ({
  invoke: async (command: string) => {
    native.calls.push(command)
    if (command === 'bridge_key_load') return native.key
    if (command === 'bridge_key_delete') {
      if (native.failDelete) throw new Error('refusé')
      if (!native.keepAfterDelete) native.key = null
      return null
    }
    throw new Error(`commande inattendue : ${command}`)
  },
}))

import {
  BRIDGE_FORGET_EVENT,
  hasExtensionPairing,
  revokeExtensionPairing,
} from './extensionInstall'

const tauriWindow = window as unknown as Record<string, unknown>

beforeEach(() => {
  tauriWindow.__TAURI_INTERNALS__ = {}
  native.key = 'q83vEjRWeJCrze8BI0VniavN7wEjRWeJq83vASNFZ4k='
  native.failDelete = false
  native.keepAfterDelete = false
  native.calls = []
})

afterEach(() => {
  delete tauriWindow.__TAURI_INTERNALS__
})

describe('révocation des extensions associées', () => {
  it('efface la clé et vide l’état du pont en mémoire', async () => {
    const forgotten = vi.fn()
    window.addEventListener(BRIDGE_FORGET_EVENT, forgotten)
    try {
      expect(await hasExtensionPairing()).toBe(true)
      expect(await revokeExtensionPairing()).toBe(true)
      expect(native.key).toBeNull()
      expect(await hasExtensionPairing()).toBe(false)
      expect(forgotten).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(BRIDGE_FORGET_EVENT, forgotten)
    }
  })

  it('n’annonce rien si la suppression échoue', async () => {
    const forgotten = vi.fn()
    window.addEventListener(BRIDGE_FORGET_EVENT, forgotten)
    try {
      native.failDelete = true
      expect(await revokeExtensionPairing()).toBe(false)
      expect(native.key).not.toBeNull()
      expect(forgotten).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(BRIDGE_FORGET_EVENT, forgotten)
    }
  })

  it('vérifie que la clé a vraiment disparu avant de confirmer', async () => {
    native.keepAfterDelete = true
    expect(await revokeExtensionPairing()).toBe(false)
  })

  it('ne fait rien hors de l’application desktop', async () => {
    delete tauriWindow.__TAURI_INTERNALS__
    expect(await hasExtensionPairing()).toBe(false)
    expect(await revokeExtensionPairing()).toBe(false)
    expect(native.calls).toEqual([])
  })
})
