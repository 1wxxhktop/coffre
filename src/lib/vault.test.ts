import { describe, expect, it } from 'vitest'
import {
  addAttachment,
  addVault,
  changeMasterPassword,
  createItem,
  createVaultFile,
  deleteItem,
  deleteItems,
  deleteVault,
  enableRecovery,
  listItemVersions,
  openAttachment,
  openVaultFileWithMasterKey,
  parseVaultFile,
  parseVaultFileText,
  removeAttachment,
  restoreItem,
  restoreItemVersion,
  serializeVault,
  trashItem,
  unlockVaultFile,
  updateItem,
  verifyVaultFile,
  VaultIntegrityError,
  VaultLockedError,
  VaultValidationError,
  WrongPasswordError,
} from './vault'
import { deriveMasterKey, wipe } from './crypto'
import {
  emptyDraft,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  MAX_ITEM_VERSIONS,
  type ItemDraft,
  type LoginItem,
  type VaultFile,
} from './types'

const PASSWORD = 'phrase de passe de test solide'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

async function freshVault() {
  return createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
}

async function addLogin(
  opened: Awaited<ReturnType<typeof createVaultFile>>,
  overrides: Partial<LoginItem> = {},
) {
  const vaultId = opened.vaults[0].id
  return createItem(opened.file, opened.session, {
    ...emptyDraft('login', vaultId),
    title: 'GitHub',
    username: 'studio26',
    password: 's3cret!',
    urls: ['https://github.com'],
    notes: 'Compte principal',
    tags: ['dev'],
    favorite: true,
    ...overrides,
    type: 'login',
    totp: overrides.totp ?? '',
  } as ItemDraft)
}

describe('création et déverrouillage', () => {
  it('crée un coffre avec un coffre par défaut', async () => {
    const opened = await freshVault()
    expect(opened.file.format).toBe('coffre')
    expect(opened.file.version).toBe(3)
    expect(opened.file.vaults).toHaveLength(1)
    expect(opened.file.versions).toEqual([])
    expect(opened.vaults[0].name).toBe('Personnel')
    expect(opened.items).toHaveLength(0)
    expect(opened.session.locked).toBe(false)
    opened.session.lock()
    expect(opened.session.locked).toBe(true)
  })

  it('déchiffre les éléments avec le bon mot de passe', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const unlocked = await unlockVaultFile(file, PASSWORD)
    expect(unlocked.items).toHaveLength(1)
    expect(unlocked.items[0]).toMatchObject({
      id: item.id,
      title: 'GitHub',
      username: 'studio26',
      password: 's3cret!',
      favorite: true,
    })
    unlocked.session.lock()
  })

  it('conserve la clé de session après effacement du tampon d’entrée', async () => {
    const created = await freshVault()
    const input = await deriveMasterKey(PASSWORD, created.file.kdf)
    const opened = await openVaultFileWithMasterKey(created.file, input)
    wipe(input)

    expect(opened.session.masterKey.some((byte) => byte !== 0)).toBe(true)
    const added = await addVault(opened.file, opened.session, 'Travail')
    const reopened = await unlockVaultFile(added.file, PASSWORD)
    expect(reopened.vaults).toHaveLength(2)

    opened.session.lock()
    reopened.session.lock()
  })

  it('rejette des paramètres KDF hors limites', async () => {
    const opened = await freshVault()
    const bad = {
      ...opened.file,
      kdf: { ...opened.file.kdf, memoryKiB: 1_048_576 },
    }
    expect(() => parseVaultFile(bad)).toThrow(VaultValidationError)
  })

  it('rejette un mauvais mot de passe', async () => {
    const opened = await freshVault()
    await expect(unlockVaultFile(opened.file, 'mauvais mot de passe')).rejects.toBeInstanceOf(
      WrongPasswordError,
    )
  })

  it('rejette une clé de coffre altérée', async () => {
    const opened = await freshVault()
    const tampered: VaultFile = {
      ...opened.file,
      vaults: [{ ...opened.file.vaults[0], key: { n: 'AAAAAAAAAAAAAAAA', c: 'AAAA' } }],
    }
    await expect(unlockVaultFile(tampered, PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError)
  })

  it('ignore un élément corrompu et le signale', async () => {
    const opened = await freshVault()
    const { file } = await addLogin(opened)
    const tampered: VaultFile = {
      ...file,
      items: [{ ...file.items[0], content: { ...file.items[0].content, c: 'AAAA' } }],
    }
    const unlocked = await unlockVaultFile(tampered, PASSWORD)
    expect(unlocked.items).toHaveLength(0)
    expect(unlocked.warnings.length).toBeGreaterThan(0)
    unlocked.session.lock()
  })
})

