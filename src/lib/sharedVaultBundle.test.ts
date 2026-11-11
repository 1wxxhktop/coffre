import { describe, expect, it } from 'vitest'
import {
  createItem,
  createVaultFile,
  deleteItem,
  deleteVault,
  readVaultSharing,
  signVaultFile,
  trashItem,
  unlockVaultFile,
  updateItem,
} from './vault'
import { publicSharingIdentity, generateSharingIdentity } from './sharing'
import { createSharingIdentity } from './sharingVault'
import { createSharedVaultPackage } from './sharingPackage'
import {
  createSharedVaultBundle,
  importSharedVaultBundle,
  parseSharedVaultBundle,
  signSharedVaultBundle,
} from './sharedVaultBundle'
import { emptyDraft, type ItemDraft } from './types'

const adminPassword = 'phrase admin de test solide'
const memberPassword = 'phrase membre de test solide'
const fastKdf = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

async function setup() {
  const admin = await createVaultFile(adminPassword, 'Admin', fastKdf)
  const member = await createVaultFile(memberPassword, 'Membre', fastKdf)
  const adminIdentity = (
    await createSharingIdentity(admin.session.masterKey, admin.file.id)
  ).identity
  const memberIdentity = await generateSharingIdentity()
  const vaultId = admin.vaults[0].id
  const created = await createItem(admin.file, admin.session, {
    ...emptyDraft('login', vaultId),
    type: 'login',
    title: 'Partagé',
    username: 'ada',
    password: 'secret-partage',
  } as ItemDraft)
  const pkg = await createSharedVaultPackage({
    vaultId,
    vaultKey: admin.session.vaultKey(vaultId),
    admin: adminIdentity,
    members: [
      { identity: publicSharingIdentity(memberIdentity), role: 'read' },
    ],
  })
  const bundle = createSharedVaultBundle(created.file, vaultId, pkg)
  return {
    admin,
    member,
    adminIdentity,
    memberIdentity,
    vaultId,
    created,
    pkg,
    bundle,
  }
}

