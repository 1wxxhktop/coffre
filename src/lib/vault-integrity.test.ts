import { describe, expect, it } from 'vitest'
import {
  appendGeneratorHistory,
  canonicalJson,
  changeMasterPassword,
  checkVaultRollback,
  computeManifest,
  createItem,
  createVaultFile,
  deleteItems,
  listItemVersions,
  parseVaultFileText,
  preserveConflictVersion,
  renameVault,
  serializeVault,
  signVaultFile,
  unlockVaultFile,
  updateItem,
  verifyVaultFile,
  VaultIntegrityError,
  type OpenedVault,
} from './vault'
import { emptyDraft, type ItemDraft, type LoginItem, type VaultFile } from './types'

const PASSWORD = 'phrase de passe de test solide'
const NEW_PASSWORD = 'nouvelle phrase de passe solide'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

async function freshVault(): Promise<OpenedVault> {
  return createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
}

async function addLogin(opened: OpenedVault, title = 'GitHub') {
  return createItem(opened.file, opened.session, {
    ...emptyDraft('login', opened.vaults[0].id),
    title,
    username: 'studio26',
    password: 's3cret!',
    urls: ['https://github.com'],
    type: 'login',
    totp: '',
  } as ItemDraft)
}

describe('format 4 : intégrité globale', () => {
  it('signe un coffre neuf et le rouvre avec un MAC valide', async () => {
    const opened = await freshVault()
    expect(opened.file.version).toBe(4)
    expect(opened.file.revision).toBe(1)
    expect(opened.file.keyEpoch).toBe(1)
    expect(opened.file.integrity?.mac).toBeTruthy()
    expect(opened.file.vaults[0].clock?.rev).toBe(1)

    const reopened = await unlockVaultFile(opened.file, PASSWORD)
    expect(reopened.readOnly).toBe(false)
    expect(reopened.integrity).toBe('valid')
    expect(reopened.warnings).toEqual([])

    const report = await verifyVaultFile(reopened.file, reopened.session)
    expect(report.signedRecords).toBe(2)

    opened.session.lock()
    reopened.session.lock()
  })

  it('incrémente la révision et l’horloge de l’enregistrement modifié', async () => {
    const opened = await freshVault()
    const created = await addLogin(opened)
    const signed = await signVaultFile(created.file, opened.session, opened.file)

    expect(signed.revision).toBe(2)
    expect(signed.items[0].clock).toMatchObject({ rev: 2 })
    expect(signed.items[0].clock?.writer).toBeTruthy()

    const report = await verifyVaultFile(signed, opened.session)
    expect(report.signedRecords).toBe(4)
    opened.session.lock()
  })

  it('couvre l’historique du générateur dans le manifeste 2', async () => {
    const opened = await freshVault()
    const generated = await appendGeneratorHistory(opened.file, opened.session, {
      password: 'secret-généré-42!',
      domain: 'github.com',
    })
    const signed = await signVaultFile(generated.file, opened.session, opened.file)

    const v1 = await computeManifest(signed, 1)
    const v2 = await computeManifest(signed, 2)
    expect(v1.records.some((record) => record.type === 'generator-history')).toBe(false)
    expect(v2.records.some((record) => record.type === 'generator-history')).toBe(true)

    const reopened = await unlockVaultFile(signed, PASSWORD)
    expect(reopened.integrity).toBe('valid')
    reopened.session.lock()

    const tampered = {
      ...signed,
      generatorHistory: signed.generatorHistory?.map((entry) => ({
        ...entry,
        data: { ...entry.data, c: 'AAAA' },
      })),
    }
    const invalid = await unlockVaultFile(tampered, PASSWORD)
    expect(invalid.integrity).toBe('invalid')
    expect(invalid.readOnly).toBe(true)
    invalid.session.lock()
    opened.session.lock()
  })

  it('produit un manifeste canonique indépendant de l’ordre des tableaux', async () => {
    const opened = await freshVault()
    const first = await addLogin(opened, 'GitHub')
    const second = await addLogin(
      { ...opened, file: first.file },
      'GitLab',
    )
    const signed = await signVaultFile(second.file, opened.session, opened.file)

    const reordered: VaultFile = {
      ...signed,
      items: [...signed.items].reverse(),
      vaults: [...signed.vaults].reverse(),
      tombstones: [...(signed.tombstones ?? [])].reverse(),
    }

    const left = canonicalJson(await computeManifest(signed))
    const right = canonicalJson(await computeManifest(reordered))
    expect(right).toBe(left)

    const reopened = await unlockVaultFile(reordered, PASSWORD)
    expect(reopened.integrity).toBe('valid')
    expect(reopened.items.map((item) => item.title).sort()).toEqual([
      'GitHub',
      'GitLab',
    ])
    opened.session.lock()
    reopened.session.lock()
  })

  it('couvre le nom du coffre et incrémente son horloge au renommage', async () => {
    const opened = await freshVault()
    const renamed = await renameVault(
      opened.file,
      opened.session,
      opened.vaults[0].id,
      'Travail',
    )
    const signed = await signVaultFile(renamed, opened.session, opened.file)
    expect(signed.vaults[0].clock?.rev).toBeGreaterThan(
      opened.file.vaults[0].clock!.rev,
    )

    // Même en conservant l’ancien nom authentique et le nouveau MAC, le
    // manifeste couvre le ciphertext du nom : la substitution est détectée.
    const replayed: VaultFile = {
      ...signed,
      vaults: [
        {
          ...signed.vaults[0],
          name: opened.file.vaults[0].name,
        },
      ],
    }
    const reopened = await unlockVaultFile(replayed, PASSWORD)
    expect(reopened.integrity).toBe('invalid')
    opened.session.lock()
    reopened.session.lock()
  })

  it('détecte un enregistrement supprimé malgré un fichier déchiffrable', async () => {
    const opened = await freshVault()
    const first = await addLogin(opened, 'GitHub')
    const second = await addLogin({ ...opened, file: first.file }, 'GitLab')
    const signed = await signVaultFile(second.file, opened.session, opened.file)

    const truncated: VaultFile = {
      ...signed,
      items: signed.items.filter((item) => item.id !== first.item.id),
    }

    const reopened = await unlockVaultFile(truncated, PASSWORD)
    expect(reopened.integrity).toBe('invalid')
    expect(reopened.readOnly).toBe(true)
    expect(reopened.warnings.join(' ')).toContain('MAC global invalide')

    await expect(verifyVaultFile(truncated, reopened.session)).rejects.toBeInstanceOf(
      VaultIntegrityError,
    )
    opened.session.lock()
    reopened.session.lock()
  })

  it('détecte le rejeu d’une ancienne version authentique d’un élément', async () => {
    const opened = await freshVault()
    const first = await addLogin(opened)
    const signedFirst = await signVaultFile(first.file, opened.session, opened.file)

    const updated = await createItem(signedFirst, opened.session, {
      ...(first.item as LoginItem),
      password: 'nouveau-secret',
    })
    const signedSecond = await signVaultFile(updated.file, opened.session, signedFirst)

    const replayed: VaultFile = {
      ...signedSecond,
      items: [
        {
          ...signedSecond.items[0],
          content: signedFirst.items[0].content,
        },
      ],
    }

    const reopened = await unlockVaultFile(replayed, PASSWORD)
    expect(reopened.integrity).toBe('invalid')
    expect(reopened.readOnly).toBe(true)

    // Sans MAC, le ciphertext ancien resterait parfaitement déchiffrable.
    expect((reopened.items[0] as LoginItem).password).toBe('s3cret!')
    opened.session.lock()
    reopened.session.lock()
  })

  it('détecte la substitution du contenu entre deux éléments', async () => {
    const opened = await freshVault()
    const first = await addLogin(opened, 'GitHub')
    const second = await addLogin({ ...opened, file: first.file }, 'GitLab')
    const signed = await signVaultFile(second.file, opened.session, opened.file)

    const swapped: VaultFile = {
      ...signed,
      items: signed.items.map((item, index) => ({
        ...item,
        content: signed.items[(index + 1) % signed.items.length].content,
      })),
    }

    const reopened = await unlockVaultFile(swapped, PASSWORD)
    expect(reopened.integrity).toBe('invalid')
    expect(reopened.readOnly).toBe(true)
    opened.session.lock()
    reopened.session.lock()
  })

  it('refuse un fichier v4 dont la signature a été retirée', async () => {
    const opened = await freshVault()
    const unsigned: VaultFile = { ...opened.file }
    delete unsigned.integrity

    const reopened = await unlockVaultFile(unsigned, PASSWORD)
    expect(reopened.integrity).toBe('invalid')
    expect(reopened.readOnly).toBe(true)
    expect(reopened.warnings.join(' ')).toContain('signature')
    opened.session.lock()
    reopened.session.lock()
  })

  it('refuse un fichier v4 dégradé en v3 pour contourner le MAC', async () => {
    const opened = await freshVault()
    expect(() =>
      parseVaultFileText(JSON.stringify({ ...opened.file, version: 3 })),
    ).toThrow(/format 4/)
    opened.session.lock()
  })

  it('migre un fichier v3 en v4 à la première écriture signée', async () => {
    const opened = await freshVault()
    const legacy = { ...opened.file, version: 3 } as VaultFile
    delete legacy.writer
    delete legacy.revision
    delete legacy.keyEpoch
    delete legacy.tombstones
    delete legacy.integrity
    legacy.vaults = legacy.vaults.map((vault) => {
      const copy = { ...vault }
      delete copy.clock
      return copy
    })

    const parsed = parseVaultFileText(serializeVault(legacy))
    expect(parsed.version).toBe(3)

    const unlocked = await unlockVaultFile(parsed, PASSWORD)
    expect(unlocked.integrity).toBe('unsigned')
    expect(unlocked.readOnly).toBe(false)

    const created = await addLogin(unlocked)
    const signed = await signVaultFile(created.file, unlocked.session, unlocked.file)
    expect(signed.version).toBe(4)
    expect(signed.revision).toBe(1)
    expect(signed.keyEpoch).toBe(1)
    expect(signed.integrity?.mac).toBeTruthy()

    const reopened = await unlockVaultFile(signed, PASSWORD)
    expect(reopened.integrity).toBe('valid')
    opened.session.lock()
    unlocked.session.lock()
    reopened.session.lock()
  })
})

