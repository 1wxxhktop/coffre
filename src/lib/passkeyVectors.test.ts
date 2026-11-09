import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeCbor, type CborValue } from './cbor'
import { sha256 } from './crypto'
import {
  derSignatureToRaw,
  fromBase64Url,
  publicKeyCoseFromPrivateKey,
} from './passkeys'

interface AssertionVector {
  clientDataJSON: string
  authenticatorData: string
  signature: string
}

interface CreateVector extends AssertionVector {
  credentialId: string
  userHandle: string
  privateKey: string
  publicKeyCose: string
  attestationObject: string
  signCount: number
}

const vector = JSON.parse(
  readFileSync('test-vectors/passkeys.json', 'utf8'),
) as {
  rpId: string
  origin: string
  challenge: string
  credentialId: string
  userHandle: string
  privateKey: string
  signCount: number
  tsAssertion: AssertionVector
  rustAssertion: AssertionVector
  tsCreate: CreateVector
  rustCreate: CreateVector
}

const encoder = new TextEncoder()

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

async function publicKeyFor(privateKey: string): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodeBase64(privateKey) as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', key)
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
}

async function verifyAssertion(
  assertion: AssertionVector,
  privateKey: string,
): Promise<boolean> {
  const authenticatorData = fromBase64Url(assertion.authenticatorData)
  const clientData = fromBase64Url(assertion.clientDataJSON)
  const clientHash = await sha256(clientData)
  const signature = derSignatureToRaw(fromBase64Url(assertion.signature))
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    await publicKeyFor(privateKey),
    signature as BufferSource,
    concat(authenticatorData, clientHash) as BufferSource,
  )
}

async function expectValidCreate(created: CreateVector): Promise<void> {
  const attestation = decodeCbor(fromBase64Url(created.attestationObject))
  expect(attestation).toBeInstanceOf(Map)
  const map = attestation as Map<CborValue, CborValue>
  expect(map.get('fmt')).toBe('none')
  expect(map.get('attStmt')).toBeInstanceOf(Map)
  const authData = map.get('authData')
  expect(authData).toBeInstanceOf(Uint8Array)
  const bytes = authData as Uint8Array

  const rpHash = await sha256(encoder.encode(vector.rpId))
  expect(Array.from(bytes.subarray(0, 32))).toEqual(Array.from(rpHash))
  expect(bytes[32]).toBe(0x59)
  const credentialLength = (bytes[53] << 8) | bytes[54]
  const credentialId = bytes.subarray(55, 55 + credentialLength)
  expect(Array.from(credentialId)).toEqual(Array.from(fromBase64Url(created.credentialId)))
  const cose = bytes.subarray(55 + credentialLength)
  expect(Array.from(cose)).toEqual(Array.from(decodeBase64(created.publicKeyCose)))
  expect(await publicKeyCoseFromPrivateKey(created.privateKey)).toBe(created.publicKeyCose)

  const client = JSON.parse(
    new TextDecoder().decode(fromBase64Url(created.clientDataJSON)),
  ) as { type: string; challenge: string; origin: string; crossOrigin: boolean }
  expect(client.type).toBe('webauthn.create')
  expect(client.challenge).toBe(vector.challenge)
  expect(client.origin).toBe(vector.origin)
  expect(client.crossOrigin).toBe(false)
}

describe('vecteurs croisés de passkeys', () => {
  it('vérifie la signature produite par TypeScript', async () => {
    expect(await verifyAssertion(vector.tsAssertion, vector.privateKey)).toBe(true)
  })

  it('vérifie la signature produite par Rust', async () => {
    expect(await verifyAssertion(vector.rustAssertion, vector.privateKey)).toBe(true)
  })

  it('vérifie l’attestation créée par Rust', async () => {
    await expectValidCreate(vector.rustCreate)
  })

  it('vérifie l’attestation créée par TypeScript', async () => {
    await expectValidCreate(vector.tsCreate)
  })
})
