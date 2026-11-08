import { describe, expect, it } from 'vitest'
import {
  createEmergencyEnvelope,
  generateSharingIdentity,
  openEmergencyEnvelope,
  openVaultKeyFromMember,
  publicSharingIdentity,
  sealVaultKeyForMember,
  signShareRole,
  verifyShareRole,
} from './sharing'

const vaultKey = new Uint8Array(32).fill(7)
const masterKey = new Uint8Array(32).fill(9)

describe('socle de partage L10', () => {
  it('génère des identités distinctes et une partie publique sans secret', async () => {
    const alice = await generateSharingIdentity()
    const bob = await generateSharingIdentity()
    expect(alice.fingerprint).toMatch(/^SHA256:/)
    expect(alice.fingerprint).not.toBe(bob.fingerprint)
    const publicAlice = publicSharingIdentity(alice)
    expect(publicAlice.fingerprint).toBe(alice.fingerprint)
    expect(publicAlice).not.toHaveProperty('encryptionPrivateKey')
    expect(publicAlice).not.toHaveProperty('signingPrivateKey')
  })

  it('scelle et rouvre une clé de coffre pour un membre', async () => {
    const bob = await generateSharingIdentity()
    const sealed = await sealVaultKeyForMember(vaultKey, publicSharingIdentity(bob), 'v_shared')
    const opened = await openVaultKeyFromMember(sealed, bob, 'v_shared')
    expect(Array.from(opened)).toEqual(Array.from(vaultKey))
  })

  it('refuse un autre destinataire, un autre coffre ou un chiffré altéré', async () => {
    const bob = await generateSharingIdentity()
    const eve = await generateSharingIdentity()
    const sealed = await sealVaultKeyForMember(vaultKey, publicSharingIdentity(bob), 'v_shared')
    await expect(openVaultKeyFromMember(sealed, eve, 'v_shared')).rejects.toThrow()
    await expect(openVaultKeyFromMember(sealed, bob, 'v_other')).rejects.toThrow()
    const tampered = {
      ...sealed,
      ciphertext: `${sealed.ciphertext.slice(0, -2)}AA`,
    }
    await expect(openVaultKeyFromMember(tampered, bob, 'v_shared')).rejects.toThrow()
  })

  it('signe et vérifie un rôle de membre', async () => {
    const alice = await generateSharingIdentity()
    const bob = await generateSharingIdentity()
    const role = await signShareRole(alice, {
      vaultId: 'v_shared',
      memberFingerprint: bob.fingerprint,
      role: 'read',
      issuedAt: '2026-11-08T00:00:00.000Z',
    })
    expect(role.issuedBy).toBe(alice.fingerprint)
    expect(await verifyShareRole(role, alice.signingPublicKey)).toBe(true)
    expect(await verifyShareRole(role, bob.signingPublicKey)).toBe(false)
    expect(
      await verifyShareRole({ ...role, role: 'write' }, alice.signingPublicKey),
    ).toBe(false)
  })

  it('crée et ouvre une enveloppe d’accès d’urgence', async () => {
    const contact = await generateSharingIdentity()
    const sealed = await createEmergencyEnvelope(
      masterKey,
      publicSharingIdentity(contact),
    )
    const opened = await openEmergencyEnvelope(sealed, contact)
    expect(Array.from(opened)).toEqual(Array.from(masterKey))
    const other = await generateSharingIdentity()
    await expect(openEmergencyEnvelope(sealed, other)).rejects.toThrow()
  })
})
