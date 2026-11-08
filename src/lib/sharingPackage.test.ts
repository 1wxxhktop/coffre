import { describe, expect, it } from 'vitest'
import {
  createSharedVaultPackage,
  openSharedVaultPackage,
  parseSharedVaultPackage,
} from './sharingPackage'
import {
  generateSharingIdentity,
  publicSharingIdentity,
} from './sharing'

const vaultKey = new Uint8Array(32).fill(5)

async function packageWithMembers() {
  const admin = await generateSharingIdentity()
  const bob = await generateSharingIdentity()
  const carol = await generateSharingIdentity()
  const pkg = await createSharedVaultPackage({
    vaultId: 'v_shared',
    vaultKey,
    admin,
    members: [
      { identity: publicSharingIdentity(admin), role: 'write' },
      { identity: publicSharingIdentity(bob), role: 'read' },
      { identity: publicSharingIdentity(carol), role: 'write' },
    ],
    createdAt: '2026-11-09T00:00:00.000Z',
  })
  return { admin, bob, carol, pkg }
}

describe('paquet de partage', () => {
  it('enveloppe la clé et signe le rôle de chaque membre', async () => {
    const { admin, bob, carol, pkg } = await packageWithMembers()
    expect(pkg.admin.fingerprint).toBe(admin.fingerprint)
    expect(pkg.members).toHaveLength(3)
    const bobImport = await openSharedVaultPackage(pkg, bob)
    expect(bobImport.role).toBe('read')
    expect(Array.from(bobImport.vaultKey)).toEqual(Array.from(vaultKey))
    const carolImport = await openSharedVaultPackage(pkg, carol)
    expect(carolImport.role).toBe('write')
  })

  it('valide un paquet importé et refuse une signature altérée', async () => {
    const { pkg } = await packageWithMembers()
    const parsed = await parseSharedVaultPackage(JSON.stringify(pkg))
    expect(parsed.members).toHaveLength(3)
    const altered = {
      ...pkg,
      members: pkg.members.map((member, index) =>
        index === 1
          ? { ...member, role: { ...member.role, signature: 'AAAA' } }
          : member,
      ),
    }
    await expect(parseSharedVaultPackage(altered)).rejects.toThrow()
    await expect(parseSharedVaultPackage('{')).rejects.toThrow()
  })

  it('refuse une identité absente du paquet', async () => {
    const { pkg } = await packageWithMembers()
    const eve = await generateSharingIdentity()
    await expect(openSharedVaultPackage(pkg, eve)).rejects.toThrow()
  })

  it('refuse un rôle altéré ou une signature invalide', async () => {
    const { bob, pkg } = await packageWithMembers()
    const altered = {
      ...pkg,
      members: pkg.members.map((member) =>
        member.identity.fingerprint === bob.fingerprint
          ? { ...member, role: { ...member.role, role: 'write' as const } }
          : member,
      ),
    }
    await expect(openSharedVaultPackage(altered, bob)).rejects.toThrow()

    const otherAdmin = await generateSharingIdentity()
    const forged = {
      ...pkg,
      admin: publicSharingIdentity(otherAdmin),
    }
    await expect(openSharedVaultPackage(forged, bob)).rejects.toThrow()
  })

  it('refuse une enveloppe altérée', async () => {
    const { bob, pkg } = await packageWithMembers()
    const altered = {
      ...pkg,
      members: pkg.members.map((member) =>
        member.identity.fingerprint === bob.fingerprint
          ? {
              ...member,
              wrap: {
                ...member.wrap,
                ciphertext: `${member.wrap.ciphertext.slice(0, -2)}AA`,
              },
            }
          : member,
      ),
    }
    await expect(openSharedVaultPackage(altered, bob)).rejects.toThrow()
  })
})

describe('import d’un coffre partagé', () => {
  const adminPassword = 'phrase de passe admin solide'
  const memberPassword = 'phrase de passe membre solide'
  const fastKdf = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

  it('ajoute le coffre partagé avec la clé reçue', async () => {
    const { createVaultFile, signVaultFile, unlockVaultFile, addSharedVault } = await import('./vault')
    const admin = await createVaultFile(adminPassword, 'Admin', fastKdf)
    const member = await createVaultFile(memberPassword, 'Membre', fastKdf)
    const adminIdentity = await generateSharingIdentity()
    const memberIdentity = await generateSharingIdentity()
    const vaultId = admin.vaults[0].id
    const vaultKey = admin.session.vaultKey(vaultId)
    expect(vaultKey).toBeDefined()
    const pkg = await createSharedVaultPackage({
      vaultId,
      vaultKey: vaultKey as Uint8Array,
      admin: adminIdentity,
      members: [{ identity: publicSharingIdentity(memberIdentity), role: 'read' }],
    })
    const imported = await openSharedVaultPackage(pkg, memberIdentity)
    const added = await addSharedVault(member.file, member.session, {
      vaultId,
      name: 'Partagé',
      key: imported.vaultKey,
    })
    const signed = await signVaultFile(added.file, member.session, member.file)
    const opened = await unlockVaultFile(signed, memberPassword)
    expect(opened.vaults.some((vault) => vault.id === vaultId && vault.name === 'Partagé')).toBe(
      true,
    )
    await expect(
      addSharedVault(opened.file, opened.session, {
        vaultId,
        name: 'Doublon',
        key: imported.vaultKey,
      }),
    ).rejects.toThrow()
    opened.session.lock()
    admin.session.lock()
    member.session.lock()
  })
})
