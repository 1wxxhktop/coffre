import { describe, expect, it } from 'vitest'
import {
  createItem,
  createVaultFile,
  deleteItem,
  signVaultFile,
  unlockVaultFile,
  updateItem,
} from './vault'
import { generateSharingIdentity, publicSharingIdentity } from './sharing'
import { createSharingIdentity } from './sharingVault'
import { createSharedVaultPackage } from './sharingPackage'
import {
  createSharedVaultBundle,
  importSharedVaultBundle,
  parseSharedVaultBundle,
  signSharedVaultBundle,
} from './sharedVaultBundle'
import { syncSharedVault, type SharedSyncIO } from './sharedSync'
import { emptyDraft, type ItemDraft } from './types'

const adminPassword = 'phrase admin partage solide'
const memberPassword = 'phrase membre partage solide'
const fastKdf = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

async function setup(role: 'read' | 'write' = 'write') {
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
      { identity: publicSharingIdentity(adminIdentity), role: 'write' },
      { identity: publicSharingIdentity(memberIdentity), role },
    ],
  })
  const files = new Map<string, string>()
  const io = memorySharedSyncIO(files)
  const adminSync = await syncSharedVault({
    file: created.file,
    session: admin.session,
    identity: adminIdentity,
    vaultId,
    package: pkg,
    io,
    lastImports: {},
  })
  const adminText = files.get(adminSync.ownFile)
  expect(adminText).toBeTruthy()
  const adminBundle = await parseSharedVaultBundle(adminText, {
    requireSignature: true,
  })
  const imported = await importSharedVaultBundle(
    adminBundle,
    memberIdentity,
    member.file,
    member.session,
  )
  const signed = await signVaultFile(
    imported.file,
    member.session,
    member.file,
  )
  const openedMember = await unlockVaultFile(signed, memberPassword)
  return {
    admin,
    member,
    adminIdentity,
    memberIdentity,
    vaultId,
    created,
    pkg,
    files,
    io,
    adminSync,
    openedMember,
  }
}

function memorySharedSyncIO(files: Map<string, string>): SharedSyncIO {
  return {
    list: async () =>
      [...files.keys()].sort().map((name) => ({
        name,
        size: files.get(name)?.length ?? 0,
        modifiedAt: null,
      })),
    read: async (name) => files.get(name) ?? null,
    write: async (name, contents) => {
      files.set(name, contents)
    },
  }
}

describe('synchronisation des coffres partagés', () => {
  it('échange les modifications entre deux membres', async () => {
    const {
      admin,
      adminIdentity,
      memberIdentity,
      vaultId,
      pkg,
      files,
      io,
      adminSync,
      openedMember,
    } = await setup()

    const localItem = openedMember.items.find((item) => item.title === 'Partagé')
    expect(localItem).toBeDefined()
    if (!localItem) return
    const updated = await updateItem(openedMember.file, openedMember.session, {
      ...localItem,
      title: 'Partagé par le membre',
    })
    const memberSync = await syncSharedVault({
      file: updated.file,
      session: openedMember.session,
      identity: memberIdentity,
      vaultId,
      package: pkg,
      io,
      lastImports: {},
    })
    expect(memberSync.written).toBe(true)
    expect(files.has(memberSync.ownFile)).toBe(true)
    expect(memberSync.changed).toBe(false)

    const adminSecond = await syncSharedVault({
      file: adminSync.file,
      session: admin.session,
      identity: adminIdentity,
      vaultId,
      package: pkg,
      io,
      lastImports: {},
    })
    expect(adminSecond.changed).toBe(true)
    expect(adminSecond.updated).toBe(1)
    const adminSigned = await signVaultFile(
      adminSecond.file,
      admin.session,
      adminSync.file,
    )
    const adminOpened = await unlockVaultFile(adminSigned, adminPassword)
    expect(
      adminOpened.items.some(
        (item) => item.title === 'Partagé par le membre',
      ),
    ).toBe(true)
    adminOpened.session.lock()
    openedMember.session.lock()
    admin.session.lock()
  })

  it('propage une suppression signée', async () => {
    const {
      admin,
      adminIdentity,
      memberIdentity,
      vaultId,
      created,
      pkg,
      io,
      adminSync,
      openedMember,
    } = await setup()

    const withoutItem = await deleteItem(adminSync.file, created.item.id)
    const signedAdmin = await signVaultFile(
      withoutItem,
      admin.session,
      adminSync.file,
    )
    const adminSyncDeleted = await syncSharedVault({
      file: signedAdmin,
      session: admin.session,
      identity: adminIdentity,
      vaultId,
      package: pkg,
      io,
      lastImports: {},
    })
    expect(adminSyncDeleted.written).toBe(true)

    const memberSync = await syncSharedVault({
      file: openedMember.file,
      session: openedMember.session,
      identity: memberIdentity,
      vaultId,
      package: pkg,
      io,
      lastImports: {},
    })
    expect(memberSync.deleted).toBe(1)
    expect(
      memberSync.file.items.some((item) => item.id === created.item.id),
    ).toBe(false)
    openedMember.session.lock()
    admin.session.lock()
  })

  it('refuse automatiquement une nouvelle clé de coffre', async () => {
    const {
      admin,
      adminIdentity,
      memberIdentity,
      vaultId,
      pkg,
      files,
      adminSync,
      openedMember,
    } = await setup()
    const rotated = await createSharedVaultPackage({
      vaultId,
      vaultKey: new Uint8Array(32).fill(21),
      admin: adminIdentity,
      members: [
        { identity: publicSharingIdentity(adminIdentity), role: 'write' },
        { identity: publicSharingIdentity(memberIdentity), role: 'write' },
      ],
    })
    const rotatedBundle = await signSharedVaultBundle(
      createSharedVaultBundle(adminSync.file, vaultId, rotated),
      adminIdentity,
    )
    files.set(adminSync.ownFile, JSON.stringify(rotatedBundle))

    const result = await syncSharedVault({
      file: openedMember.file,
      session: openedMember.session,
      identity: memberIdentity,
      vaultId,
      package: pkg,
      io: memorySharedSyncIO(files),
      lastImports: {},
    })
    expect(result.changed).toBe(false)
    expect(result.warnings.join(' ')).toContain('nouvelle clé')
    expect(openedMember.items.some((item) => item.title === 'Partagé')).toBe(
      true,
    )
    openedMember.session.lock()
    admin.session.lock()
  })

  it('un membre en lecture importe sans écrire de bundle', async () => {
    const { memberIdentity, vaultId, pkg, files, io, openedMember } =
      await setup('read')
    const memberSync = await syncSharedVault({
      file: openedMember.file,
      session: openedMember.session,
      identity: memberIdentity,
      vaultId,
      package: pkg,
      io,
      lastImports: {},
    })
    expect(memberSync.written).toBe(false)
    expect(files.size).toBe(1)
    expect(memberSync.changed).toBe(false)
    expect(openedMember.items.some((item) => item.title === 'Partagé')).toBe(
      true,
    )
    openedMember.session.lock()
  })
})
