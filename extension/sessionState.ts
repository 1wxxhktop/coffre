/**
 * État de session du service worker MV3.
 *
 * Chrome arrête le service worker après quelques secondes d’inactivité. Tout
 * état utile au-delà de cet arrêt vit donc dans `storage.session` (mémoire du
 * navigateur, effacée à sa fermeture), jamais dans `storage.local` :
 * - les propositions d’enregistrement (avec le secret en transit) ;
 * - la dernière connexion choisie pour un onglet (identifiant seul).
 *
 * Les demandes de passkey en cours, elles, ne peuvent pas survivre : elles
 * contiennent un résolveur de promesse lié à la page et expirent avec le
 * worker. Le navigateur reprend alors la main.
 */

import type {
  ExtensionAutofillKind,
  ExtensionCardSaveInput,
  ExtensionIdentitySaveInput,
} from '../src/lib/extensionProtocol'

export const PENDING_SAVES_STORAGE_KEY = 'coffre.pendingSaves.v1'
export const RECENT_SELECTIONS_STORAGE_KEY = 'coffre.recentSelections.v1'
export const PENDING_SAVE_TTL_MS = 10 * 60_000
export const MAX_PENDING_SAVES = 10
export const RECENT_SELECTION_TTL_MS = 2 * 60_000
export const MAX_RECENT_SELECTIONS = 20

/** Sous-ensemble de `chrome.storage.StorageArea` utilisé par les tests. */
export interface SessionStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string | string[]): Promise<void>
}

export interface StoredPendingSave {
  id: string
  key: string
  tabId: number
  frameId: number
  host: string
  kind: ExtensionAutofillKind
  label: string
  detail: string
  url: string
  username: string
  password: string
  update?: boolean
  card?: ExtensionCardSaveInput
  identity?: ExtensionIdentitySaveInput
  createdAt: number
  expiresAt: number
}

export type PendingSaveInput = Omit<
  StoredPendingSave,
  'id' | 'createdAt' | 'expiresAt'
> & {
  id?: string
}

export interface StoredRecentSelection {
  tabId: number
  itemId: string
  host: string
  expiresAt: number
}

type Now = () => number

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function finiteInteger(value: unknown, minimum = 0): number | null {
  return Number.isInteger(value) && (value as number) >= minimum
    ? (value as number)
    : null
}

function validKind(value: unknown): value is ExtensionAutofillKind {
  return (
    value === 'login' ||
    value === 'card' ||
    value === 'identity' ||
    value === 'custom'
  )
}

function readPendingSave(value: unknown): StoredPendingSave | null {
  if (!isRecord(value)) return null
  const tabId = finiteInteger(value.tabId)
  const frameId = finiteInteger(value.frameId)
  const createdAt = finiteInteger(value.createdAt)
  const expiresAt = finiteInteger(value.expiresAt)
  if (
    tabId === null ||
    frameId === null ||
    createdAt === null ||
    expiresAt === null ||
    typeof value.id !== 'string' ||
    typeof value.key !== 'string' ||
    typeof value.host !== 'string' ||
    !validKind(value.kind)
  ) {
    return null
  }
  return {
    id: value.id.slice(0, 64),
    key: value.key.slice(0, 80),
    tabId,
    frameId,
    host: text(value.host, 253),
    kind: value.kind,
    label: text(value.label, 500),
    detail: text(value.detail, 500),
    url: text(value.url, 2048),
    username: text(value.username, 500),
    password: text(value.password, 2048),
    update: value.update === true ? true : undefined,
    card: isRecord(value.card)
      ? (value.card as unknown as ExtensionCardSaveInput)
      : undefined,
    identity: isRecord(value.identity)
      ? (value.identity as unknown as ExtensionIdentitySaveInput)
      : undefined,
    createdAt,
    expiresAt,
  }
}

function readRecentSelection(value: unknown): StoredRecentSelection | null {
  if (!isRecord(value)) return null
  const tabId = finiteInteger(value.tabId)
  const expiresAt = finiteInteger(value.expiresAt)
  if (
    tabId === null ||
    expiresAt === null ||
    typeof value.itemId !== 'string' ||
    typeof value.host !== 'string'
  ) {
    return null
  }
  return {
    tabId,
    itemId: value.itemId.slice(0, 128),
    host: text(value.host, 253),
    expiresAt,
  }
}

/** Purge les propositions expirées et ne conserve que les dix plus récentes. */
export function prunePendingSaves(
  value: unknown,
  now: number,
): StoredPendingSave[] {
  if (!Array.isArray(value)) return []
  return value
    .map(readPendingSave)
    .filter((entry): entry is StoredPendingSave => entry !== null)
    .filter((entry) => entry.expiresAt > now)
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-MAX_PENDING_SAVES)
}

export function pruneRecentSelections(
  value: unknown,
  now: number,
): StoredRecentSelection[] {
  if (!Array.isArray(value)) return []
  return value
    .map(readRecentSelection)
    .filter((entry): entry is StoredRecentSelection => entry !== null)
    .filter((entry) => entry.expiresAt > now)
    .sort((left, right) => left.expiresAt - right.expiresAt)
    .slice(-MAX_RECENT_SELECTIONS)
}

async function readJson<T>(
  storage: SessionStorageArea,
  key: string,
  fallback: T,
): Promise<unknown> {
  const stored = await storage.get(key)
  return Object.hasOwn(stored, key) ? stored[key] : fallback
}

