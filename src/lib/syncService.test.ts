import { describe, expect, it } from 'vitest'
import {
  appendActivity,
  appendGeneratorHistory,
  changeMasterPassword,
  createItem,
  createTemplate,
  createVaultFile,
  listItemVersions,
  rotateVaultKey,
  setAliasKey,
  signVaultFile,
  unlockVaultFile,
  updateItem,
} from './vault'
import { createSharingIdentity } from './sharingVault'
import { randomBytes } from './crypto'
import { createEmergencyRecord } from './emergencyVault'
import { generateSharingIdentity, publicSharingIdentity } from './sharing'
import {
  reconcileVaultFiles,
  SyncEpochRequiredError,
  SyncServiceError,
} from './syncService'
import { emptyDraft, type ItemDraft, type LoginItem, type VaultFile } from './types'

const PASSWORD = 'phrase de passe de test solide'
const NEW_PASSWORD = 'nouvelle phrase de passe solide'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

async function baseVault() {
  const opened = await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
  const vaultId = opened.vaults[0].id
  const created = await createItem(opened.file, opened.session, {
    ...emptyDraft('login', vaultId),
    title: 'GitHub',
    username: 'studio26',
    password: 's3cret!',
    urls: ['https://github.com'],
    type: 'login',
    totp: '',
  } as ItemDraft)
  const file = await signVaultFile(created.file, opened.session, opened.file)
  return { opened, file, item: created.item as LoginItem, vaultId }
}

async function addNote(
  file: VaultFile,
  session: Awaited<ReturnType<typeof createVaultFile>>['session'],
  vaultId: string,
  title: string,
): Promise<VaultFile> {
  const created = await createItem(file, session, {
    ...emptyDraft('note', vaultId),
    title,
  } as ItemDraft)
  return signVaultFile(created.file, session, file)
}

