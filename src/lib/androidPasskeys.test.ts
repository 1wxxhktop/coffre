import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PasskeyItem, VaultItem } from './types'

const platform = vi.hoisted(() => ({ android: true }))
const invoke = vi.hoisted(() => vi.fn())

vi.mock('./platform', () => ({ isAndroidRuntime: () => platform.android }))
vi.mock('./invoke', () => ({ invoke }))

import {
  MAX_ANDROID_PASSKEYS,
  androidPasskeysSupported,
  clearAndroidPasskeys,
  openAndroidPasskeysSettings,
  passkeyTtlSeconds,
  publishAndroidPasskeys,
  toAndroidPasskeyEntries,
  touchAndroidPasskeys,
} from './androidPasskeys'

function passkey(overrides: Partial<PasskeyItem> = {}): PasskeyItem {
  return {
    id: 'passkey-1',
    vaultId: 'vault-1',
    type: 'passkey',
    title: 'Passkey GitHub',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rpId: 'github.com',
    userHandle: 'dXNlcg',
    userName: 'alice',
    credentialId: 'credential-1',
    privateKey: 'private-key',
    publicKeyCose: 'cose',
    signCount: 0,
    ...overrides,
  }
}

beforeEach(() => {
  platform.android = true
  invoke.mockReset()
  invoke.mockResolvedValue(true)
})

describe('passkeys Android', () => {
  it('ne retient que les passkeys complètes, les plus récentes d’abord', () => {
    const entries = toAndroidPasskeyEntries([
      passkey({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
      passkey({
        id: 'recent',
        updatedAt: '2026-02-01T00:00:00.000Z',
        rpId: ' GitHub.com ',
      }),
      passkey({ id: 'deleted', deletedAt: '2026-02-01T00:00:00.000Z' }),
      passkey({ id: 'no-key', privateKey: '' }),
      passkey({ id: 'no-credential', credentialId: '' }),
      passkey({ id: 'no-rp', rpId: '  ' }),
      { ...passkey({ id: 'login' }), type: 'login' } as unknown as VaultItem,
    ])

    expect(entries.map((entry) => entry.id)).toEqual(['recent', 'old'])
    expect(entries[0].rpId).toBe('github.com')
    expect(entries[0]).not.toHaveProperty('publicKeyCose')
  })

  it('plafonne le nombre de passkeys publiées', () => {
    const items = Array.from({ length: MAX_ANDROID_PASSKEYS + 5 }, (_, index) =>
      passkey({ id: `passkey-${index}` }),
    )
    expect(toAndroidPasskeyEntries(items)).toHaveLength(MAX_ANDROID_PASSKEYS)
  })

  it('borne la durée de validité', () => {
    expect(passkeyTtlSeconds(0)).toBe(0)
    expect(passkeyTtlSeconds(5)).toBe(300)
    expect(passkeyTtlSeconds(10_000)).toBe(86_400)
  })

  it('publie, prolonge et vide le cache', async () => {
    await publishAndroidPasskeys([], 300)
    await expect(touchAndroidPasskeys(60)).resolves.toBe(true)
    await clearAndroidPasskeys()
    expect(invoke).toHaveBeenNthCalledWith(1, 'android_passkeys_publish', {
      entries: [],
      ttlSeconds: 300,
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'android_passkeys_touch', {
      ttlSeconds: 60,
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'android_passkeys_clear')
  })

  it('ouvre les réglages Android', async () => {
    await expect(openAndroidPasskeysSettings()).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith('android_passkeys_open_settings')
  })

  it('ne fait rien hors Android', async () => {
    platform.android = false
    expect(androidPasskeysSupported()).toBe(false)
    await publishAndroidPasskeys([], 60)
    await expect(touchAndroidPasskeys(60)).resolves.toBe(false)
    await clearAndroidPasskeys()
    await expect(openAndroidPasskeysSettings()).resolves.toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })
})
