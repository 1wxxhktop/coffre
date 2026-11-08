/**
 * Déverrouillage optionnel par clé FIDO2/PRF.
 *
 * La sortie PRF ne quitte jamais la mémoire : elle sert de clé HKDF pour
 * envelopper la clé maîtresse dans une enveloppe séparée du fichier. Le mot de
 * passe maître reste le secret racine et l’enveloppe est révocable.
 */

import { openBytes, randomBytes, sealBytes, toBase64, utf8, fromBase64 } from './crypto'
import { fromBase64Url, toBase64Url } from './passkeys'
import type { PrfEnvelope } from './types'

export class PrfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrfError'
  }
}

export interface PrfCredential {
  credentialId: string
  salt: Uint8Array
  prfOutput: Uint8Array
}

interface PrfExtensionResults {
  enabled?: boolean
  results?: { first?: ArrayBuffer }
}

export function prfSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.credentials?.create) &&
    Boolean(navigator.credentials?.get)
  )
}

function prfKekInfo(fileId: string): string {
  return `coffre:v1:prf-kek:${fileId}`
}

export function prfUnlockAad(fileId: string): string {
  return `coffre:v1:prf-unlock:${fileId}`
}

/** Dérive la KEK AES-256 à partir de la sortie PRF et du sel de l’enveloppe. */
export async function derivePrfKek(
  prfOutput: Uint8Array,
  salt: Uint8Array,
  fileId: string,
): Promise<Uint8Array> {
  if (prfOutput.length !== 32 || salt.length < 16) {
    throw new PrfError('Sortie PRF invalide')
  }
  const key = await crypto.subtle.importKey(
    'raw',
    prfOutput as BufferSource,
    'HKDF',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: utf8(prfKekInfo(fileId)) as BufferSource,
    },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export async function createPrfEnvelope(
  masterKey: Uint8Array,
  prfOutput: Uint8Array,
  credentialId: string,
  salt: Uint8Array,
  fileId: string,
  createdAt = new Date().toISOString(),
): Promise<PrfEnvelope> {
  if (masterKey.length !== 32 || prfOutput.length !== 32) {
    throw new PrfError('Clé PRF invalide')
  }
  const kek = await derivePrfKek(prfOutput, salt, fileId)
  try {
    return {
      version: 1,
      credentialId,
      salt: toBase64(salt),
      createdAt,
      wrap: await sealBytes(masterKey, kek, prfUnlockAad(fileId)),
    }
  } finally {
    kek.fill(0)
  }
}

/** Ouvre l’enveloppe et renvoie la clé maîtresse ; l’appelant doit l’effacer. */
export async function openPrfEnvelope(
  envelope: PrfEnvelope,
  prfOutput: Uint8Array,
  fileId: string,
): Promise<Uint8Array> {
  const salt = fromBase64(envelope.salt)
  const kek = await derivePrfKek(prfOutput, salt, fileId)
  try {
    const masterKey = await openBytes(envelope.wrap, kek, prfUnlockAad(fileId))
    if (masterKey.length !== 32) throw new PrfError('Clé maîtresse invalide')
    return masterKey
  } catch {
    throw new PrfError('Enveloppe PRF invalide ou clé de sécurité différente')
  } finally {
    kek.fill(0)
    salt.fill(0)
  }
}

function prfResults(credential: Credential | null): PrfExtensionResults {
  if (!credential || credential.type !== 'public-key') return {}
  const results = (
    credential as PublicKeyCredential
  ).getClientExtensionResults() as {
    prf?: PrfExtensionResults
  }
  return results.prf ?? {}
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}

/** Crée un credential WebAuthn avec l’extension PRF activée. */
export async function createPrfCredential(
  options: {
    rpId: string
    userName: string
    credentials?: CredentialsContainer
  },
): Promise<PrfCredential> {
  const credentials = options.credentials ?? navigator.credentials
  const challenge = randomBytes(32)
  const userId = randomBytes(16)
  const created = await credentials.create({
    publicKey: {
      challenge: challenge as BufferSource,
      rp: { id: options.rpId, name: 'Coffre' },
      user: {
        id: userId as BufferSource,
        name: options.userName.slice(0, 200),
        displayName: options.userName.slice(0, 200),
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      attestation: 'none',
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })
  const results = prfResults(created)
  if (results.enabled === false) {
    throw new PrfError(
      'Cette clé de sécurité ne prend pas en charge l’extension PRF.',
    )
  }
  if (!created || created.type !== 'public-key') {
    throw new PrfError('Création de la clé de sécurité annulée.')
  }
  const credentialId = toBase64Url(
    new Uint8Array((created as PublicKeyCredential).rawId),
  )
  const salt = randomBytes(32)
  const prfOutput = await getPrfOutput({
    credentialId,
    salt,
    rpId: options.rpId,
    credentials,
  })
  return { credentialId, salt, prfOutput }
}

/** Évalue le PRF pour un credential existant et un sel donné. */
export async function getPrfOutput(options: {
  credentialId: string
  salt: Uint8Array
  rpId: string
  credentials?: CredentialsContainer
}): Promise<Uint8Array> {
  const credentials = options.credentials ?? navigator.credentials
  const challenge = randomBytes(32)
  const assertion = await credentials.get({
    publicKey: {
      challenge: challenge as BufferSource,
      rpId: options.rpId,
      allowCredentials: [
        {
          type: 'public-key',
          id: asArrayBuffer(fromBase64Url(options.credentialId)),
        },
      ],
      userVerification: 'required',
      extensions: {
        prf: { eval: { first: options.salt as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
    },
  })
  const results = prfResults(assertion)
  const output = results.results?.first
  if (!output) {
    throw new PrfError(
      'Cette clé de sécurité n’a pas fourni de sortie PRF. Utilisez le mot de passe.',
    )
  }
  const bytes = new Uint8Array(output)
  if (bytes.length !== 32) throw new PrfError('Sortie PRF invalide')
  return bytes
}

/** Crée le credential et son enveloppe en une seule cérémonie. */
export async function enrollPrf(
  masterKey: Uint8Array,
  fileId: string,
  options: {
    rpId: string
    userName: string
    credentials?: CredentialsContainer
    createdAt?: string
  },
): Promise<PrfEnvelope> {
  const credential = await createPrfCredential(options)
  try {
    return await createPrfEnvelope(
      masterKey,
      credential.prfOutput,
      credential.credentialId,
      credential.salt,
      fileId,
      options.createdAt,
    )
  } finally {
    credential.prfOutput.fill(0)
    credential.salt.fill(0)
  }
}
