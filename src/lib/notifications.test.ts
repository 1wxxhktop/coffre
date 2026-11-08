import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dueExpiryNotifications,
  markExpiryNotified,
  notificationsSupported,
  notifyExpiringItems,
} from './notifications'
import type { ExpiryEvent } from './expiry'
import type { LoginItem } from './types'

const STAMP = '2026-11-08T10:00:00.000Z'

function item(id = 'i1', title = 'GitHub'): LoginItem {
  return {
    id,
    vaultId: 'v1',
    type: 'login',
    title,
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '2026-11-20',
    createdAt: STAMP,
    updatedAt: STAMP,
    username: 'ada',
    password: 'secret',
    urls: [],
    totp: '',
  }
}

function event(id = 'i1', daysLeft = 12, date = '2026-11-20'): ExpiryEvent {
  return {
    item: item(id),
    date,
    label: 'Mot de passe à changer',
    kind: 'item',
    daysLeft,
  }
}

class MemoryStorage {
  #values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  clear(): void {
    this.#values.clear()
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null
  }

  get length(): number {
    return this.#values.size
  }
}

class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static instances: FakeNotification[] = []

  title: string
  options?: NotificationOptions

  constructor(title: string, options?: NotificationOptions) {
    this.title = title
    this.options = options
    FakeNotification.instances.push(this)
  }

  static requestPermission(): Promise<NotificationPermission> {
    return Promise.resolve(FakeNotification.permission)
  }
}

const storage = new MemoryStorage()

beforeEach(() => {
  storage.clear()
  FakeNotification.instances = []
  FakeNotification.permission = 'granted'
  vi.stubGlobal('window', { localStorage: storage, Notification: FakeNotification })
  vi.stubGlobal('Notification', FakeNotification)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('notifications d’échéance', () => {
  it('ne signale chaque échéance qu’une fois par jour', () => {
    const events = [event()]
    expect(dueExpiryNotifications(events, new Date(2026, 10, 8))).toHaveLength(1)

    markExpiryNotified(events, new Date(2026, 10, 8))
    expect(dueExpiryNotifications(events, new Date(2026, 10, 8))).toHaveLength(0)
    expect(dueExpiryNotifications(events, new Date(2026, 10, 9))).toHaveLength(1)
  })

  it('affiche une notification regroupée et la marque comme envoyée', () => {
    const events = [event('i1', 12), event('i2', 3, '2026-11-11')]
    const due = notifyExpiringItems(events, new Date(2026, 10, 8))

    expect(due).toHaveLength(2)
    expect(FakeNotification.instances).toHaveLength(1)
    expect(FakeNotification.instances[0].title).toContain('2 échéances')
    expect(FakeNotification.instances[0].options?.body).toContain('GitHub')
    expect(dueExpiryNotifications(events, new Date(2026, 10, 8))).toHaveLength(0)
  })

  it('ne fait rien sans autorisation système', () => {
    FakeNotification.permission = 'denied'
    const events = [event()]
    expect(notifyExpiringItems(events, new Date(2026, 10, 8))).toHaveLength(0)
    expect(FakeNotification.instances).toHaveLength(0)
    expect(dueExpiryNotifications(events, new Date(2026, 10, 8))).toHaveLength(1)
  })

  it('signale si l’API Notification est absente', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('window', { localStorage: storage })
    expect(notificationsSupported()).toBe(false)
    expect(notifyExpiringItems([event()], new Date(2026, 10, 8))).toHaveLength(0)
  })
})
