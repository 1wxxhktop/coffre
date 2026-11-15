/**
 * Client du pont natif côté extension.
 *
 * La connexion native est ouverte à la demande et refermée par le navigateur
 * si l’application quitte. Les messages d’appairage sont en clair ; une fois la
 * clé de session stockée, toutes les requêtes sont chiffrées par
 * `bridgeProtocol`.
 */

import {
  BRIDGE_HOST_NAME,
  BRIDGE_SESSION_STORAGE_KEY,
  bridgePublicKeyFingerprint,
  bridgeRandomId,
  createBridgeKeyPair,
  decodeBase64,
  decryptBridgePayload,
  deriveBridgeSessionKey,
  encryptBridgePayload,
  type BridgeEncryptedEnvelope,
} from '../src/lib/bridgeProtocol'
import type {
  ExtensionPasskeyCreateInput,
  ExtensionPasskeyCreateResult,
  ExtensionPasskeyGetInput,
  ExtensionPasskeyGetResult,
} from '../src/lib/extensionProtocol'

import { considerSelfUpdate } from './selfUpdate'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

export interface NativeStatus {
  mode: 'native'
  appOpen: true
  unlocked: boolean
  paired: boolean
  /** Coffre desktop possède une clé d’appairage. */
  desktopPaired: boolean
  /** L’extension possède sa copie de la clé. */
  extensionKey: boolean
}

interface NativeHello {
  session: string
  paired: boolean
  unlocked: boolean
}

interface PendingRequest {
  resolve: (message: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: number
  pairing: boolean
}

let port: chrome.runtime.Port | null = null
let hello: NativeHello | null = null
let connecting: Promise<NativeHello> | null = null
let sessionKey: string | null = null
let extCounter = 0
let lastAppCounter = 0
const pending = new Map<string, PendingRequest>()
let pairingAttempt:
  | {
      id: string
      privateKey: CryptoKey
      publicKey: string
      appPublicKey: string | null
      code: string | null
    }
  | null = null
/**
 * Une seule demande d’appairage à la fois. Un utilisateur qui clique plusieurs
 * fois sur « Associer » ne doit pas créer plusieurs tentatives concurrentes :
 * leurs délais expirés finissaient par couper la connexion de la tentative
 * réellement en cours.
 */
let pairingPromise: Promise<{ ok?: true; error?: string }> | null = null

function nativeError(error: string): Error {
  return new Error(error)
}

function nextId(): string {
  return bridgeRandomId()
}

function clearPending(error: Error): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer)
    entry.reject(error)
  }
  pending.clear()
  pairingAttempt = null
}

function resetConnection(): void {
  const previous = port
  port = null
  hello = null
  connecting = null
  clearPending(nativeError('native-disconnected'))
  try {
    previous?.disconnect()
  } catch {
    // Le port peut déjà être fermé par le navigateur.
  }
}

function waitFor(
  id: string,
  timeout: number,
  pairing = false,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(nativeError('native-timeout'))
    }, timeout)
    pending.set(id, { resolve, reject, timer, pairing })
  })
}

async function handleMessage(message: Record<string, unknown>): Promise<void> {
  if (typeof message.id !== 'string') return
  const entry = pending.get(message.id)
  if (!entry) return

  if (message.type === 'pair-pending' && entry.pairing && pairingAttempt) {
    if (typeof message.publicKey === 'string') {
      pairingAttempt.appPublicKey = message.publicKey
    }
    if (typeof message.code === 'string') {
      pairingAttempt.code = message.code
      const fingerprint = await bridgePublicKeyFingerprint(
        pairingAttempt.publicKey,
      )
      // Le popup peut rester ouvert pendant que l’utilisateur confirme dans
      // l’application desktop.
      void api.runtime
        .sendMessage({ type: 'PAIRING_CODE', code: message.code, fingerprint })
        .catch(() => undefined)
    }
    return
  }

  clearTimeout(entry.timer)
  pending.delete(message.id)
  entry.resolve(message)
}

