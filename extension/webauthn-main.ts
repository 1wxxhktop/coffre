/**
 * Interception WebAuthn dans le monde de la page.
 *
 * Ce script ne reçoit jamais de clé privée : il transmet les options publiques
 * au content script, qui les fait valider et signer par l’application Coffre.
 * Il ne reconstruit que les objets de réponse attendus par la page.
 */

type PasskeyKind = 'create' | 'get'

interface RelayPayload {
  rpId: string
  challenge: string
  userName?: string
  userHandle?: string
  allowCredentials?: string[]
  excludeCredentials?: string[]
}

interface RelayResult {
  fallback?: boolean
  error?: string
  result?: Record<string, unknown>
}

interface Waiter {
  resolve: (result: RelayResult) => void
  reject: (error: unknown) => void
}

const INSTALLED_FLAG = '__coffreWebauthnMain'
const BASE64URL = /^[A-Za-z0-9_-]+$/
const waiters = new Map<string, Waiter>()

function bytesOf(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  throw new TypeError('Données binaires WebAuthn invalides')
}

function toBase64Url(value: unknown): string {
  const bytes = bytesOf(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: unknown): ArrayBuffer {
  if (typeof value !== 'string' || !BASE64URL.test(value)) {
    throw new TypeError('Base64url WebAuthn invalide')
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function randomId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function secureOrigin(): boolean {
  return (
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  )
}

function relayReady(): boolean {
  return document.documentElement.hasAttribute('data-coffre-webauthn-ready')
}

function fail(name: 'NotAllowedError' | 'SecurityError', message: string): DOMException {
  return new DOMException(message, name)
}

function relayError(code: string | undefined): DOMException {
  if (code === 'invalid-rp') {
    return fail(
      'SecurityError',
      'Le domaine WebAuthn n’est pas autorisé pour cette origine.',
    )
  }
  if (code === 'timeout') return fail('NotAllowedError', 'La demande a expiré.')
  return fail('NotAllowedError', 'La passkey Coffre n’est pas disponible.')
}

function relay(
  kind: PasskeyKind,
  payload: RelayPayload,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RelayResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(fail('NotAllowedError', 'Opération annulée.'))
      return
    }
    const requestId = randomId()
    let settled = false
    let timer: number | undefined

    const cleanup = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      waiters.delete(requestId)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onAbort = () => {
      window.postMessage(
        { source: 'coffre-webauthn', type: 'cancel', requestId },
        location.origin,
      )
      finish(() => reject(fail('NotAllowedError', 'Opération annulée.')))
    }

    timer = window.setTimeout(() => {
      window.postMessage(
        { source: 'coffre-webauthn', type: 'cancel', requestId },
        location.origin,
      )
      finish(() => resolve({ fallback: true }))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    waiters.set(requestId, {
      resolve: (result) => finish(() => resolve(result)),
      reject: (error) => finish(() => reject(error)),
    })
    window.postMessage(
      {
        source: 'coffre-webauthn',
        type: 'request',
        kind,
        requestId,
        payload,
      },
      location.origin,
    )
  })
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return
  const data = event.data as {
    source?: string
    type?: string
    requestId?: string
    fallback?: boolean
    error?: string
    result?: unknown
  }
  if (!data || data.source !== 'coffre-webauthn' || data.type !== 'response') {
    return
  }
  const waiter = waiters.get(data.requestId ?? '')
  if (!waiter) return
  if (data.fallback) {
    waiter.resolve({ fallback: true })
    return
  }
  if (data.result === null) {
    waiter.resolve({ fallback: true })
    return
  }
  if (typeof data.error === 'string') {
    waiter.reject(relayError(data.error))
    return
  }
  if (data.result && typeof data.result === 'object') {
    waiter.resolve({ result: data.result as Record<string, unknown> })
    return
  }
  waiter.reject(fail('NotAllowedError', 'Réponse WebAuthn invalide.'))
})

function requestTimeout(timeout: number | undefined): number {
  const value = Number(timeout)
  if (!Number.isFinite(value) || value <= 0) return 120_000
  return Math.min(120_000, Math.max(5_000, value))
}

function unsupportedExtensions(value: unknown, allowCredProps: boolean): boolean {
  if (!value || typeof value !== 'object') return false
  return Object.keys(value).some(
    (key) => !allowCredProps || key !== 'credProps',
  )
}

function canInterceptCreate(options: PublicKeyCredentialCreationOptions): boolean {
  if (!secureOrigin()) return false
  if (
    !options.pubKeyCredParams.some(
      (parameter) => parameter.type === 'public-key' && parameter.alg === -7,
    )
  ) {
    return false
  }
  if (
    options.authenticatorSelection?.authenticatorAttachment === 'cross-platform'
  ) {
    return false
  }
  // Coffre ne réalise pas de vérification utilisateur biométrique côté
  // authentificateur : une exigence UV doit rester au navigateur.
  if (options.authenticatorSelection?.userVerification === 'required') {
    return false
  }
  if (options.attestation === 'enterprise') return false
  if (unsupportedExtensions(options.extensions, true)) return false
  return true
}

function canInterceptGet(
  options: CredentialRequestOptions,
  publicKey: PublicKeyCredentialRequestOptions,
): boolean {
  if (!secureOrigin()) return false
  if (options.mediation === 'conditional') return false
  if (publicKey.userVerification === 'required') return false
  if (unsupportedExtensions(publicKey.extensions, false)) return false
  return true
}

function descriptorIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const descriptor of value) {
    try {
      const id = (descriptor as PublicKeyCredentialDescriptor).id
      ids.push(toBase64Url(id))
    } catch {
      // Un descripteur malformé est ignoré ; l’application vérifie le reste.
    }
  }
  return ids.slice(0, 50)
}

