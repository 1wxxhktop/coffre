import { describe, expect, it } from 'vitest'
import {
  createItem,
  createVaultFile,
  signVaultFile,
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
    opened.session.lock()
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