abstract class QueuedSessionStore {
  private queue: Promise<void> = Promise.resolve()
  protected readonly storage: SessionStorageArea
  protected readonly now: Now
  private readonly ready: Promise<unknown>

  constructor(
    storage: SessionStorageArea,
    now: Now,
    ready: Promise<unknown>,
  ) {
    this.storage = storage
    this.now = now
    this.ready = ready
  }

  protected run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(
      async () => {
        await this.ready
        return operation()
      },
      async () => {
        await this.ready
        return operation()
      },
    )
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export class PendingSaveStore extends QueuedSessionStore {
  constructor(
    storage: SessionStorageArea,
    now: Now = Date.now,
    ready: Promise<unknown> = Promise.resolve(),
  ) {
    super(storage, now, ready)
  }

  private async read(): Promise<StoredPendingSave[]> {
    const raw = await readJson(this.storage, PENDING_SAVES_STORAGE_KEY, [])
    const pending = prunePendingSaves(raw, this.now())
    if (!Array.isArray(raw) || JSON.stringify(raw) !== JSON.stringify(pending)) {
      await this.write(pending)
    }
    return pending
  }

  private async write(pending: StoredPendingSave[]): Promise<void> {
    const pruned = prunePendingSaves(pending, this.now())
    if (pruned.length === 0) {
      await this.storage.remove(PENDING_SAVES_STORAGE_KEY)
      return
    }
    await this.storage.set({ [PENDING_SAVES_STORAGE_KEY]: pruned })
  }

  list(): Promise<StoredPendingSave[]> {
    return this.run(() => this.read())
  }

  async find(id: string): Promise<StoredPendingSave | null> {
    return this.run(async () => {
      const pending = await this.read()
      return pending.find((entry) => entry.id === id) ?? null
    })
  }

  async get(key: string): Promise<StoredPendingSave | null> {
    return this.run(async () => {
      const pending = await this.read()
      return pending.find((entry) => entry.key === key) ?? null
    })
  }

  async latestForTab(tabId: number): Promise<StoredPendingSave | null> {
    return this.run(async () => {
      const pending = await this.read()
      return (
        pending
          .filter((entry) => entry.tabId === tabId)
          .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
      )
    })
  }

  async upsert(input: PendingSaveInput): Promise<StoredPendingSave> {
    return this.run(async () => {
      const now = this.now()
      const save: StoredPendingSave = {
        ...input,
        id: input.id || crypto.randomUUID(),
        createdAt: now,
        expiresAt: now + PENDING_SAVE_TTL_MS,
      }
      const pending = (await this.read()).filter(
        (entry) => entry.key !== save.key,
      )
      await this.write([...pending, save])
      return save
    })
  }

  async remove(key: string): Promise<void> {
    return this.run(async () => {
      const pending = (await this.read()).filter((entry) => entry.key !== key)
      await this.write(pending)
    })
  }

  async removeTab(tabId: number): Promise<void> {
    return this.run(async () => {
      const pending = (await this.read()).filter(
        (entry) => entry.tabId !== tabId,
      )
      await this.write(pending)
    })
  }

  async removeWhere(
    predicate: (entry: StoredPendingSave) => boolean,
  ): Promise<void> {
    return this.run(async () => {
      const pending = (await this.read()).filter((entry) => !predicate(entry))
      await this.write(pending)
    })
  }

  async clear(): Promise<void> {
    return this.run(async () => {
      await this.storage.remove(PENDING_SAVES_STORAGE_KEY)
    })
  }
}

export class RecentSelectionStore extends QueuedSessionStore {
  constructor(
    storage: SessionStorageArea,
    now: Now = Date.now,
    ready: Promise<unknown> = Promise.resolve(),
  ) {
    super(storage, now, ready)
  }

  private async read(): Promise<StoredRecentSelection[]> {
    const raw = await readJson(this.storage, RECENT_SELECTIONS_STORAGE_KEY, [])
    const selections = pruneRecentSelections(raw, this.now())
    if (
      !Array.isArray(raw) ||
      JSON.stringify(raw) !== JSON.stringify(selections)
    ) {
      await this.write(selections)
    }
    return selections
  }

  private async write(selections: StoredRecentSelection[]): Promise<void> {
    const pruned = pruneRecentSelections(selections, this.now())
    if (pruned.length === 0) {
      await this.storage.remove(RECENT_SELECTIONS_STORAGE_KEY)
      return
    }
    await this.storage.set({ [RECENT_SELECTIONS_STORAGE_KEY]: pruned })
  }

  async get(tabId: number): Promise<StoredRecentSelection | null> {
    return this.run(async () => {
      const selections = await this.read()
      return selections.find((entry) => entry.tabId === tabId) ?? null
    })
  }

  async set(tabId: number, itemId: string, host: string): Promise<void> {
    return this.run(async () => {
      const now = this.now()
      const selections = (await this.read()).filter(
        (entry) => entry.tabId !== tabId,
      )
      await this.write([
        ...selections,
        {
          tabId,
          itemId: itemId.slice(0, 128),
          host: host.slice(0, 253),
          expiresAt: now + RECENT_SELECTION_TTL_MS,
        },
      ])
    })
  }

  async removeTab(tabId: number): Promise<void> {
    return this.run(async () => {
      const selections = (await this.read()).filter(
        (entry) => entry.tabId !== tabId,
      )
      await this.write(selections)
    })
  }

  async clear(): Promise<void> {
    return this.run(async () => {
      await this.storage.remove(RECENT_SELECTIONS_STORAGE_KEY)
    })
  }
}
