// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const android = vi.hoisted(() => ({
  authenticate: vi.fn(async () => undefined),
  checkStatus: vi.fn(async () => ({
    isAvailable: true,
    biometryType: 1,
  })),
  biometricCipher: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-biometric', () => ({
  authenticate: android.authenticate,
  checkStatus: android.checkStatus,
  biometricCipher: android.biometricCipher,
}))

import {
  biometricAvailable,
  biometricSupported,
  confirmBiometric,
  deleteBiometricKey,
  loadBiometricKey,
  storeBiometricKey,
} from './biometrics'

const KEY = 'coffre:biometric-cipher:v1:file-1'

beforeEach(() => {
  vi.stubGlobal('navigator', {
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
  })
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {},
    configurable: true,
  })
  localStorage.clear()
  android.authenticate.mockClear()
  android.checkStatus.mockClear()
  android.biometricCipher.mockReset()
})

afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  vi.unstubAllGlobals()
})

describe('biométrie Android', () => {
  it('détecte Android et interroge le statut natif', async () => {
    expect(biometricSupported()).toBe(true)
    await expect(biometricAvailable()).resolves.toBe(true)
    expect(android.checkStatus).toHaveBeenCalled()
  })

  it('chiffre la clé avec le cipher biométrique et la relit après authentification', async () => {
    android.biometricCipher
      .mockResolvedValueOnce({ data: 'chiffré' })
      .mockResolvedValueOnce({ data: 'secret-maître' })

    await expect(storeBiometricKey('file-1', 'secret-maître')).resolves.toBe(true)
    expect(android.biometricCipher.mock.calls[0][1]).toMatchObject({
      dataToEncrypt: 'secret-maître',
    })
    expect(localStorage.getItem(KEY)).toBe('chiffré')

    await expect(loadBiometricKey('file-1')).resolves.toEqual({
      authenticated: true,
      secret: 'secret-maître',
    })
    expect(android.biometricCipher.mock.calls[1][1]).toMatchObject({
      dataToDecrypt: 'chiffré',
    })
  })

  it('signale une clé biométrique absente', async () => {
    await expect(loadBiometricKey('file-1')).rejects.toThrow(
      /Aucune clé biométrique/,
    )
  })

  it('traite une annulation du prompt comme un non-déverrouillage', async () => {
    localStorage.setItem(KEY, 'chiffré')
    android.biometricCipher.mockRejectedValueOnce({
      code: 'userCancel',
      message: 'Authentication cancelled',
    })
    await expect(loadBiometricKey('file-1')).resolves.toEqual({
      authenticated: false,
      secret: null,
    })
  })

  it('supprime le chiffré local', async () => {
    localStorage.setItem(KEY, 'chiffré')
    await deleteBiometricKey('file-1')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('utilise le prompt natif pour une confirmation sensible', async () => {
    await expect(confirmBiometric('Afficher le CVC')).resolves.toBe(true)
    expect(android.authenticate).toHaveBeenCalledWith(
      'Afficher le CVC',
      expect.objectContaining({ title: 'Afficher le CVC' }),
    )
  })
})
