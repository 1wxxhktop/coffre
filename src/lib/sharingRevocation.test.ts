import { describe, expect, it } from 'vitest'
import {
  createItem,
  createVaultFile,
  openVaultFileWithMasterKey,
  readVaultSharing,
  rotateVaultKey,
  setVaultSharingMembers,
  signVaultFile,
} from './vault'
import { itemKeyAad, openBytes } from './crypto'
import { emptyDraft } from './types'
import { generateSharingIdentity, publicSharingIdentity } from './sharing'

const password = 'phrase de passe de test solide'
const fastKdf = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

describe('révocation d’un membre', () => {
  it('tourne la clé, ré-enveloppe les éléments et met à jour les membres', async () => {
    const opened = await createVaultFile(password, 'Partagé', fastKdf)
    const vaultId = opened.vaults[0].id
    const admin = await generateSharingIdentity()
    const bob = await generateSharingIdentity()
    const members = [
      { ...publicSharingIdentity(admin), role: 'write' as const },
      { ...publicSharingIdentity(bob), role: 'read' as const },
    ]
    const created = await createItem(opened.file, opened.session, {
      ...emptyDraft('login', vaultId),
      title: 'Avant révocation',
    })
    const withMembers = await setVaultSharingMembers(
      created.file,
      opened.session,
      vaultId,
      members,
      admin.fingerprint,
    )
    const before = await readVaultSharing(withMembers, opened.session, vaultId)
    expect(before.members).toHaveLength(2)
    expect(before.adminFingerprint).toBe(admin.fingerprint)

    const oldKey = Uint8Array.from(opened.session.vaultKey(vaultId))
    const newKey = new Uint8Array(32).fill(11)
    const rotated = await rotateVaultKey(withMembers, opened.session, vaultId, newKey)
    expect(Array.from(opened.session.vaultKey(vaultId))).not.toEqual(Array.from(oldKey))

    const remaining = members.filter((member) => member.fingerprint !== bob.fingerprint)
    const updated = await setVaultSharingMembers(
      rotated,
      opened.session,
      vaultId,
      remaining,
      admin.fingerprint,
    )
    const after = await readVaultSharing(updated, opened.session, vaultId)
    expect(after.members).toHaveLength(1)
    expect(after.members[0]?.fingerprint).toBe(admin.fingerprint)

    const signed = await signVaultFile(updated, opened.session, withMembers)
    const reopened = await openVaultFileWithMasterKey(signed, opened.session.masterKey)
    expect(reopened.items.some((item) => item.title === 'Avant révocation')).toBe(true)
    const record = signed.items.find((item) => item.id === created.item.id)
    expect(record).toBeDefined()
    await expect(
      openBytes(record!.key, oldKey, itemKeyAad(vaultId, record!.id)),
    ).rejects.toThrow()
    reopened.session.lock()
    opened.session.lock()
  })
})