function createPayload(
  options: PublicKeyCredentialCreationOptions,
): RelayPayload | null {
  try {
    return {
      rpId: (options.rp.id ?? location.hostname).toLowerCase(),
      challenge: toBase64Url(options.challenge),
      userName: options.user.name || options.user.displayName || '',
      userHandle: toBase64Url(options.user.id),
      excludeCredentials: descriptorIds(options.excludeCredentials),
    }
  } catch {
    return null
  }
}

function getPayload(
  options: PublicKeyCredentialRequestOptions,
): RelayPayload | null {
  try {
    return {
      rpId: (options.rpId ?? location.hostname).toLowerCase(),
      challenge: toBase64Url(options.challenge),
      allowCredentials: descriptorIds(options.allowCredentials),
    }
  } catch {
    return null
  }
}

function makeAttestationResponse(
  result: Record<string, unknown>,
): AuthenticatorAttestationResponse {
  const clientDataJSON = fromBase64Url(result.clientDataJSON)
  const attestationObject = fromBase64Url(result.attestationObject)
  const authenticatorData = fromBase64Url(result.authenticatorData)
  const publicKey = result.publicKeyCose
    ? fromBase64Url(result.publicKeyCose)
    : null
  const response = {
    clientDataJSON,
    attestationObject,
    transports: ['internal'],
    getTransports: () => ['internal'],
    getAuthenticatorData: () => authenticatorData,
    getPublicKeyAlgorithm: () => -7,
    getPublicKey: () => publicKey,
  }
  const constructor = (
    globalThis as unknown as {
      AuthenticatorAttestationResponse?: { prototype: object }
    }
  ).AuthenticatorAttestationResponse
  if (constructor) {
    try {
      Object.setPrototypeOf(response, constructor.prototype)
    } catch {
      // Le prototype natif est un confort pour `instanceof` uniquement.
    }
  }
  return response as unknown as AuthenticatorAttestationResponse
}

function makeAssertionResponse(
  result: Record<string, unknown>,
): AuthenticatorAssertionResponse {
  const response = {
    clientDataJSON: fromBase64Url(result.clientDataJSON),
    authenticatorData: fromBase64Url(result.authenticatorData),
    signature: fromBase64Url(result.signature),
    userHandle:
      typeof result.userHandle === 'string' && result.userHandle
        ? fromBase64Url(result.userHandle)
        : null,
  }
  const constructor = (
    globalThis as unknown as {
      AuthenticatorAssertionResponse?: { prototype: object }
    }
  ).AuthenticatorAssertionResponse
  if (constructor) {
    try {
      Object.setPrototypeOf(response, constructor.prototype)
    } catch {
      // Voir ci-dessus.
    }
  }
  return response as unknown as AuthenticatorAssertionResponse
}