describe('format 4 : pierres tombales et époques', () => {
  it('conserve une pierre tombale à la suppression définitive', async () => {
    const opened = await freshVault()
    const first = await addLogin(opened)
    const second = await addLogin({ ...opened, file: first.file }, 'GitLab')
    const signed = await signVaultFile(second.file, opened.session, opened.file)

    const afterDelete = deleteItems(signed, [first.item.id])
    const signedDelete = await signVaultFile(afterDelete, opened.session, signed)

    expect(signedDelete.tombstones).toContainEqual(
      expect.objectContaining({ kind: 'item', id: first.item.id }),
    )
    const reopened = await unlockVaultFile(signedDelete, PASSWORD)
    expect(reopened.items).toHaveLength(1)
    expect(reopened.integrity).toBe('valid')

    opened.session.lock()
    reopened.session.lock()
  })

  it('purge les pierres tombales de plus de 180 jours', async () => {
    const opened = await freshVault()
    const ancient = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000).toISOString()
    const withAncient: VaultFile = {
      ...opened.file,
      tombstones: [{ kind: 'item', id: 'i_ancien', deletedAt: ancient }],
    }

    const signed = await signVaultFile(withAncient, opened.session, opened.file)
    expect(signed.tombstones?.some((entry) => entry.id === 'i_ancien')).toBe(false)
    opened.session.lock()
  })

  it('fait tourner la clé d’intégrité et incrémente keyEpoch au changement de mot de passe', async () => {
    const opened = await freshVault()
    const created = await addLogin(opened)
    const signed = await signVaultFile(created.file, opened.session, opened.file)
    const previousKey = signed.integrity?.key.c

    const draft = await changeMasterPassword(
      signed,
      opened.session,
      NEW_PASSWORD,
      FAST_KDF,
    )
    expect(draft.keyEpoch).toBe(2)
    const rotated = await signVaultFile(draft, opened.session, signed)
    expect(rotated.keyEpoch).toBe(2)
    expect(rotated.integrity?.key.c).not.toBe(previousKey)
    expect(rotated.revision).toBe(signed.revision! + 1)

    await expect(unlockVaultFile(rotated, PASSWORD)).rejects.toThrow()
    const reopened = await unlockVaultFile(rotated, NEW_PASSWORD)
    expect(reopened.integrity).toBe('valid')
    expect(reopened.items).toHaveLength(1)

    opened.session.lock()
    reopened.session.lock()
  })

  it('accepte une pierre tombale antérieure à un élément ressuscité', async () => {
    const opened = await freshVault()
    const created = await addLogin(opened)
    const signed = await signVaultFile(created.file, opened.session, opened.file)
    const resurrected: VaultFile = {
      ...signed,
      tombstones: [
        {
          kind: 'item',
          id: created.item.id,
          deletedAt: new Date(
            Date.parse(created.item.updatedAt) - 1_000,
          ).toISOString(),
        },
      ],
    }

    // Le validateur accepte la coexistence : la pierre tombale est plus
    // ancienne que l’enregistrement, qui a donc été ressuscité par une écriture
    // concurrente ou une restauration.
    expect(() => parseVaultFileText(serializeVault(resurrected))).not.toThrow()

    const resigned = await signVaultFile(resurrected, opened.session, signed)
    expect(resigned.tombstones).toContainEqual(
      expect.objectContaining({ kind: 'item', id: created.item.id }),
    )
    const report = await verifyVaultFile(resigned, opened.session)
    expect(report.items).toBe(1)
    opened.session.lock()
  })

  it('archive le contenu perdant d’un conflit dans l’historique', async () => {
    const opened = await freshVault()
    const created = await addLogin(opened)
    const base = await signVaultFile(created.file, opened.session, opened.file)
    const left = await updateItem(base, opened.session, {
      ...(created.item as LoginItem),
      title: 'Version gauche',
    })
    const right = await updateItem(base, opened.session, {
      ...(created.item as LoginItem),
      title: 'Version droite',
    })
    const losing = left.file.items[0]

    const preserved = await preserveConflictVersion(
      right.file,
      opened.session,
      losing,
    )
    expect(preserved.archived).toBe(true)
    expect(preserved.file.versions).toHaveLength(2)

    const signed = await signVaultFile(preserved.file, opened.session, right.file)
    const reopened = await unlockVaultFile(signed, PASSWORD)
    const versions = await listItemVersions(
      reopened.file,
      reopened.session,
      created.item.id,
    )
    expect(versions).toHaveLength(2)
    expect(versions.some((version) => version.content.title === 'Version gauche')).toBe(
      true,
    )

    // Une seconde synchronisation du même conflit ne duplique pas la version.
    const again = await preserveConflictVersion(
      preserved.file,
      opened.session,
      losing,
    )
    expect(again.archived).toBe(false)
    expect(again.file.versions).toHaveLength(2)
    opened.session.lock()
    reopened.session.lock()
  })

  it('refuse une pierre tombale qui désigne un élément encore présent', async () => {
    const opened = await freshVault()
    const created = await addLogin(opened)
    const signed = await signVaultFile(created.file, opened.session, opened.file)

    const inconsistent: VaultFile = {
      ...signed,
      tombstones: [
        { kind: 'item', id: created.item.id, deletedAt: new Date().toISOString() },
      ],
    }

    await expect(verifyVaultFile(inconsistent, opened.session)).rejects.toBeInstanceOf(
      VaultIntegrityError,
    )
    expect(() => parseVaultFileText(JSON.stringify(inconsistent))).toThrow(
      /supprimé est encore présent/,
    )
    opened.session.lock()
  })
})

