import { beforeEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({ android: true }))
const invoke = vi.hoisted(() => vi.fn())

vi.mock('./platform', () => ({ isAndroidRuntime: () => platform.android }))
vi.mock('./invoke', () => ({ invoke }))

import {
  androidSecureScreenEnabled,
  androidSecureScreenSupported,
  setAndroidSecureScreen,
} from './androidSecureScreen'

beforeEach(() => {
  platform.android = true
  invoke.mockReset()
  invoke.mockResolvedValue(true)
})

describe('captures d’écran Android', () => {
  it('applique le choix et relit l’état natif', async () => {
    await expect(setAndroidSecureScreen(false)).resolves.toBe(true)
    await expect(androidSecureScreenEnabled()).resolves.toBe(true)
    expect(invoke).toHaveBeenNthCalledWith(1, 'android_secure_screen_set', {
      enabled: false,
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'android_secure_screen_enabled')
  })

  it('reste sûr si la commande échoue', async () => {
    invoke.mockRejectedValue(new Error('refusé'))
    await expect(setAndroidSecureScreen(true)).resolves.toBe(false)
    await expect(androidSecureScreenEnabled()).resolves.toBe(false)
  })

  it('ne fait rien hors Android', async () => {
    platform.android = false
    expect(androidSecureScreenSupported()).toBe(false)
    await expect(setAndroidSecureScreen(true)).resolves.toBe(false)
    await expect(androidSecureScreenEnabled()).resolves.toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })
})