describe('éléments', () => {
  it('crée, met à jour et supprime un élément', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)

    const updated = await updateItem(file, opened.session, {
      ...(item as LoginItem),
      title: 'GitHub Enterprise',
      password: 'nouveau-secret',
    })
    expect(updated.item.title).toBe('GitHub Enterprise')

    const reopened = await unlockVaultFile(updated.file, PASSWORD)
    expect((reopened.items[0] as LoginItem).password).toBe('nouveau-secret')

    const afterDelete = await deleteItem(updated.file, item.id)
    expect(afterDelete.items).toHaveLength(0)
  })

  it('ne crée pas de version pour un simple changement de favori', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const updated = await updateItem(file, opened.session, {
      ...(item as LoginItem),
      favorite: !item.favorite,
    })
    expect(updated.file.versions).toHaveLength(0)
  })

  it('refuse un titre vide', async () => {
    const opened = await freshVault()
    await expect(addLogin(opened, { title: '   ' })).rejects.toBeInstanceOf(
      VaultValidationError,
    )
  })

  it('refuse un coffre inconnu', async () => {
    const opened = await freshVault()
    await expect(
      createItem(opened.file, opened.session, {
        ...emptyDraft('login', 'v_inconnu'),
        title: 'Test',
      }),
    ).rejects.toBeInstanceOf(VaultValidationError)
  })
})

describe('coffres', () => {
  it('ajoute, renomme et supprime un coffre', async () => {
    const opened = await freshVault()
    const added = await addVault(opened.file, opened.session, 'Travail')
    expect(added.file.vaults).toHaveLength(2)

    const withItem = await createItem(added.file, opened.session, {
      ...emptyDraft('note', added.vault.id),
      title: 'Note interne',
      notes: 'Contenu',
    })

    const unlocked = await unlockVaultFile(withItem.file, PASSWORD)
    expect(unlocked.vaults.map((vault) => vault.name)).toEqual(['Personnel', 'Travail'])
    expect(unlocked.items).toHaveLength(1)

    const afterDelete = await deleteVault(withItem.file, opened.session, added.vault.id)
    expect(afterDelete.vaults).toHaveLength(1)
    expect(afterDelete.items).toHaveLength(0)
    unlocked.session.lock()
  })

  it('détecte une enveloppe de récupération corrompue', async () => {
    const opened = await freshVault()
    const phrase = 'abacus abdomen abdominal abide abiding ability abject ablaze abode abort'
    const withRecovery = await enableRecovery(
      opened.file,
      opened.session,
      phrase,
      FAST_KDF,
    )
    const corrupted = {
      ...withRecovery,
      recovery: {
        ...withRecovery.recovery!,
        guard: { ...withRecovery.recovery!.guard, c: 'AAAA' },
      },
    }
    const reopened = await unlockVaultFile(corrupted, PASSWORD)
    await expect(
      verifyVaultFile(corrupted, reopened.session),
    ).rejects.toBeInstanceOf(VaultIntegrityError)
    reopened.session.lock()
    opened.session.lock()
  })

  it('refuse de supprimer le dernier coffre', async () => {
    const opened = await freshVault()
    await expect(
      deleteVault(opened.file, opened.session, opened.file.vaults[0].id),
    ).rejects.toBeInstanceOf(VaultValidationError)
  })

  it('invalide la session après verrouillage', async () => {
    const opened = await freshVault()
    opened.session.lock()
    expect(() => opened.session.vaultKey(opened.vaults[0].id)).toThrow(VaultLockedError)
  })
})