function attach(instance: chrome.runtime.Port): void {
  instance.onMessage.addListener((message: unknown) => {
    if (message && typeof message === 'object') {
      void handleMessage(message as Record<string, unknown>)
    }
  })
  instance.onDisconnect.addListener(() => {
    resetConnection()
  })
}

async function connect(launch = false): Promise<NativeHello> {
  if (port && hello) return hello
  if (connecting) return connecting

  connecting = new Promise<NativeHello>((resolve, reject) => {
    let instance: chrome.runtime.Port
    try {
      instance = api.runtime.connectNative(BRIDGE_HOST_NAME)
    } catch {
      connecting = null
      reject(nativeError('native-unavailable'))
      return
    }
    port = instance
    attach(instance)

    const id = nextId()
    // Un lancement explicite laisse au système le temps de démarrer
    // l’application ; une lecture d’état tolère un réveil de service worker.
    // 30 s couvre un premier lancement à froid sur macOS.
    const waiting = waitFor(id, launch ? 30_000 : 3_000)
    try {
      instance.postMessage(
        launch
          ? { id, type: 'hello', launch: true }
          : { id, type: 'hello' },
      )
    } catch {
      resetConnection()
      reject(nativeError('native-unavailable'))
      return
    }
    void waiting
      .then((message) => {
        if (message.type !== 'hello' || typeof message.session !== 'string') {
          resetConnection()
          reject(nativeError('native-protocol'))
          return
        }
        hello = {
          session: message.session,
          paired: Boolean(message.paired),
          unlocked: Boolean(message.unlocked),
        }
        extCounter = 0
        lastAppCounter = 0
        connecting = null
        resolve(hello)
      })
      .catch((error: unknown) => {
        resetConnection()
        reject(error instanceof Error ? error : nativeError('native-unavailable'))
      })
  })
  return connecting
}

/**
 * Zones de stockage de la clé d’appairage. `storage.local` est la source
 * durable ; `storage.session` sert de secours pour les navigateurs qui
 * perdent `storage.local` au redémarrage du service worker (Orion notamment).
 * Les deux sont effacées au redémarrage du navigateur, ce qui impose au pire
 * une reconnexion par session.
 */
type KeyBackend = 'local' | 'session' | 'indexeddb'

function storageAreas(): Array<{
  name: Exclude<KeyBackend, 'indexeddb'>
  area: chrome.storage.StorageArea
}> {
  const storage = api.storage as typeof chrome.storage & {
    session?: chrome.storage.StorageArea
  }
  const areas: Array<{
    name: Exclude<KeyBackend, 'indexeddb'>
    area: chrome.storage.StorageArea
  }> = [{ name: 'local', area: storage.local as chrome.storage.StorageArea }]
  if (storage.session) areas.push({ name: 'session', area: storage.session })
  return areas
}

const KEY_DB_STORE = 'keys'
let keyDatabase: Promise<IDBDatabase | null> | null = null

