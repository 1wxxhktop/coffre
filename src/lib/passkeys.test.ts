import { describe, expect, it } from 'vitest'
import { decodeCbor, type CborValue } from './cbor'
import { sha256 } from './crypto'
import {
  createPasskey,
  decodeClientData,
  derSignatureToRaw,
  fromBase64Url,
  isValidRpId,
  PasskeyError,
  signPasskey,
  type CreatedPasskey,
} from './passkeys'
import { emptyDraft, type PasskeyItem } from './types'

function base64(value: string): Uint8Array {
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

function toItem(created: CreatedPasskey): PasskeyItem {
  return {
    ...emptyDraft('passkey', 'v_test'),
    ...created,
    rpId: 'example.com',
    userName: 'ada@example.com',
    id: 'i_passkey',
    vaultId: 'v_test',
    title: 'Passkey · example.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as PasskeyItem
}

async function verifyAssertion(created: CreatedPasskey, assertion: {
  authenticatorData: string
  clientDataJSON: string
  signature: string
}): Promise<boolean> {
  const cose = decodeCbor(base64(created.publicKeyCose)) as Map<
    CborValue,
    CborValue
  >
  const x = cose.get(-2) as Uint8Array
  const y = cose.get(-3) as Uint8Array
  const raw = concat(Uint8Array.of(0x04), x, y)
  const key = await crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  const authData = fromBase64Url(assertion.authenticatorData)
  const client = fromBase64Url(assertion.clientDataJSON)
  const signature = derSignatureToRaw(fromBase64Url(assertion.signature))
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signature as BufferSource,
    concat(authData, await sha256(client)) as BufferSource,
  )
}

describe('RP ID WebAuthn', () => {
  it('accepte le domaine exact et ses sous-domaines', () => {
    expect(isValidRpId('example.com', 'https://example.com')).toBe(true)
    expect(isValidRpId('example.com', 'https://login.example.com')).toBe(true)
    expect(isValidRpId('localhost', 'http://localhost:1420')).toBe(true)
  })

  it('refuse les suffixes publics, les IP et les autres domaines', () => {
    expect(isValidRpId('com', 'https://example.com')).toBe(false)
    expect(isValidRpId('github.io', 'https://user.github.io')).toBe(false)
    expect(isValidRpId('127.0.0.1', 'http://127.0.0.1:1420')).toBe(false)
    expect(isValidRpId('evil.com', 'https://example.com')).toBe(false)
    expect(isValidRpId('ample.com', 'https://example.com')).toBe(false)
    expect(() => isValidRpId('example.com', 'http://example.com')).toThrow(
      PasskeyError,
    )
  })
})

describe('passkeys ES256', () => {
  it('crée une attestation none vérifiable', async () => {
    const created = await createPasskey({
      rpId: 'example.com',
      origin: 'https://login.example.com',
      challenge: 'Y2hhbGxlbmdlLTE',
      userName: 'ada@example.com',
      userHandle: 'dXNlci0x',
    })
    expect(created.credentialId).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(created.userHandle).toBe('dXNlci0x')
    expect(created.signCount).toBe(0)

    const client = decodeClientData(created.clientDataJSON)
    expect(client).toMatchObject({
      type: 'webauthn.create',
      challenge: 'Y2hhbGxlbmdlLTE',
      origin: 'https://login.example.com',
    })

    const attestation = decodeCbor(
      fromBase64Url(created.attestationObject),
    ) as Map<CborValue, CborValue>
    expect(attestation.get('fmt')).toBe('none')
    const authData = attestation.get('authData') as Uint8Array
    expect(authData.length).toBeGreaterThan(100)
    // rpIdHash = SHA-256("example.com")
    const rpHash = await sha256(new TextEncoder().encode('example.com'))
    expect(authData.slice(0, 32)).toEqual(rpHash)
  })

  it('signe une assertion DER vérifiable sans exposer la clé privée', async () => {
    const created = await createPasskey({
      rpId: 'example.com',
      origin: 'https://login.example.com',
      challenge: 'Y3JlYXRl',
      userName: 'ada@example.com',
    })
    const item = toItem(created)

    const assertion = await signPasskey(item, {
      rpId: 'example.com',
      origin: 'https://login.example.com',
      challenge: 'YXNzZXJ0',
    })
    expect(assertion.credentialId).toBe(created.credentialId)
    expect(assertion.signCount).toBe(0)
    expect(decodeClientData(assertion.clientDataJSON)).toMatchObject({
      type: 'webauthn.get',
      challenge: 'YXNzZXJ0',
    })
    await expect(verifyAssertion(created, assertion)).resolves.toBe(true)

    await expect(
      signPasskey(item, {
        rpId: 'evil.com',
        origin: 'https://evil.com',
        challenge: 'YXNzZXJ0',
      }),
    ).rejects.toBeInstanceOf(PasskeyError)
  })

  it('refuse une création pour un RP ID non autorisé', async () => {
    await expect(
      createPasskey({
        rpId: 'github.io',
        origin: 'https://user.github.io',
        challenge: 'Y3JlYXRl',
        userName: 'ada',
      }),
    ).rejects.toBeInstanceOf(PasskeyError)
  })
})