describe('changement de mot de passe maître', () => {
  it('ré-enveloppe les clés sans réchiffrer les éléments', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const updated = await changeMasterPassword(
      file,
      opened.session,
      'nouvelle phrase de passe',
      FAST_KDF,
    )

    await expect(unlockVaultFile(updated, PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError)

    const reopened = await unlockVaultFile(updated, 'nouvelle phrase de passe')
    expect(reopened.items[0].id).toBe(item.id)
    expect((reopened.items[0] as LoginItem).password).toBe('s3cret!')
    reopened.session.lock()
  })
})

describe('format de fichier', () => {
  it('sérialise et relit un coffre', async () => {
    const opened = await freshVault()
    const { file } = await addLogin(opened)
    const parsed = parseVaultFileText(serializeVault(file))
    expect(parsed.id).toBe(file.id)
    expect(parsed.items).toHaveLength(1)
  })

  it('refuse un JSON invalide', () => {
    expect(() => parseVaultFileText('{')).toThrow(VaultValidationError)
  })

  it('refuse une version inconnue', async () => {
    const opened = await freshVault()
    expect(() => parseVaultFile({ ...opened.file, version: 4 })).toThrow(VaultValidationError)
  })

  it('accepte un fichier v1 et le migre en v3', async () => {
    const opened = await freshVault()
    const { file } = await addLogin(opened)
    const legacy = { ...file, version: 1 } as Record<string, unknown>
    delete legacy.versions

    const parsed = parseVaultFile(legacy)
    expect(parsed.version).toBe(3)
    expect(parsed.versions).toEqual([])

    const unlocked = await unlockVaultFile(parsed, PASSWORD)
    expect(unlocked.items).toHaveLength(1)
    unlocked.session.lock()
  })

  it('refuse une version rattachée à un élément inconnu', async () => {
    const opened = await freshVault()
    const { file } = await addLogin(opened)
    expect(() =>
      parseVaultFile({
        ...file,
        versions: [
          {
            id: 'iv_orpheline',
            itemId: 'it_inconnu',
            vaultId: file.vaults[0].id,
            content: file.items[0].content,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ).toThrow(VaultValidationError)
  })

  it('refuse un élément orphelin', async () => {
    const opened = await freshVault()
    const { file } = await addLogin(opened)
    expect(() =>
      parseVaultFile({
        ...file,
        items: [{ ...file.items[0], vaultId: 'v_inconnu' }],
      }),
    ).toThrow(VaultValidationError)
  })

  it('refuse des paramètres KDF dangereux', async () => {
    const opened = await freshVault()
    expect(() =>
      parseVaultFile({ ...opened.file, kdf: { ...opened.file.kdf, memoryKiB: 4 } }),
    ).toThrow(VaultValidationError)
  })

  it('accepte un ancien fichier sans pièces jointes', async () => {
    const opened = await freshVault()
    const legacy = { ...opened.file } as Record<string, unknown>
    delete legacy.attachments
    expect(parseVaultFile(legacy).attachments).toEqual([])
  })
})

describe('champs personnalisés', () => {
  it('chiffre et relit les champs libres', async () => {
    const opened = await freshVault()
    const vaultId = opened.vaults[0].id
    const created = await createItem(opened.file, opened.session, {
      ...emptyDraft('login', vaultId),
      title: 'API interne',
      customFields: [
        { id: 'f_api', label: 'Clé API', value: 'abc-123', type: 'hidden' },
        {
          id: 'f_doc',
          label: 'Documentation',
          value: 'https://example.com/docs',
          type: 'url',
        },
      ],
    } as ItemDraft)

    const unlocked = await unlockVaultFile(created.file, PASSWORD)
    expect(unlocked.items[0].customFields).toEqual([
      { id: 'f_api', label: 'Clé API', value: 'abc-123', type: 'hidden' },
      {
        id: 'f_doc',
        label: 'Documentation',
        value: 'https://example.com/docs',
        type: 'url',
      },
    ])
    unlocked.session.lock()
  })
})

describe('pièces jointes', () => {
  it('chiffre, relit et supprime une pièce jointe', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const bytes = new TextEncoder().encode('contenu secret')

    const added = await addAttachment(file, opened.session, item, {
      name: 'note.txt',
      mime: 'text/plain',
      bytes,
    })
    expect(added.item.attachments).toHaveLength(1)
    expect(added.file.attachments).toHaveLength(1)

    const meta = added.item.attachments[0]
    const unlocked = await unlockVaultFile(added.file, PASSWORD)
    expect(unlocked.items[0].attachments[0]).toMatchObject({
      id: meta.id,
      name: 'note.txt',
      mime: 'text/plain',
      size: bytes.length,
    })

    const read = await openAttachment(
      unlocked.file,
      unlocked.session,
      unlocked.items[0],
      meta.id,
    )
    expect(new TextDecoder().decode(read.bytes)).toBe('contenu secret')
    read.bytes.fill(0)

    const removed = await removeAttachment(
      unlocked.file,
      unlocked.session,
      unlocked.items[0],
      meta.id,
    )
    expect(removed.item.attachments).toHaveLength(0)
    expect(removed.file.attachments).toHaveLength(0)
    unlocked.session.lock()
  })

  it('supprime les pièces jointes avec leur élément', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const added = await addAttachment(file, opened.session, item, {
      name: 'secret.bin',
      mime: 'application/octet-stream',
      bytes: new Uint8Array([1, 2, 3]),
    })
    const afterDelete = await deleteItem(added.file, item.id)
    expect(afterDelete.items).toHaveLength(0)
    expect(afterDelete.attachments).toHaveLength(0)
  })

  it('refuse un fichier trop volumineux', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    await expect(
      addAttachment(file, opened.session, item, {
        name: 'gros.bin',
        mime: 'application/octet-stream',
        bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1),
      }),
    ).rejects.toBeInstanceOf(VaultValidationError)
  })

  it('limite le nombre de pièces jointes par élément', async () => {
    const opened = await freshVault()
    let { file, item } = await addLogin(opened)

    for (let index = 0; index < MAX_ATTACHMENTS_PER_ITEM; index += 1) {
      const added = await addAttachment(file, opened.session, item, {
        name: `fichier-${index}.txt`,
        mime: 'text/plain',
        bytes: new Uint8Array([index]),
      })
      file = added.file
      item = added.item
    }

    await expect(
      addAttachment(file, opened.session, item, {
        name: 'trop.txt',
        mime: 'text/plain',
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toBeInstanceOf(VaultValidationError)
  })

  it('rejette une pièce jointe altérée', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const added = await addAttachment(file, opened.session, item, {
      name: 'note.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode('secret'),
    })
    const attachment = added.file.attachments[0]
    const tampered: VaultFile = {
      ...added.file,
      attachments: [
        {
          ...attachment,
          data: { ...attachment.data, c: 'AAAA' },
        },
      ],
    }
    const unlocked = await unlockVaultFile(tampered, PASSWORD)
    await expect(
      openAttachment(
        tampered,
        unlocked.session,
        unlocked.items[0],
        added.item.attachments[0].id,
      ),
    ).rejects.toThrow()
    unlocked.session.lock()
  })

  it('refuse une pièce jointe orpheline', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const added = await addAttachment(file, opened.session, item, {
      name: 'note.txt',
      mime: 'text/plain',
      bytes: new Uint8Array([1]),
    })
    expect(() =>
      parseVaultFile({
        ...added.file,
        attachments: [{ ...added.file.attachments[0], itemId: 'i_inconnu' }],
      }),
    ).toThrow(VaultValidationError)
  })

  it('conserve les pièces jointes après un changement de mot de passe', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const added = await addAttachment(file, opened.session, item, {
      name: 'note.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode('toujours là'),
    })
    const changed = await changeMasterPassword(
      added.file,
      opened.session,
      'nouvelle phrase de passe',
      FAST_KDF,
    )
    const unlocked = await unlockVaultFile(changed, 'nouvelle phrase de passe')
    const read = await openAttachment(
      unlocked.file,
      unlocked.session,
      unlocked.items[0],
      added.item.attachments[0].id,
    )
    expect(new TextDecoder().decode(read.bytes)).toBe('toujours là')
    read.bytes.fill(0)
    unlocked.session.lock()
  })
})

