import { describe, expect, it } from 'vitest'
import {
  MAX_PENDING_SAVES,
  PENDING_SAVES_STORAGE_KEY,
  PENDING_SAVE_TTL_MS,
  PendingSaveStore,
  RECENT_SELECTIONS_STORAGE_KEY,
  RecentSelectionStore,
  prunePendingSaves,
  type SessionStorageArea,
  type PendingSaveInput,
} from '../../extension/sessionState'

class FakeStorage implements SessionStorageArea {
  readonly values = new Map<string, unknown>()
  writes = 0

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null || keys === undefined) {
      return Object.fromEntries(this.values)
    }
    const wanted = Array.isArray(keys) ? keys : [keys]
    return Object.fromEntries(
      wanted
        .filter((key) => this.values.has(key))
        .map((key) => [key, this.values.get(key)]),
    )
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.writes += 1
    for (const [key, value] of Object.entries(items)) this.values.set(key, value)
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.values.delete(key)
  }
}

function pending(key: string, overrides: Partial<PendingSaveInput> = {}): PendingSaveInput {
  const [tabId, frameId] = key.split(':').map(Number)
  return {
    key,
    tabId,
    frameId,
    host: 'example.com',
    kind: 'login',
    label: 'ada',
    detail: '',
    url: 'https://example.com/login',
    username: 'ada',
    password: 'secret-en-transit',
    ...overrides,
  }
}

describe('propositions d’enregistrement en session', () => {
  it('survit à un nouveau service worker et expire après dix minutes', async () => {
    const session = new FakeStorage()
    let now = 1_000_000
    const first = new PendingSaveStore(session, () => now)
    await first.upsert(pending('1:0'))

    const restarted = new PendingSaveStore(session, () => now + 60_000)
    const restored = await restarted.latestForTab(1)
    expect(restored).toMatchObject({
      key: '1:0',
      username: 'ada',
      password: 'secret-en-transit',
    })

    now += PENDING_SAVE_TTL_MS + 1
    expect(await restarted.list()).toEqual([])
    expect(session.values.has(PENDING_SAVES_STORAGE_KEY)).toBe(false)
  })

  it('refuse une proposition falsifiée ou expirée', () => {
    const now = 5_000
    expect(
      prunePendingSaves(
        [
          {
            ...pending('1:0'),
            id: 'offre-1',
            createdAt: now - 1,
            expiresAt: now + 1,
          },
          {
            ...pending('2:0'),
            id: 'offre-2',
            createdAt: now - 1,
            expiresAt: now - 1,
          },
          { id: 'invalide' },
        ],
        now,
      ).map((entry) => entry.key),
    ).toEqual(['1:0'])
  })

  it('conserve au plus dix propositions, les plus anciennes disparaissent', async () => {
    const session = new FakeStorage()
    let now = 1_000
    const store = new PendingSaveStore(session, () => now)
    for (let index = 0; index < MAX_PENDING_SAVES + 3; index += 1) {
      now += 1
      await store.upsert(pending(`${index}:0`))
    }
    const keys = (await store.list()).map((entry) => entry.key)
    expect(keys).toHaveLength(MAX_PENDING_SAVES)
    expect(keys).not.toContain('0:0')
    expect(keys).not.toContain('2:0')
    expect(keys).toContain('12:0')
  })

  it('supprime les propositions et la sélection d’un onglet fermé', async () => {
    const session = new FakeStorage()
    const store = new PendingSaveStore(session, () => 1_000)
    const recent = new RecentSelectionStore(session, () => 1_000)
    await store.upsert(pending('7:0'))
    await store.upsert(pending('8:0'))
    await recent.set(7, 'item-1', 'example.com')

    await store.removeTab(7)
    await recent.removeTab(7)

    expect((await store.list()).map((entry) => entry.key)).toEqual(['8:0'])
    expect(await recent.get(7)).toBeNull()
  })

  it('mémorise la dernière connexion choisie pendant deux minutes', async () => {
    const session = new FakeStorage()
    let now = 10_000
    const store = new RecentSelectionStore(session, () => now)
    await store.set(3, 'item-42', 'example.com')
    expect(await store.get(3)).toMatchObject({
      tabId: 3,
      itemId: 'item-42',
      host: 'example.com',
    })
    now += 120_001
    expect(await store.get(3)).toBeNull()
  })

  it('n’écrit jamais dans un stockage local', async () => {
    const local = new FakeStorage()
    const session = new FakeStorage()
    const store = new PendingSaveStore(session, () => 1_000)
    await store.upsert(pending('1:0'))

    expect(local.writes).toBe(0)
    expect([...local.values.keys()]).toEqual([])
    expect([...session.values.keys()]).toEqual([PENDING_SAVES_STORAGE_KEY])
    expect([...session.values.keys()]).not.toContain(RECENT_SELECTIONS_STORAGE_KEY)
  })
})
