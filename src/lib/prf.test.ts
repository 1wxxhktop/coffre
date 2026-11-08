import { describe, expect, it, vi } from 'vitest'
import {
  createPrfCredential,
  createPrfEnvelope,
  derivePrfKek,
  getPrfOutput,
  openPrfEnvelope,
  PrfError,
} from './prf'

const FILE_ID = 'vf_prf_test'
const MASTER = Uint8Array.from({ length: 32 }, (_, index) => index)
const PRF = Uint8Array.from({ length: 32 }, (_, index) => 255 - index)
const SALT = Uint8Array.from({ length: 32 }, (_, index) => index * 3)

describe('enveloppe PRF', () => {
  it('scelle et rouvre la clé maîtresse', async () => {
    const envelope = await createPrfEnvelope(
      MASTER,
      PRF,
      'cred_test',
      SALT,
      FILE_ID,
      '2026-11-08T00:00:00.000Z',
    )
    expect(envelope.credentialId).toBe('cred_test')
    expect(envelope.wrap.c.length).toBeGreaterThan(0)

    const opened = await openPrfEnvelope(envelope, PRF, FILE_ID)
    expect(opened).toEqual(MASTER)
    opened.fill(0)
  })

  it('refuse un autre fichier ou une autre sortie PRF', async () => {
    const envelope = await createPrfEnvelope(
      MASTER,
      PRF,
      'cred_test',
      SALT,
      FILE_ID,
    )
    await expect(openPrfEnvelope(envelope, PRF, 'vf_other')).rejects.toBeInstanceOf(
      PrfError,
    )
    const wrong = PRF.slice()
    wrong[0] ^= 0xff
    await expect(openPrfEnvelope(envelope, wrong, FILE_ID)).rejects.toBeInstanceOf(
      PrfError,
    )
  })

  it('dérive une KEK différente par fichier', async () => {
    const a = await derivePrfKek(PRF, SALT, 'vf_a')
    const b = await derivePrfKek(PRF, SALT, 'vf_b')
    expect(a).toHaveLength(32)
    expect(b).toHaveLength(32)
    expect(a).not.toEqual(b)
  })
})

describe('cérémonie WebAuthn PRF', () => {
  it('crée un credential puis évalue le PRF', async () => {
    const create = vi.fn(async () => ({
      type: 'public-key',
      rawId: Uint8Array.of(1, 2, 3, 4).buffer,
      getClientExtensionResults: () => ({ prf: { enabled: true } }),
    }))
    const get = vi.fn(async () => ({
      type: 'public-key',
      getClientExtensionResults: () => ({
        prf: { results: { first: PRF.slice().buffer } },
      }),
    }))
    const credentials = { create, get } as unknown as CredentialsContainer

    const result = await createPrfCredential({
      rpId: 'example.com',
      userName: 'ada',
      credentials,
    })
    expect(result.credentialId).toBe('AQIDBA')
    expect(result.prfOutput).toEqual(PRF)
    expect(create).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('refuse une clé sans PRF', async () => {
    const credentials = {
      create: vi.fn(async () => ({
        type: 'public-key',
        rawId: Uint8Array.of(1).buffer,
        getClientExtensionResults: () => ({ prf: { enabled: false } }),
      })),
      get: vi.fn(),
    } as unknown as CredentialsContainer
    await expect(
      createPrfCredential({
        rpId: 'example.com',
        userName: 'ada',
        credentials,
      }),
    ).rejects.toBeInstanceOf(PrfError)
    expect(credentials.get).not.toHaveBeenCalled()
  })

  it('refuse une assertion sans sortie PRF', async () => {
    const credentials = {
      get: vi.fn(async () => ({
        type: 'public-key',
        getClientExtensionResults: () => ({ prf: {} }),
      })),
    } as unknown as CredentialsContainer
    await expect(
      getPrfOutput({
        credentialId: 'AQID',
        salt: SALT,
        rpId: 'example.com',
        credentials,
      }),
    ).rejects.toBeInstanceOf(PrfError)
  })
})