describe('vérification d’intégrité', () => {
  it('valide un coffre sain et compte les entrées', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const bytes = new TextEncoder().encode('contenu vérifié')
    const added = await addAttachment(file, opened.session, item, {
      name: 'note.txt',
      mime: 'text/plain',
      bytes,
    })

    const report = await verifyVaultFile(added.file, opened.session)
    expect(report).toEqual({
      vaults: 1,
      items: 1,
      attachments: 1,
      attachmentBytes: bytes.length,
      versions: 0,
    })
  })

  it('détecte un contenu d’élément altéré', async () => {
    const opened = await freshVault()
    const { file } = await addLogin(opened)
    const tampered: VaultFile = {
      ...file,
      items: [{ ...file.items[0], content: { ...file.items[0].content, c: 'AAAA' } }],
    }

    await expect(verifyVaultFile(tampered, opened.session)).rejects.toBeInstanceOf(
      VaultIntegrityError,
    )
  })

  it('détecte une pièce jointe altérée', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const added = await addAttachment(file, opened.session, item, {
      name: 'note.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode('secret'),
    })
    const attachment = added.file.attachments[0]
    const tampered: VaultFile = {
      ...added.file,
      attachments: [{ ...attachment, data: { ...attachment.data, c: 'AAAA' } }],
    }

    await expect(verifyVaultFile(tampered, opened.session)).rejects.toBeInstanceOf(
      VaultIntegrityError,
    )
  })

  it('détecte une pièce jointe orpheline', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const added = await addAttachment(file, opened.session, item, {
      name: 'note.txt',
      mime: 'text/plain',
      bytes: new Uint8Array([1, 2, 3]),
    })
    const orphaned: VaultFile = {
      ...added.file,
      attachments: [
        ...added.file.attachments,
        { ...added.file.attachments[0], id: 'a_orpheline' },
      ],
    }

    await expect(verifyVaultFile(orphaned, opened.session)).rejects.toBeInstanceOf(
      VaultIntegrityError,
    )
  })

  it('refuse de vérifier un coffre verrouillé', async () => {
    const opened = await freshVault()
    const { file } = await addLogin(opened)
    opened.session.lock()

    await expect(verifyVaultFile(file, opened.session)).rejects.toBeInstanceOf(
      VaultLockedError,
    )
  })
})

