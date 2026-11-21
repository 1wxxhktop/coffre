import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoginItem, VaultItem } from './types'

const platform = vi.hoisted(() => ({ android: true }))
const invoke = vi.hoisted(() => vi.fn())

vi.mock('./platform', () => ({ isAndroidRuntime: () => platform.android }))
vi.mock('./invoke', () => ({ invoke }))

import {
  MAX_AUTOFILL_ENTRIES,
  androidAutofillStatus,
  androidAutofillSupported,
  autofillTtlSeconds,
  clearAndroidAutofill,
  openAndroidAutofillSettings,
  publishAndroidAutofill,
  toAutofillEntries,
  touchAndroidAutofill,
} from './androidAutofill'

function login(overrides: Partial<LoginItem> = {}): LoginItem {
  return {
    id: 'login-1',
    vaultId: 'vault-1',
    type: 'login',
    title: 'Exemple',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    username: 'alice',
    password: 'secret',
    urls: ['https://example.com'],
    totp: '',
    ...overrides,
  }
}

beforeEach(() => {
  platform.android = true
  invoke.mockReset()
  invoke.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('remplissage Android', () => {
  it('ne retient que les connexions utilisables, favoris puis récentes', () => {
    const entries = toAutofillEntries([
      login({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
      login({
        id: 'recent',
        updatedAt: '2026-02-01T00:00:00.000Z',
        urls: [' https://recent.example ', ''],
      }),
      login({ id: 'favorite', favorite: true }),
      login({ id: 'deleted', deletedAt: '2026-01-02T00:00:00.000Z' }),
      login({ id: 'no-password', password: '' }),
      login({ id: 'no-url', urls: [] }),
      {
        ...login({ id: 'note' }),
        type: 'note',
      } as VaultItem,
    ])

    expect(entries.map((entry) => entry.id)).toEqual([
      'favorite',
      'recent',
      'old',
    ])
    expect(entries[1].urls).toEqual([' https://recent.example '])
    expect(entries[0]).toMatchObject({
      title: 'Exemple',
      username: 'alice',
      password: 'secret',
    })
    expect(entries[0]).not.toHaveProperty('totp')
  })

  it('plafonne le nombre d’entrées envoyées', () => {
    const items = Array.from({ length: MAX_AUTOFILL_ENTRIES + 5 }, (_, index) =>
      login({ id: `login-${index}` }),
    )
    expect(toAutofillEntries(items)).toHaveLength(MAX_AUTOFILL_ENTRIES)
  })

  it('convertit le délai de verrouillage en secondes bornées', () => {
    expect(autofillTtlSeconds(0)).toBe(0)
    expect(autofillTtlSeconds(-1)).toBe(0)
    expect(autofillTtlSeconds(5)).toBe(300)
    expect(autofillTtlSeconds(10_000)).toBe(86_400)
    expect(autofillTtlSeconds(Number.NaN)).toBe(0)
  })

  it('publie les entrées avec la durée de validité', async () => {
    await publishAndroidAutofill([], 300)
    expect(invoke).toHaveBeenCalledWith('android_autofill_publish', {
      entries: [],
      ttlSeconds: 300,
    })
  })

  it('prolonge et vide le cache', async () => {
    invoke.mockResolvedValue(true)
    await expect(touchAndroidAutofill(60)).resolves.toBe(true)
    await clearAndroidAutofill()
    expect(invoke).toHaveBeenNthCalledWith(1, 'android_autofill_touch', {
      ttlSeconds: 60,
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'android_autofill_clear')
  })

  it('signale un cache expiré ou une commande en échec', async () => {
    invoke.mockResolvedValue(false)
    await expect(touchAndroidAutofill(60)).resolves.toBe(false)
    invoke.mockRejectedValue(new Error('refusé'))
    await expect(touchAndroidAutofill(60)).resolves.toBe(false)
  })

  it('lit l’état du service', async () => {
    invoke.mockResolvedValue({
      supported: true,
      serviceEnabled: true,
      unlocked: true,
    })
    await expect(androidAutofillStatus()).resolves.toEqual({
      supported: true,
      serviceEnabled: true,
      unlocked: true,
    })
    expect(invoke).toHaveBeenCalledWith('android_autofill_status')
  })

  it('retombe sur un état sûr si la commande échoue', async () => {
    invoke.mockRejectedValue(new Error('refusé'))
    await expect(androidAutofillStatus()).resolves.toEqual({
      supported: true,
      serviceEnabled: false,
      unlocked: false,
    })
    await expect(openAndroidAutofillSettings()).resolves.toBe(false)
  })

  it('ne fait rien hors Android', async () => {
    platform.android = false
    expect(androidAutofillSupported()).toBe(false)
    await publishAndroidAutofill([], 60)
    await expect(touchAndroidAutofill(60)).resolves.toBe(false)
    await clearAndroidAutofill()
    await expect(openAndroidAutofillSettings()).resolves.toBe(false)
    await expect(androidAutofillStatus()).resolves.toEqual({
      supported: false,
      serviceEnabled: false,
      unlocked: false,
    })
    expect(invoke).not.toHaveBeenCalled()
  })
})
