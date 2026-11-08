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

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

export interface NativeStatus {
  mode: 'native'
  appOpen: true
  unlocked: boolean
  paired: boolean
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
      // Le popup peut rester ouvert pendant que l’utilisateur confirme dans
      // l’application desktop.
      void api.runtime
        .sendMessage({ type: 'PAIRING_CODE', code: message.code })
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

async function connect(): Promise<NativeHello> {
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
    const waiting = waitFor(id, 1500)
    try {
      instance.postMessage({ id, type: 'hello' })
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

async function readStoredKey(): Promise<string | null> {
  if (sessionKey) return sessionKey
  try {
    const stored = await api.storage.local.get(BRIDGE_SESSION_STORAGE_KEY)
    const value = stored[BRIDGE_SESSION_STORAGE_KEY] as
      | { version?: number; key?: string }
      | undefined
    if (value && value.version === 1 && typeof value.key === 'string' && value.key) {
      const bytes = decodeBase64(value.key)
      if (bytes.length === 32) {
        sessionKey = value.key
      } else {
        sessionKey = null
      }
      bytes.fill(0)
    }
  } catch {
    sessionKey = null
  }
  return sessionKey
}

async function storeKey(key: string): Promise<void> {
  await api.storage.local.set({
    [BRIDGE_SESSION_STORAGE_KEY]: {
      version: 1,
      key,
      pairedAt: new Date().toISOString(),
    },
  })
  sessionKey = key
}

async function forgetKey(): Promise<void> {
  sessionKey = null
  try {
    await api.storage.local.remove(BRIDGE_SESSION_STORAGE_KEY)
  } catch {
    // Le stockage local peut être indisponible ; l’appairage sera redemandé.
  }
}

async function send(message: Record<string, unknown>): Promise<void> {
  if (!port) throw nativeError('native-unavailable')
  port.postMessage(message)
}

async function plainStatus(): Promise<{ unlocked: boolean; paired: boolean }> {
  const id = nextId()
  const waiting = waitFor(id, 2000)
  await send({ id, type: 'status' })
  const response = await waiting
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
  try {
    await connect()
    const status = await plainStatus()
    const key = await readStoredKey()
    return {
      mode: 'native',
      appOpen: true,
      unlocked: status.unlocked,
      paired: status.paired && Boolean(key),
    }
  } catch {
    resetConnection()
    return null
  }
}

export async function nativeSearch(
  query: string,
  kind: 'login' | 'card' | 'identity' | 'custom' = 'login',
): Promise<{ items?: unknown[]; error?: string }> {
  try {
    const response = await encryptedRequest({ type: 'search', query, kind })
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
): Promise<{ credentials?: unknown; error?: string }> {
  try {
    const response = await encryptedRequest({
      type: 'fill',
      itemId,
      host,
      kind,
      includeSensitive,
    })
    if (typeof response.error === 'string') return { error: response.error }
    return { credentials: response.credentials ?? null }
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

export async function nativeSaveLogin(input: {
  host: string
  username: string
  password: string
  title?: string
}): Promise<{ ok?: boolean; updated?: boolean; itemId?: string; error?: string }> {
  try {
    const response = await encryptedRequest({
      type: 'save-login',
      host: input.host,
      username: input.username,
      password: input.password,
      title: input.title ?? input.host,
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

export async function nativeFocus(): Promise<void> {
  try {
    await connect()
    await requestFocus()
  } catch {
    resetConnection()
  }
}

export async function nativePair(): Promise<{ ok?: true; error?: string }> {
  try {
    const current = await connect()
    const status = await plainStatus()
    if (!status.unlocked) {
      return { error: 'locked' }
    }

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
    pairingAttempt = null
    extCounter = 0
    lastAppCounter = 0

    const check = await encryptedRequest({ type: 'status' })
    if (typeof check.error === 'string') {
      return { error: check.error }
    }
    return { ok: true }
  } catch (error) {
    resetConnection()
    return {
      error: error instanceof Error ? error.message : 'native-unavailable',
    }
  }
}