describe('orchestration de synchronisation', () => {
  it('vérifie le MAC distant puis fusionne deux branches', async () => {
    const { opened, file, item, vaultId } = await baseVault()
    const leftDraft = await updateItem(file, opened.session, {
      ...item,
      title: 'GitHub gauche',
    })
    const left = await signVaultFile(leftDraft.file, opened.session, file)
    const right = await addNote(file, opened.session, vaultId, 'Note droite')

    const result = await reconcileVaultFiles({
      local: left,
      session: opened.session,
      remotes: [right],
    })
    expect(result.warnings).toEqual([])
    expect(result.conflicts).toEqual([])
    const signed = await signVaultFile(result.file, result.session, left)
    const reopened = await unlockVaultFile(signed, PASSWORD)
    expect(reopened.items.map((entry) => entry.title).sort()).toEqual([
      'GitHub gauche',
      'Note droite',
    ])
    opened.session.lock()
    reopened.session.lock()
  })

  it('ignore un fichier distant dont le MAC est invalide', async () => {
    const { opened, file } = await baseVault()
    const tampered: VaultFile = {
      ...file,
      items: file.items.map((record) => ({
        ...record,
        clock: { ...record.clock!, rev: (record.clock?.rev ?? 1) + 5 },
      })),
    }

    const result = await reconcileVaultFiles({
      local: file,
      session: opened.session,
      remotes: [tampered],
    })
    expect(result.warnings.join(' ')).toContain('authentifié')
    expect(result.file).toEqual(file)
    opened.session.lock()
  })

  it('exige le nouveau mot de passe puis adopte la nouvelle époque', async () => {
    const { opened, file, vaultId } = await baseVault()
    const localFile = await addNote(file, opened.session, vaultId, 'Note locale')
    const remoteSession = await unlockVaultFile(file, PASSWORD)
    const remoteNote = await addNote(remoteSession.file, remoteSession.session, vaultId, 'Note distante')
    const changed = await changeMasterPassword(
      remoteNote,
      remoteSession.session,
      NEW_PASSWORD,
      FAST_KDF,
    )
    const remote = await signVaultFile(changed, remoteSession.session, remoteNote)
    expect(remote.keyEpoch).toBe(2)

    await expect(
      reconcileVaultFiles({
        local: localFile,
        session: opened.session,
        remotes: [remote],
      }),
    ).rejects.toBeInstanceOf(SyncEpochRequiredError)

    const result = await reconcileVaultFiles({
      local: localFile,
      session: opened.session,
      remotes: [remote],
      password: NEW_PASSWORD,
    })
    expect(result.adoptedEpoch).toBe(2)
    const signed = await signVaultFile(result.file, result.session, localFile)
    expect(signed.keyEpoch).toBe(2)

    await expect(unlockVaultFile(signed, PASSWORD)).rejects.toThrow()
    const reopened = await unlockVaultFile(signed, NEW_PASSWORD)
    expect(reopened.items.map((entry) => entry.title).sort()).toEqual([
      'GitHub',
      'Note distante',
      'Note locale',
    ])
    const login = reopened.items.find((entry) => entry.type === 'login') as LoginItem
    expect(login.password).toBe('s3cret!')
    opened.session.lock()
    result.session.lock()
    reopened.session.lock()
    remoteSession.session.lock()
  })

  it('refuse un mauvais mot de passe de nouvelle époque', async () => {
    const { opened, file } = await baseVault()
    const remoteSession = await unlockVaultFile(file, PASSWORD)
    const changed = await changeMasterPassword(
      remoteSession.file,
      remoteSession.session,
      NEW_PASSWORD,
      FAST_KDF,
    )
    const remote = await signVaultFile(changed, remoteSession.session, remoteSession.file)
    expect(remote.keyEpoch).toBe(2)

    await expect(
      reconcileVaultFiles({
        local: file,
        session: opened.session,
        remotes: [remote],
        password: 'mauvais mot de passe de nouvelle époque',
      }),
    ).rejects.toBeInstanceOf(SyncServiceError)
    opened.session.lock()
    remoteSession.session.lock()
  })

  it('archive le contenu perdant d’un conflit de synchronisation', async () => {
    const { opened, file, item } = await baseVault()
    const leftDraft = await updateItem(file, opened.session, {
      ...item,
      title: 'Conflit gauche',
    })
    const left = await signVaultFile(leftDraft.file, opened.session, file)
    const rightDraft = await updateItem(file, opened.session, {
      ...item,
      title: 'Conflit droite',
    })
    const right = await signVaultFile(rightDraft.file, opened.session, file)

    const result = await reconcileVaultFiles({
      local: left,
      session: opened.session,
      remotes: [right],
    })
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].kind).toBe('item')

    const signed = await signVaultFile(result.file, result.session, left)
    const reopened = await unlockVaultFile(signed, PASSWORD)
    const versions = await listItemVersions(
      reopened.file,
      reopened.session,
      item.id,
    )
    const titles = versions.map((version) => version.content.title)
    expect(
      titles.includes('Conflit gauche') || titles.includes('Conflit droite'),
    ).toBe(true)
    opened.session.lock()
    reopened.session.lock()
  })

  it('ignore un fichier appartenant à un autre coffre', async () => {
    const { opened, file } = await baseVault()
    const other = await createVaultFile(PASSWORD, 'Autre', FAST_KDF)
    const result = await reconcileVaultFiles({
      local: file,
      session: opened.session,
      remotes: [other.file],
    })
    expect(result.file).toEqual(file)
    expect(result.warnings.join(' ')).toContain('autre coffre')
    opened.session.lock()
    other.session.lock()
  })

  it('refuse une rotation de clé de coffre non adoptée', async () => {
    const { opened, file, vaultId } = await baseVault()
    const localSession = await unlockVaultFile(file, PASSWORD)
    const rotatedDraft = await rotateVaultKey(
      file,
      opened.session,
      vaultId,
      randomBytes(32),
    )
    const rotated = await signVaultFile(rotatedDraft, opened.session, file)

    await expect(
      reconcileVaultFiles({
        local: file,
        session: localSession.session,
        remotes: [rotated],
      }),
    ).rejects.toThrow(/clés de coffre diffèrent/i)

    localSession.session.lock()
    opened.session.lock()
  })

  it('rescelle tous les sidecars lors de l’adoption d’une époque', async () => {
    const { opened, file, vaultId } = await baseVault()
    let draft = file

    const template = await createTemplate(draft, opened.session, {
      name: 'Modèle de test',
      fields: [{ id: 'f1', label: 'Champ', type: 'text' }],
    })
    draft = template.file
    draft = (
      await appendActivity(draft, opened.session, {
        kind: 'unlock',
        detail: 'Événement local',
      })
    ).file
    draft = (
      await appendGeneratorHistory(draft, opened.session, {
        password: 'genere-pour-le-test-42',
        domain: 'example.test',
      })
    ).file
    draft = await setAliasKey(
      draft,
      opened.session,
      'simplelogin',
      'cle-api-locale',
    )
    const sharing = await createSharingIdentity(opened.session.masterKey, draft.id)
    const contact = await generateSharingIdentity()
    const emergency = await createEmergencyRecord(
      opened.session.masterKey,
      publicSharingIdentity(contact),
    )
    const prf = {
      version: 1 as const,
      credentialId: 'credential-test',
      salt: 'salt-test',
      createdAt: '2026-01-01T00:00:00.000Z',
      wrap: { n: 'n-prf', c: 'c-prf' },
    }
    draft = {
      ...draft,
      sharing: sharing.record,
      emergency,
      prf,
    }
    const withSidecars = await signVaultFile(draft, opened.session, file)

    const localFile = await addNote(
      withSidecars,
      opened.session,
      vaultId,
      'Note locale',
    )
    const remoteSession = await unlockVaultFile(withSidecars, PASSWORD)
    const changed = await changeMasterPassword(
      withSidecars,
      remoteSession.session,
      NEW_PASSWORD,
      FAST_KDF,
    )
    const remote = await signVaultFile(
      changed,
      remoteSession.session,
      withSidecars,
    )

    const result = await reconcileVaultFiles({
      local: localFile,
      session: opened.session,
      remotes: [remote],
      password: NEW_PASSWORD,
    })
    expect(result.adoptedEpoch).toBe(2)
    const signed = await signVaultFile(result.file, result.session, localFile)
    const reopened = await unlockVaultFile(signed, NEW_PASSWORD)

    expect(reopened.templates.map((entry) => entry.name)).toContain(
      'Modèle de test',
    )
    expect(reopened.activity.some((entry) => entry.detail === 'Événement local')).toBe(
      true,
    )
    expect(
      reopened.generatorHistory.some(
        (entry) => entry.password === 'genere-pour-le-test-42',
      ),
    ).toBe(true)
    expect(reopened.aliasKeys.simplelogin).toBe('cle-api-locale')
    expect(reopened.sharing?.fingerprint).toBe(sharing.identity.fingerprint)
    expect(reopened.file.emergency).toBeDefined()
    expect(reopened.file.prf).toBeUndefined()

    opened.session.lock()
    remoteSession.session.lock()
    result.session.lock()
    reopened.session.lock()
  })
})