describe('corbeille', () => {
  it('déplace un élément en corbeille et le restaure', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)

    const trashed = await trashItem(file, opened.session, item.id)
    expect(trashed.item.deletedAt).not.toBeNull()
    expect(trashed.item.title).toBe('GitHub')

    const reopened = await unlockVaultFile(trashed.file, PASSWORD)
    expect(reopened.items[0].deletedAt).not.toBeNull()
    expect(opened.vaults[0].itemCount).toBe(0)

    const restored = await restoreItem(trashed.file, opened.session, item.id)
    expect(restored.item.deletedAt).toBeNull()

    const unlocked = await unlockVaultFile(restored.file, PASSWORD)
    expect(unlocked.items[0].deletedAt).toBeNull()
    unlocked.session.lock()
    reopened.session.lock()
  })

  it('conserve la date de corbeille lors d’une modification', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const trashed = await trashItem(file, opened.session, item.id)

    const updated = await updateItem(trashed.file, opened.session, {
      ...trashed.item,
      title: 'GitHub renommé',
    })
    expect(updated.item.title).toBe('GitHub renommé')
    expect(updated.item.deletedAt).toBe(trashed.item.deletedAt)
  })

  it('n’archive pas le passage en corbeille dans l’historique', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const trashed = await trashItem(file, opened.session, item.id)
    expect(trashed.file.versions).toHaveLength(0)
  })

  it('supprime définitivement les versions quand l’élément disparaît', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const updated = await updateItem(file, opened.session, {
      ...(item as LoginItem),
      password: 'second-secret',
    })
    expect(updated.file.versions).toHaveLength(1)

    const purged = await deleteItem(updated.file, item.id)
    expect(purged.items).toHaveLength(0)
    expect(purged.versions).toHaveLength(0)
  })

  it('vide plusieurs éléments en une seule opération', async () => {
    const opened = await freshVault()
    const first = await addLogin(opened)
    const second = await addLogin({ ...opened, file: first.file }, { title: 'GitLab' })
    const trashedFirst = await trashItem(second.file, opened.session, first.item.id)
    const trashed = await trashItem(
      trashedFirst.file,
      opened.session,
      second.item.id,
    )

    const purged = deleteItems(trashed.file, [first.item.id, second.item.id])
    expect(purged.items).toHaveLength(0)
  })
})