function keyDatabaseName(): string {
  const id = typeof api.runtime?.id === 'string' ? api.runtime.id : 'default'
  return `coffre-bridge-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: T | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), milliseconds)
    promise.then(
      (value) => finish(value),
      () => finish(null),
    )
  })
}

function openKeyDatabase(): Promise<IDBDatabase | null> {
  if (keyDatabase) return keyDatabase
  keyDatabase = withTimeout(
    new Promise<IDBDatabase | null>((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      try {
        const request = indexedDB.open(keyDatabaseName(), 1)
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(KEY_DB_STORE)) {
            database.createObjectStore(KEY_DB_STORE)
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
        request.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    }),
    1_500,
  )
  return keyDatabase
}

async function readIndexedKey(): Promise<unknown> {
  const database = await openKeyDatabase()
  if (!database) return null
  return withTimeout(
    new Promise<unknown>((resolve) => {
      try {
        const transaction = database.transaction(KEY_DB_STORE, 'readonly')
        const request = transaction
          .objectStore(KEY_DB_STORE)
          .get(BRIDGE_SESSION_STORAGE_KEY)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
        transaction.onerror = () => resolve(null)
        transaction.onabort = () => resolve(null)
      } catch {
        resolve(null)
      }
    }),
    1_500,
  )
}

async function writeIndexedKey(value: string): Promise<boolean> {
  const database = await openKeyDatabase()
  if (!database) return false
  return (
    (await withTimeout(
      new Promise<boolean>((resolve) => {
        try {
          const transaction = database.transaction(KEY_DB_STORE, 'readwrite')
          transaction.objectStore(KEY_DB_STORE).put(
            value,
            BRIDGE_SESSION_STORAGE_KEY,
          )
          transaction.oncomplete = () => resolve(true)
          transaction.onerror = () => resolve(false)
          transaction.onabort = () => resolve(false)
        } catch {
          resolve(false)
        }
      }),
      1_500,
    )) === true
  )
}

async function deleteIndexedKey(): Promise<void> {
  const database = await openKeyDatabase()
  if (!database) return
  await withTimeout(
    new Promise<boolean>((resolve) => {
      try {
        const transaction = database.transaction(KEY_DB_STORE, 'readwrite')
        transaction.objectStore(KEY_DB_STORE).delete(BRIDGE_SESSION_STORAGE_KEY)
        transaction.oncomplete = () => resolve(true)
        transaction.onerror = () => resolve(false)
        transaction.onabort = () => resolve(false)
      } catch {
        resolve(false)
      }
    }),
    1_500,
  )
}

function validStoredKey(value: string): string | null {
  try {
    const bytes = decodeBase64(value)
    const valid = bytes.length === 32
    bytes.fill(0)
    return valid ? value : null
  } catch {
    return null
  }
}

function storedKeyValue(value: unknown): string | null {
  // Orion peut renvoyer la valeur sous forme de chaîne JSON au lieu de
  // l’objet écrit. Accepter les deux formes évite de croire la clé perdue.
  let record: unknown = value
  for (let depth = 0; depth < 3 && typeof record === 'string'; depth += 1) {
    try {
      record = JSON.parse(record)
    } catch {
      return typeof record === 'string' ? validStoredKey(record) : null
    }
  }
  const object = record as { version?: number; key?: string } | undefined
  if (
    !object ||
    object.version !== 1 ||
    typeof object.key !== 'string' ||
    !object.key
  ) {
    return null
  }
  return validStoredKey(object.key)
}

/** Lit la clé réellement persistée, sans utiliser le cache mémoire. */
async function readPersistedKeyDetailed(): Promise<{
  key: string | null
  backend: KeyBackend | null
}> {
  for (const { name, area } of storageAreas()) {
    try {
      const stored = await area.get(BRIDGE_SESSION_STORAGE_KEY)
      const key = storedKeyValue(stored[BRIDGE_SESSION_STORAGE_KEY])
      if (key) return { key, backend: name }
    } catch {
      // Une zone peut être indisponible ; essayer la suivante.
    }
  }
  const indexed = storedKeyValue(await readIndexedKey())
  if (indexed) return { key: indexed, backend: 'indexeddb' }
  return { key: null, backend: null }
}

async function readPersistedKey(): Promise<string | null> {
  return (await readPersistedKeyDetailed()).key
}

async function readStoredKey(): Promise<string | null> {
  if (sessionKey) return sessionKey
  const key = await readPersistedKey()
  if (key) sessionKey = key
  return key
}

/** Diagnostic sans secret : indique quels backends répondent. */
export async function bridgeStorageReport(): Promise<{
  local: boolean
  session: boolean
  indexedDb: boolean
  persistedKey: boolean
}> {
  const report = { local: false, session: false, indexedDb: false, persistedKey: false }
  for (const { name, area } of storageAreas()) {
    try {
      await area.get(BRIDGE_SESSION_STORAGE_KEY)
      report[name] = true
    } catch {
      // Backend indisponible.
    }
  }
  report.indexedDb = (await readIndexedKey()) !== null
  report.persistedKey = Boolean(await readPersistedKey())
  return report
}

async function storeKey(key: string): Promise<void> {
  // Stocker une chaîne JSON : certains navigateurs WebKit (Orion) sérialisent
  // différemment les objets et renvoient une chaîne à la lecture.
  const value = JSON.stringify({
    version: 1,
    key,
    pairedAt: new Date().toISOString(),
  })
  const writes: Array<Promise<boolean>> = storageAreas().map(
    async ({ area }) => {
      await area.set({ [BRIDGE_SESSION_STORAGE_KEY]: value })
      return true
    },
  )
  writes.push(writeIndexedKey(value))
  const results = await Promise.allSettled(writes)
  if (
    !results.some(
      (result) => result.status === 'fulfilled' && result.value === true,
    )
  ) {
    throw new Error('bridge-storage')
  }
  sessionKey = key
}

async function forgetKey(): Promise<void> {
  sessionKey = null
  for (const { area } of storageAreas()) {
    try {
      await area.remove(BRIDGE_SESSION_STORAGE_KEY)
    } catch {
      // Le stockage peut être indisponible ; l’appairage sera redemandé.
    }
  }
  await deleteIndexedKey()
}

async function send(message: Record<string, unknown>): Promise<void> {
  if (!port) throw nativeError('native-unavailable')
  port.postMessage(message)
}

async function plainStatus(): Promise<{ unlocked: boolean; paired: boolean }> {
  const id = nextId()
  const waiting = waitFor(id, 3_000)
  await send({ id, type: 'status' })
  const response = await waiting
  // L’application annonce la version de l’extension présente sur le disque.
  void considerSelfUpdate(response.extensionVersion)
  return {
    unlocked: Boolean(response.unlocked),
    paired: Boolean(response.paired),
  }
}

async function requestFocus(): Promise<void> {
  try {
    const id = nextId()
    const waiting = waitFor(id, 2000)
    await send({ id, type: 'unlock-request' })
    await waiting
  } catch {
    // L’application peut être en cours de fermeture.
  }
}

async function encryptedRequest(
  payload: Record<string, unknown>,
  retried = false,
): Promise<Record<string, unknown>> {
  const current = await connect()
  const key = await readStoredKey()
  if (!key) return { error: 'needs-pairing' }

  const status = await plainStatus()
  if (!status.unlocked) {
    await requestFocus()
    return { error: 'locked' }
  }
  if (!status.paired) {
    return { error: 'needs-pairing' }
  }

  extCounter += 1
  const encrypted = await encryptBridgePayload(
    key,
    current.session,
    extCounter,
    'extension-to-app',
    payload,
  )
  const id = nextId()
  const waiting = waitFor(id, 10_000)
  await send({
    id,
    type: 'enc',
    session: current.session,
    counter: extCounter,
    ...encrypted,
  })
  const response = await waiting
  if (response.type === 'protocol-error') {
    const error = typeof response.error === 'string' ? response.error : 'protocol'
    if (error === 'unpaired' || error === 'decrypt') {
      await forgetKey()
      resetConnection()
      return { error: 'needs-pairing' }
    }
    if (!retried && (error === 'no-hello' || error === 'stale-session')) {
      // La WebView a pu être rechargée ou l’application redémarrée sans que le
      // port natif soit fermé : on refait un hello puis une seule tentative.
      resetConnection()
      return encryptedRequest(payload, true)
    }
    return { error }
  }
  if (
    response.type !== 'enc' ||
    typeof response.session !== 'string' ||
    typeof response.counter !== 'number' ||
    typeof response.iv !== 'string' ||
    typeof response.data !== 'string'
  ) {
    return { error: 'protocol' }
  }
  if (response.session !== current.session) return { error: 'stale-session' }
  if (!Number.isSafeInteger(response.counter) || response.counter <= lastAppCounter) {
    return { error: 'replay' }
  }
  const envelope: BridgeEncryptedEnvelope = {
    id,
    type: 'enc',
    session: response.session,
    counter: response.counter,
    iv: response.iv,
    data: response.data,
  }
  try {
    const decoded = await decryptBridgePayload(
      key,
      current.session,
      response.counter,
      'app-to-extension',
      envelope,
    )
    lastAppCounter = response.counter
    return decoded && typeof decoded === 'object'
      ? (decoded as Record<string, unknown>)
      : { error: 'protocol' }
  } catch {
    await forgetKey()
    resetConnection()
    return { error: 'needs-pairing' }
  }
}

/** État du pont natif, ou `null` si l’application desktop ne répond pas. */
export async function nativeStatus(): Promise<NativeStatus | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await connect()
      const status = await plainStatus()
      const key = await readStoredKey()
      return {
        mode: 'native',
        appOpen: true,
        unlocked: status.unlocked,
        paired: status.paired && Boolean(key),
        desktopPaired: status.paired,
        extensionKey: Boolean(key),
      }
    } catch {
      resetConnection()
      // Une première lecture peut échouer au réveil du service worker.
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
    }
  }
  return null
}

export async function nativeSearch(
  query: string,
  kind: 'login' | 'card' | 'identity' | 'custom' = 'login',
  touch = true,
): Promise<{ items?: unknown[]; error?: string }> {
  try {
    const response = await encryptedRequest({ type: 'search', query, kind, touch })
    if (typeof response.error === 'string') return { error: response.error }
    return { items: Array.isArray(response.items) ? response.items : [] }
  } catch (error) {
    resetConnection()
    return { error: error instanceof Error ? error.message : 'native-unavailable' }
  }
}

export async function nativeFill(
  itemId: string,
  host: string,
  kind: 'login' | 'card' | 'identity' | 'custom' = 'login',
  includeSensitive = false,
  allowMismatch = false,
): Promise<{ credentials?: unknown; error?: string }> {
  try {
    const response = await encryptedRequest({
      type: 'fill',
      itemId,
      host,
      kind,
      includeSensitive,
      allowMismatch,
    })
    if (typeof response.error === 'string') return { error: response.error }
    return { credentials: response.credentials ?? null }
  } catch (error) {
    resetConnection()
    return { error: error instanceof Error ? error.message : 'native-unavailable' }
  }
}

export async function nativeAssessHost(input: {
  host?: string
  url?: string
  username?: string
  mode?: 'fill' | 'save'
  itemId?: string
}): Promise<{ assessment?: unknown; error?: string }> {
  try {
    const response = await encryptedRequest({ type: 'assess-host', ...input })
    if (typeof response.error === 'string') return { error: response.error }
    return { assessment: response.assessment ?? null }
  } catch (error) {
    resetConnection()
    return { error: error instanceof Error ? error.message : 'native-unavailable' }
  }
}

export async function nativeRecordPhishingChoice(input: {
  host: string
  signals: string[]
  choice: 'cancel' | 'continue'
}): Promise<{ ok?: boolean; error?: string }> {
  try {
    const response = await encryptedRequest({ type: 'phishing-choice', ...input })
    if (typeof response.error === 'string') return { error: response.error }
    return { ok: response.ok === true }
  } catch (error) {
    resetConnection()
    return { error: error instanceof Error ? error.message : 'native-unavailable' }
  }
}

export async function nativeRecordGeneratedPassword(input: {
  password: string
  host?: string
}): Promise<{ ok?: boolean; error?: string }> {
  try {
    const response = await encryptedRequest({
      type: 'record-generated-password',
      password: input.password,
      host: input.host ?? '',
    })
    if (typeof response.error === 'string') return { error: response.error }
    return { ok: response.ok === true }
  } catch (error) {
    resetConnection()
    return { error: error instanceof Error ? error.message : 'native-unavailable' }
  }
}

export async function nativeSaveCard(input: {
  title?: string
  cardholder: string
  number: string
  expiry: string
  cvc?: string
  pin?: string
  brand?: string
}): Promise<{ ok?: boolean; updated?: boolean; itemId?: string; error?: string }> {
  try {
    const response = await encryptedRequest({ type: 'save-card', ...input })
    if (typeof response.error === 'string') return { error: response.error }
    return {
      ok: response.ok === true,
      updated: response.updated === true,
      itemId: typeof response.itemId === 'string' ? response.itemId : undefined,
    }
  } catch (error) {
    resetConnection()
    return { error: error instanceof Error ? error.message : 'native-unavailable' }
  }
}

export async function nativeSaveIdentity(input: {
  title?: string
  fullName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  address: string
  city: string
  postalCode: string
  country: string
}): Promise<{ ok?: boolean; updated?: boolean; itemId?: string; error?: string }> {
  try {
    const response = await encryptedRequest({ type: 'save-identity', ...input })
    if (typeof response.error === 'string') return { error: response.error }
    return {
      ok: response.ok === true,
      updated: response.updated === true,
      itemId: typeof response.itemId === 'string' ? response.itemId : undefined,
    }
  } catch (error) {
    resetConnection()
    return { error: error instanceof Error ? error.message : 'native-unavailable' }
  }
}

export async function nativeCheckLogin(input: {
  host: string
  username: string
  password: string
}): Promise<{
  state?: 'same' | 'different' | 'missing'
  error?: string
}> {
  try {
    const response = await encryptedRequest({
      type: 'check-login',
      host: input.host,
      username: input.username,
      password: input.password,
    })
    if (typeof response.error === 'string') return { error: response.error }
    const state =
      response.state === 'same' ||
      response.state === 'different' ||
      response.state === 'missing'
        ? response.state
        : 'missing'
    return { state }
  } catch (error) {
    resetConnection()
    return { error: error instanceof Error ? error.message : 'native-unavailable' }
  }
}

export async function nativeSaveLogin(input: {
  host: string
  username: string
  password: string
  title?: string
  overridePhishing?: boolean
}): Promise<{ ok?: boolean; updated?: boolean; itemId?: string; error?: string }> {
  try {
    const response = await encryptedRequest({
      type: 'save-login',
      host: input.host,
      username: input.username,
      password: input.password,
      title: input.title ?? input.host,
      overridePhishing: input.overridePhishing === true,
    })
    if (response.type === 'save-result' && response.ok === true) {
      return {
        ok: true,
        updated: Boolean(response.updated),
        itemId: typeof response.itemId === 'string' ? response.itemId : undefined,
      }
    }
    return {
      error:
        typeof response.error === 'string' ? response.error : 'save-failed',
    }
  } catch (error) {
    resetConnection()
    return { error: error instanceof Error ? error.message : 'native-unavailable' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function readCreateResult(value: unknown): ExtensionPasskeyCreateResult | null {
  if (!isRecord(value)) return null
  const fields = [
    'itemId',
    'credentialId',
    'userHandle',
    'clientDataJSON',
    'authenticatorData',
    'attestationObject',
    'publicKeyCose',
  ] as const
  if (fields.some((field) => typeof value[field] !== 'string')) return null
  if (typeof value.signCount !== 'number') return null
  return {
    itemId: value.itemId as string,
    credentialId: value.credentialId as string,
    userHandle: value.userHandle as string,
    clientDataJSON: value.clientDataJSON as string,
    authenticatorData: value.authenticatorData as string,
    attestationObject: value.attestationObject as string,
    publicKeyCose: value.publicKeyCose as string,
    signCount: value.signCount,
  }
}

function readGetResult(value: unknown): ExtensionPasskeyGetResult | null {
  if (!isRecord(value)) return null
  const fields = [
    'itemId',
    'credentialId',
    'userHandle',
    'clientDataJSON',
    'authenticatorData',
    'signature',
  ] as const
  if (fields.some((field) => typeof value[field] !== 'string')) return null
  if (typeof value.signCount !== 'number') return null
  return {
    itemId: value.itemId as string,
    credentialId: value.credentialId as string,
    userHandle: value.userHandle as string,
    clientDataJSON: value.clientDataJSON as string,
    authenticatorData: value.authenticatorData as string,
    signature: value.signature as string,
    signCount: value.signCount,
  }
}

export async function nativePasskeyCreate(
  input: ExtensionPasskeyCreateInput,
): Promise<{ result?: ExtensionPasskeyCreateResult; error?: string }> {
  try {
    const response = await encryptedRequest({
      type: 'passkey-create',
      rpId: input.rpId,
      origin: input.origin,
      challenge: input.challenge,
      userName: input.userName,
      userHandle: input.userHandle,
      excludeCredentials: input.excludeCredentials ?? [],
    })
    if (response.type !== 'passkey-create-result' || response.ok !== true) {
      return {
        error:
          typeof response.error === 'string'
            ? response.error
            : 'passkey-failed',
      }
    }
    const result = readCreateResult(response.result)
    return result ? { result } : { error: 'passkey-protocol' }
  } catch (error) {
    resetConnection()
    return { error: error instanceof Error ? error.message : 'native-unavailable' }
  }
}

export async function nativePasskeyGet(
  input: ExtensionPasskeyGetInput,
): Promise<{
  result?: ExtensionPasskeyGetResult | null
  error?: string
}> {
  try {
    const response = await encryptedRequest({
      type: 'passkey-get',
      rpId: input.rpId,
      origin: input.origin,
      challenge: input.challenge,
      allowCredentials: input.allowCredentials ?? [],
    })
    if (response.type !== 'passkey-get-result' || response.ok !== true) {
      return {
        error:
          typeof response.error === 'string'
            ? response.error
            : 'passkey-failed',
      }
    }
    if (response.result === null) return { result: null }
    const result = readGetResult(response.result)
    return result ? { result } : { error: 'passkey-protocol' }
  } catch (error) {
    resetConnection()
    return { error: error instanceof Error ? error.message : 'native-unavailable' }
  }
}

/**
 * Demande explicite de déverrouillage.
 *
 * Le message `unlock-request` reste en clair : l’application est verrouillée et
 * ne peut pas encore déchiffrer une trame. Le drapeau `launch` permet à l’hôte
 * natif de démarrer l’application si elle est fermée ; il n’est jamais utilisé
 * pour une simple lecture d’état.
 */
export async function nativeUnlock(): Promise<{
  ok?: true
  pending?: true
  error?: string
}> {
  try {
    // Une lecture d’état a pu laisser une tentative en cours : le clic
    // explicite repart d’une connexion propre.
    resetConnection()
    await connect(true)
    const status = await plainStatus()
    if (!status.paired) return { error: 'needs-pairing' }
    if (status.unlocked) return { ok: true }

    const id = nextId()
    const waiting = waitFor(id, 10_000)
    await send({ id, type: 'unlock-request' })
    await waiting.catch(() => undefined)
    return { ok: true, pending: true }
  } catch (error) {
    resetConnection()
    return {
      error: error instanceof Error ? error.message : 'native-unavailable',
    }
  }
}

export async function nativeFocus(): Promise<void> {
  try {
    await connect()
    await requestFocus()
  } catch {
    resetConnection()
  }
}

/**
 * Ouvre l’application desktop, ou la relance si elle est fermée.
 *
 * `hello` avec `launch: true` est le seul message autorisé à démarrer
 * l’application : le bouton « Ouvrir Coffre » ne doit pas se rabattre sur
 * l’application Web quand le mode desktop est choisi.
 */
export async function nativeOpen(): Promise<boolean> {
  try {
    resetConnection()
    await connect(true)
    await requestFocus()
    return true
  } catch {
    resetConnection()
    return false
  }
}

async function waitForUnlocked(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    try {
      if ((await plainStatus()).unlocked) return true
    } catch {
      // L’application peut être en cours de démarrage ou de redémarrage :
      // une nouvelle connexion avec lancement est tentée au prochain tour.
      try {
        resetConnection()
        await connect(true)
      } catch {
        // Le prochain tour réessaiera dans la limite du délai.
      }
    }
  }
  return false
}

async function performPairing(): Promise<{ ok?: true; error?: string }> {
  // Le service worker MV3 peut être suspendu après ~30 s d’inactivité, ce qui
  // ferme le port natif pendant que l’utilisateur déverrouille l’application ou
  // confirme le code. Un appel d’API périodique le maintient éveillé pendant
  // toute la séquence, y compris le lancement de l’application.
  const keepAlive = setInterval(() => {
    void api.runtime.getPlatformInfo().catch(() => undefined)
  }, 20_000)
  try {
    // Un clic explicite sur « Associer » peut lancer l’application desktop si
    // elle est fermée, comme le bouton « Déverrouiller ».
    resetConnection()
    await connect(true)
    let status = await plainStatus()
    if (!status.unlocked) {
      await requestFocus()
      status = { unlocked: await waitForUnlocked(60_000), paired: status.paired }
    }
    if (!status.unlocked) {
      return { error: 'locked' }
    }

    // Déjà associée des deux côtés : ne pas remplacer une clé qui fonctionne
    // parce que l’utilisateur a recliqué sur « Associer ». Vérifier le stockage
    // réel, pas seulement le cache mémoire : un contexte Orion peut avoir la
    // clé en mémoire alors qu’un autre contexte ne la voit pas.
    if (status.paired && (await readPersistedKey())) {
      return { ok: true }
    }

    const current = await connect()
    const pair = await createBridgeKeyPair()
    const id = nextId()
    pairingAttempt = {
      id,
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      appPublicKey: null,
      code: null,
    }
    const waiting = waitFor(id, 120_000, true)
    await send({ id, type: 'pair-begin', publicKey: pair.publicKey })
    const response = await waiting

    if (response.type === 'locked') return { error: 'locked' }
    if (response.type !== 'pair-accepted') return { error: 'pair-rejected' }
    if (response.session !== current.session || !pairingAttempt?.appPublicKey) {
      return { error: 'pair-protocol' }
    }
    const key = await deriveBridgeSessionKey(
      pair.privateKey,
      pair.publicKey,
      pairingAttempt.appPublicKey,
    )
    await storeKey(key)
    // Vérifier que la clé est réellement relisible depuis un stockage
    // persistant, et pas seulement depuis la mémoire de ce contexte. Sans
    // cela, Orion pouvait répondre « associé » puis perdre la clé au prochain
    // `GET_STATUS`.
    let persisted = false
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if ((await readPersistedKey()) === key) {
        persisted = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    if (!persisted) {
      console.warn(
        '[coffre] clé d’appairage non persistée',
        await bridgeStorageReport(),
      )
      throw new Error('bridge-storage')
    }
    pairingAttempt = null
    extCounter = 0
    lastAppCounter = 0

    // Une vérification transitoire (application verrouillée, timeout) ne doit
    // pas transformer une association réussie en échec : la clé est déjà
    // enregistrée des deux côtés. Seul un rejet explicite du pair est fatal.
    const check = await encryptedRequest({ type: 'status' })
    if (check.error === 'needs-pairing') {
      return { error: 'pair-protocol' }
    }
    return { ok: true }
  } finally {
    clearInterval(keepAlive)
  }
}

async function pairOnce(): Promise<{ ok?: true; error?: string }> {
  try {
    return await performPairing()
  } catch (error) {
    // Le port natif peut se fermer pendant le démarrage de l’application :
    // une seconde tentative après un court délai suffit dans la majorité des
    // cas, sans redemander à l’utilisateur de recliquer.
    if (error instanceof Error && error.message === 'native-disconnected') {
      resetConnection()
      await new Promise((resolve) => setTimeout(resolve, 500))
      return performPairing()
    }
    throw error
  }
}

export function nativePair(): Promise<{ ok?: true; error?: string }> {
  if (!pairingPromise) {
    pairingPromise = pairOnce()
      .catch((error: unknown) => {
        resetConnection()
        return {
          error: error instanceof Error ? error.message : 'native-unavailable',
        }
      })
      .finally(() => {
        pairingPromise = null
      })
  }
  return pairingPromise
}