function makeCredential(
  kind: PasskeyKind,
  result: Record<string, unknown>,
  extensionResults: Record<string, unknown>,
): PublicKeyCredential {
  if (typeof result.credentialId !== 'string' || !BASE64URL.test(result.credentialId)) {
    throw fail('NotAllowedError', 'Identifiant de passkey invalide.')
  }
  const credentialId = result.credentialId
  const rawId = fromBase64Url(credentialId)
  const response =
    kind === 'create'
      ? makeAttestationResponse(result)
      : makeAssertionResponse(result)
  const toJSONResponse =
    kind === 'create'
      ? {
          clientDataJSON: String(result.clientDataJSON),
          attestationObject: String(result.attestationObject),
          transports: ['internal'],
        }
      : {
          clientDataJSON: String(result.clientDataJSON),
          authenticatorData: String(result.authenticatorData),
          signature: String(result.signature),
          userHandle:
            typeof result.userHandle === 'string' && result.userHandle
              ? result.userHandle
              : null,
        }
  const credential = {
    id: credentialId,
    rawId,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response,
    getClientExtensionResults: () => extensionResults,
    toJSON: () => ({
      id: credentialId,
      rawId: toBase64Url(rawId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: extensionResults,
      response: toJSONResponse,
    }),
  }
  const constructor = (
    globalThis as unknown as {
      PublicKeyCredential?: { prototype: object }
    }
  ).PublicKeyCredential
  if (constructor) {
    try {
      Object.setPrototypeOf(credential, constructor.prototype)
    } catch {
      // Voir ci-dessus.
    }
  }
  return credential as unknown as PublicKeyCredential
}

async function handleCreate(
  options: CredentialCreationOptions,
  original: (options?: CredentialCreationOptions) => Promise<Credential | null>,
): Promise<Credential | null> {
  const publicKey = options.publicKey
  if (!publicKey || !canInterceptCreate(publicKey) || !relayReady()) {
    return original(options)
  }
  const payload = createPayload(publicKey)
  if (!payload) return original(options)
  const relayed = await relay(
    'create',
    payload,
    requestTimeout(publicKey.timeout),
    options.signal ?? undefined,
  )
  if (relayed.fallback) return original(options)
  if (!relayed.result) {
    throw fail('NotAllowedError', 'Création de passkey impossible.')
  }
  const extensions: Record<string, unknown> = {}
  if (publicKey.extensions?.credProps) {
    extensions.credProps = { rk: true }
  }
  return makeCredential('create', relayed.result, extensions)
}

async function handleGet(
  options: CredentialRequestOptions,
  original: (options?: CredentialRequestOptions) => Promise<Credential | null>,
): Promise<Credential | null> {
  const publicKey = options.publicKey
  if (!publicKey || !canInterceptGet(options, publicKey) || !relayReady()) {
    return original(options)
  }
  const payload = getPayload(publicKey)
  if (!payload) return original(options)
  const relayed = await relay(
    'get',
    payload,
    requestTimeout(publicKey.timeout),
    options.signal ?? undefined,
  )
  if (relayed.fallback) return original(options)
  // Aucune passkey Coffre : le navigateur peut proposer un autre appareil.
  if (!relayed.result) return original(options)
  return makeCredential('get', relayed.result, {})
}

function install(): void {
  const credentials = navigator.credentials
  if (!credentials) return
  const originalCreate = credentials.create.bind(credentials)
  const originalGet = credentials.get.bind(credentials)

  const wrappedCreate = (options?: CredentialCreationOptions) =>
    handleCreate(options ?? {}, originalCreate)
  const wrappedGet = (options?: CredentialRequestOptions) =>
    handleGet(options ?? {}, originalGet)

  const patch = (name: 'create' | 'get', value: unknown) => {
    try {
      Object.defineProperty(credentials, name, {
        configurable: true,
        writable: true,
        value,
      })
      return true
    } catch {
      try {
        Object.defineProperty(Object.getPrototypeOf(credentials), name, {
          configurable: true,
          writable: true,
          value,
        })
        return true
      } catch {
        return false
      }
    }
  }

  const createPatched = patch('create', wrappedCreate)
  const getPatched = patch('get', wrappedGet)
  if (!createPatched || !getPatched) return

  Object.defineProperty(globalThis, INSTALLED_FLAG, {
    value: true,
    configurable: false,
    writable: false,
  })
}

if (
  !(globalThis as unknown as Record<string, unknown>)[INSTALLED_FLAG]
) {
  try {
    install()
  } catch {
    // La page a peut-être gelé son global : le navigateur garde ses méthodes.
  }
}