describe('historique des versions', () => {
  it('archive le contenu précédent à chaque modification réelle', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)

    const first = await updateItem(file, opened.session, {
      ...(item as LoginItem),
      password: 'secret-2',
    })
    const second = await updateItem(first.file, opened.session, {
      ...(first.item as LoginItem),
      password: 'secret-3',
    })
    expect(second.file.versions).toHaveLength(2)

    const versions = await listItemVersions(second.file, opened.session, item.id)
    expect(versions).toHaveLength(2)
    expect((versions[0].content as LoginItem).password).toBe('secret-2')
    expect((versions[1].content as LoginItem).password).toBe('s3cret!')
  })

  it('ne crée pas de version si le contenu est identique', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)

    const same = await updateItem(file, opened.session, { ...(item as LoginItem) })
    expect(same.file.versions).toHaveLength(0)
  })

  it('restaure une version en archivant d’abord le contenu courant', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const updated = await updateItem(file, opened.session, {
      ...(item as LoginItem),
      password: 'secret-2',
    })

    const versions = await listItemVersions(updated.file, opened.session, item.id)
    const restored = await restoreItemVersion(
      updated.file,
      opened.session,
      item.id,
      versions[0].id,
    )
    expect((restored.item as LoginItem).password).toBe('s3cret!')

    const after = await listItemVersions(restored.file, opened.session, item.id)
    expect(after).toHaveLength(2)
    expect((after[0].content as LoginItem).password).toBe('secret-2')
  })

  it('refuse une version appartenant à un autre élément', async () => {
    const opened = await freshVault()
    const first = await addLogin(opened)
    const updated = await updateItem(first.file, opened.session, {
      ...(first.item as LoginItem),
      password: 'secret-2',
    })
    const second = await addLogin({ ...opened, file: updated.file }, { title: 'GitLab' })
    const versions = await listItemVersions(second.file, opened.session, first.item.id)

    await expect(
      restoreItemVersion(second.file, opened.session, second.item.id, versions[0].id),
    ).rejects.toBeInstanceOf(VaultValidationError)
  })

  it('plafonne l’historique par élément', async () => {
    const opened = await freshVault()
    let current = await addLogin(opened)

    for (let index = 0; index < MAX_ITEM_VERSIONS + 4; index++) {
      current = await updateItem(current.file, opened.session, {
        ...(current.item as LoginItem),
        password: `secret-${index}`,
      })
    }

    expect(current.file.versions).toHaveLength(MAX_ITEM_VERSIONS)
    const versions = await listItemVersions(current.file, opened.session, current.item.id)
    expect(versions).toHaveLength(MAX_ITEM_VERSIONS)
  })

  it('vérifie les versions et signale une version altérée', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const updated = await updateItem(file, opened.session, {
      ...(item as LoginItem),
      password: 'secret-2',
    })

    const report = await verifyVaultFile(updated.file, opened.session)
    expect(report.versions).toBe(1)

    const tampered: VaultFile = {
      ...updated.file,
      versions: [
        {
          ...updated.file.versions[0],
          content: { ...updated.file.versions[0].content, c: 'AAAA' },
        },
      ],
    }
    await expect(verifyVaultFile(tampered, opened.session)).rejects.toBeInstanceOf(
      VaultIntegrityError,
    )
  })

  it('détecte une version orpheline', async () => {
    const opened = await freshVault()
    const { file, item } = await addLogin(opened)
    const updated = await updateItem(file, opened.session, {
      ...(item as LoginItem),
      password: 'secret-2',
    })
    const orphaned: VaultFile = {
      ...updated.file,
      versions: [
        ...updated.file.versions,
        { ...updated.file.versions[0], id: 'iv_orpheline' },
      ],
    }

    await expect(verifyVaultFile(orphaned, opened.session)).rejects.toBeInstanceOf(
      VaultIntegrityError,
    )
  })
})