describe('anti-retour en arrière', () => {
  it('alerte lorsqu’un fichier v4 recule de révision', async () => {
    const opened = await freshVault()
    const created = await addLogin(opened)
    const signed = await signVaultFile(created.file, opened.session, opened.file)

    const warning = checkVaultRollback(signed, {
      fileId: signed.id,
      revision: signed.revision! + 2,
      updatedAt: new Date().toISOString(),
    })
    expect(warning).toContain('version antérieure')

    expect(
      checkVaultRollback(signed, {
        fileId: signed.id,
        revision: signed.revision!,
        updatedAt: new Date().toISOString(),
      }),
    ).toBeNull()

    expect(
      checkVaultRollback(signed, {
        fileId: 'vf_autre',
        revision: 999,
        updatedAt: new Date().toISOString(),
      }),
    ).toBeNull()
    opened.session.lock()
  })

  it('ne redescend jamais sous la révision minimale connue', async () => {
    const opened = await freshVault()
    const signed = await signVaultFile(opened.file, opened.session, opened.file, {
      minimumRevision: 42,
    })
    expect(signed.revision).toBe(43)
    opened.session.lock()
  })

  it('alerte si un état connut v4 redevient un fichier sans signature', async () => {
    const opened = await freshVault()
    const legacy = { ...opened.file, version: 3 } as VaultFile
    delete legacy.writer
    delete legacy.revision
    delete legacy.keyEpoch
    delete legacy.tombstones
    delete legacy.integrity

    expect(
      checkVaultRollback(legacy, {
        fileId: legacy.id,
        revision: 7,
        updatedAt: new Date().toISOString(),
      }),
    ).toContain('signature de version 4')
    opened.session.lock()
  })
})