describe('paquet de contenu partagé', () => {
  it('importe les éléments et respecte le rôle lecture', async () => {
    const { member, memberIdentity, vaultId, bundle } = await setup()
    const parsed = await parseSharedVaultBundle(JSON.stringify(bundle))
    const imported = await importSharedVaultBundle(
      parsed,
      memberIdentity,
      member.file,
      member.session,
    )
    expect(imported.imported).toBe(1)
    expect(imported.role).toBe('read')
    const sharing = await readVaultSharing(
      imported.file,
      member.session,
      vaultId,
    )
    expect(sharing.members).toHaveLength(1)
    expect(sharing.adminFingerprint).toBeDefined()
    expect(sharing.package?.vaultId).toBe(vaultId)
    const signed = await signVaultFile(imported.file, member.session, member.file)
    const opened = await unlockVaultFile(signed, memberPassword)
    const item = opened.items.find((entry) => entry.title === 'Partagé')
    expect(item?.type).toBe('login')
    if (item?.type === 'login') expect(item.username).toBe('ada')
    expect(opened.vaults.find((vault) => vault.id === vaultId)?.role).toBe('read')
    await expect(
      createItem(opened.file, opened.session, {
        ...emptyDraft('login', vaultId),
        type: 'login',
        title: 'Interdit',
      } as ItemDraft),
    ).rejects.toThrow()
    const sharedItem = opened.items.find((entry) => entry.title === 'Partagé')
    expect(sharedItem).toBeDefined()
    await expect(
      trashItem(opened.file, opened.session, sharedItem!.id),
    ).rejects.toThrow(/lecture seule/i)
    await expect(
      deleteVault(opened.file, opened.session, vaultId),
    ).rejects.toThrow(/lecture seule/i)
    opened.session.lock()
    member.session.lock()
  })

  it('signe le bundle et refuse un contenu modifié', async () => {
    const { adminIdentity, bundle } = await setup()
    const signed = await signSharedVaultBundle(bundle, adminIdentity)
    expect(signed.sender?.fingerprint).toBe(adminIdentity.fingerprint)
    const parsed = await parseSharedVaultBundle(JSON.stringify(signed), {
      requireSignature: true,
    })
    expect(parsed.sender?.signature).toBe(signed.sender?.signature)

    const tampered = {
      ...signed,
      tombstones: [
        ...signed.tombstones,
        { kind: 'item', id: 'faux', deletedAt: '2999-01-01T00:00:00.000Z' },
      ],
    }
    await expect(
      parseSharedVaultBundle(JSON.stringify(tampered), {
        requireSignature: true,
      }),
    ).rejects.toThrow(/signature/i)
    await expect(
      parseSharedVaultBundle(JSON.stringify(bundle), {
        requireSignature: true,
      }),
    ).rejects.toThrow(/signé/i)
  })

  it('propage la suppression d’un élément', async () => {
    const { admin, member, memberIdentity, vaultId, pkg, created } = await setup()
    const first = await importSharedVaultBundle(
      createSharedVaultBundle(created.file, vaultId, pkg),
      memberIdentity,
      member.file,
      member.session,
    )
    const firstSigned = await signVaultFile(first.file, member.session, member.file)
    const firstOpened = await unlockVaultFile(firstSigned, memberPassword)
    expect(firstOpened.items.some((item) => item.id === created.item.id)).toBe(true)

    const withoutItem = await deleteItem(created.file, created.item.id)
    const signedAdmin = await signVaultFile(withoutItem, admin.session, created.file)
    const deletionBundle = createSharedVaultBundle(signedAdmin, vaultId, pkg)
    expect(deletionBundle.items).toHaveLength(0)
    expect(deletionBundle.tombstones.length).toBeGreaterThan(0)
    const second = await importSharedVaultBundle(
      deletionBundle,
      memberIdentity,
      firstOpened.file,
      firstOpened.session,
    )
    expect(second.deleted).toBe(1)
    const secondSigned = await signVaultFile(
      second.file,
      firstOpened.session,
      firstOpened.file,
    )
    const secondOpened = await unlockVaultFile(secondSigned, memberPassword)
    expect(secondOpened.items.some((item) => item.id === created.item.id)).toBe(false)
    secondOpened.session.lock()
    firstOpened.session.lock()
    admin.session.lock()
    member.session.lock()
  })

  it('refuse un bundle avec un identifiant invalide ou dupliqué', async () => {
    const { bundle } = await setup()
    const invalidId = {
      ...bundle,
      items: [{ ...bundle.items[0], id: 'bad:id' }],
    }
    await expect(
      parseSharedVaultBundle(JSON.stringify(invalidId)),
    ).rejects.toThrow(/invalide/i)

    const duplicate = {
      ...bundle,
      items: [bundle.items[0], { ...bundle.items[0] }],
    }
    await expect(
      parseSharedVaultBundle(JSON.stringify(duplicate)),
    ).rejects.toThrow(/double/i)

    const orphanAttachment = {
      ...bundle,
      attachments: [
        {
          id: 'a_orpheline',
          itemId: 'i_inconnu',
          vaultId: bundle.vault.id,
          data: { n: 'n', c: 'c' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }
    await expect(
      parseSharedVaultBundle(JSON.stringify(orphanAttachment)),
    ).rejects.toThrow(/inconnu/i)
  })

  it('refuse une collision d’identifiant avec un autre coffre', async () => {
    const { member, memberIdentity, vaultId, pkg, created } = await setup()
    const first = await importSharedVaultBundle(
      createSharedVaultBundle(created.file, vaultId, pkg),
      memberIdentity,
      member.file,
      member.session,
    )
    const firstSigned = await signVaultFile(first.file, member.session, member.file)
    const firstOpened = await unlockVaultFile(firstSigned, memberPassword)

    const collision = {
      ...firstOpened.file,
      items: firstOpened.file.items.map((item) =>
        item.id === created.item.id
          ? { ...item, vaultId: member.vaults[0].id }
          : item,
      ),
    }
    await expect(
      importSharedVaultBundle(
        createSharedVaultBundle(created.file, vaultId, pkg),
        memberIdentity,
        collision,
        firstOpened.session,
      ),
    ).rejects.toThrow(/Collision/i)

    firstOpened.session.lock()
    member.session.lock()
  })

  it('refuse qu’un membre write se nomme administrateur', async () => {
    const { admin, member, memberIdentity, vaultId, pkg, created } = await setup()
    const first = await importSharedVaultBundle(
      createSharedVaultBundle(created.file, vaultId, pkg),
      memberIdentity,
      member.file,
      member.session,
    )
    const firstSigned = await signVaultFile(first.file, member.session, member.file)
    const firstOpened = await unlockVaultFile(firstSigned, memberPassword)

    const evilPackage = await createSharedVaultPackage({
      vaultId,
      vaultKey: firstOpened.session.vaultKey(vaultId),
      admin: memberIdentity,
      members: [
        { identity: publicSharingIdentity(memberIdentity), role: 'write' },
      ],
      createdAt: '2999-01-01T00:00:00.000Z',
    })
    const evilBundle = createSharedVaultBundle(
      firstOpened.file,
      vaultId,
      evilPackage,
    )

    await expect(
      importSharedVaultBundle(
        evilBundle,
        memberIdentity,
        firstOpened.file,
        firstOpened.session,
      ),
    ).rejects.toThrow(/administrateur/i)

    firstOpened.session.lock()
    admin.session.lock()
    member.session.lock()
  })

  it('met à jour un élément avec un paquet plus récent', async () => {
    const { admin, member, memberIdentity, vaultId, pkg, created } = await setup()
    const first = await importSharedVaultBundle(
      createSharedVaultBundle(created.file, vaultId, pkg),
      memberIdentity,
      member.file,
      member.session,
    )
    const firstSigned = await signVaultFile(first.file, member.session, member.file)
    const firstOpened = await unlockVaultFile(firstSigned, memberPassword)

    const updated = await updateItem(created.file, admin.session, {
      ...created.item,
      title: 'Partagé v2',
    })
    const secondBundle = createSharedVaultBundle(updated.file, vaultId, pkg)
    const second = await importSharedVaultBundle(
      secondBundle,
      memberIdentity,
      firstOpened.file,
      firstOpened.session,
    )
    expect(second.updated).toBe(1)
    const secondSigned = await signVaultFile(
      second.file,
      firstOpened.session,
      firstOpened.file,
    )
    const secondOpened = await unlockVaultFile(secondSigned, memberPassword)
    expect(secondOpened.items.some((entry) => entry.title === 'Partagé v2')).toBe(true)
    secondOpened.session.lock()
    firstOpened.session.lock()
    admin.session.lock()
    member.session.lock()
  })
})
