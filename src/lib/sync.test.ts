import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  mergeVaultFiles,
  VaultSyncError,
  type MergeResult,
} from './sync'
import {
  createItem,
  createVaultFile,
  parseVaultFileText,
  serializeVault,
  signVaultFile,
  unlockVaultFile,
  updateItem,
  verifyVaultFile,
} from './vault'
import {
  emptyDraft,
  type EncryptedAttachmentRecord,
  type EncryptedItemRecord,
  type EncryptedVaultRecord,
  type EncryptedVersionRecord,
  type ItemDraft,
  type LoginItem,
  type VaultFile,
} from './types'

const KDF = {
  algorithm: 'argon2id' as const,
  salt: 'c2VsLWRlLXRlc3Q=',
  memoryKiB: 8_192,
  iterations: 1,
  parallelism: 1,
  keyLength: 32 as const,
}

const T0 = '2026-01-01T00:00:00.000Z'

function sealed(id: string): { n: string; c: string } {
  return { n: `n-${id}`, c: `c-${id}` }
}

function vaultRecord(
  id: string,
  overrides: Partial<EncryptedVaultRecord> = {},
): EncryptedVaultRecord {
  return {
    id,
    key: sealed(`key-${id}`),
    name: sealed(`name-${id}`),
    createdAt: T0,
    updatedAt: T0,
    clock: { rev: 1, writer: 'w0' },
    ...overrides,
  }
}

function itemRecord(
  id: string,
  vaultId: string,
  overrides: Partial<EncryptedItemRecord> = {},
): EncryptedItemRecord {
  return {
    id,
    vaultId,
    key: sealed(`key-${id}`),
    content: sealed(`content-${id}`),
    createdAt: T0,
    updatedAt: T0,
    clock: { rev: 1, writer: 'w0' },
    ...overrides,
  }
}

function versionRecord(
  id: string,
  itemId: string,
  overrides: Partial<EncryptedVersionRecord> = {},
): EncryptedVersionRecord {
  return {
    id,
    itemId,
    vaultId: 'v1',
    content: sealed(`version-${id}`),
    createdAt: T0,
    ...overrides,
  }
}

function attachmentRecord(
  id: string,
  itemId: string,
  overrides: Partial<EncryptedAttachmentRecord> = {},
): EncryptedAttachmentRecord {
  return {
    id,
    itemId,
    vaultId: 'v1',
    data: sealed(`attachment-${id}`),
    createdAt: T0,
    ...overrides,
  }
}

function baseFile(): VaultFile {
  return {
    format: 'coffre',
    version: 4,
    id: 'vf_test',
    createdAt: T0,
    updatedAt: T0,
    kdf: { ...KDF },
    vaults: [vaultRecord('v1'), vaultRecord('v2')],
    items: [
      itemRecord('i1', 'v1'),
      itemRecord('i2', 'v1'),
      itemRecord('i3', 'v2'),
    ],
    attachments: [attachmentRecord('a1', 'i1')],
    versions: [versionRecord('iv1', 'i1')],
    tombstones: [],
    writer: 'w0',
    revision: 1,
    keyEpoch: 1,
  }
}

function at(step: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, step)).toISOString()
}

function maxClock(file: VaultFile): number {
  let value = file.revision ?? 0
  for (const record of [...file.vaults, ...file.items]) {
    value = Math.max(value, record.clock?.rev ?? 0)
  }
  return value
}

type Operation =
  | 'update-item'
  | 'delete-item'
  | 'rename-vault'
  | 'add-item'
  | 'add-version'
  | 'add-attachment'
  | 'delete-vault'

/**
 * Simule une suite d’écritures locales sur une copie du fichier de base.
 * Chaque opération incrémente l’horloge globale et horodate l’enregistrement.
 */
function applyOperations(
  source: VaultFile,
  writer: string,
  operations: Operation[],
): VaultFile {
  const file = structuredClone(source)
  let revision = maxClock(file)
  let step = 0

  for (const operation of operations) {
    step += 1
    revision += 1
    const timestamp = at(step)
    const firstV1 = file.items.find((item) => item.vaultId === 'v1')

    switch (operation) {
      case 'update-item': {
        if (!firstV1) break
        firstV1.content = sealed(`content-${writer}-${step}`)
        firstV1.updatedAt = timestamp
        firstV1.clock = { rev: revision, writer }
        break
      }
      case 'delete-item': {
        if (!firstV1) break
        file.items = file.items.filter((item) => item.id !== firstV1.id)
        file.attachments = file.attachments.filter(
          (attachment) => attachment.itemId !== firstV1.id,
        )
        file.versions = file.versions.filter(
          (version) => version.itemId !== firstV1.id,
        )
        file.tombstones = [
          ...(file.tombstones ?? []),
          { kind: 'item', id: firstV1.id, deletedAt: timestamp },
        ]
        break
      }
      case 'rename-vault': {
        const vault = file.vaults.find((candidate) => candidate.id === 'v1')
        if (!vault) break
        vault.name = sealed(`name-${writer}-${step}`)
        vault.updatedAt = timestamp
        vault.clock = { rev: revision, writer }
        break
      }
      case 'add-item': {
        if (!file.vaults.some((vault) => vault.id === 'v1')) break
        const id = `i_${writer}_${step}`
        file.items.push(
          itemRecord(id, 'v1', {
            createdAt: timestamp,
            updatedAt: timestamp,
            clock: { rev: revision, writer },
          }),
        )
        break
      }
      case 'add-version': {
        if (!firstV1) break
        // Une version n’est jamais ajoutée seule : l’écriture met aussi à jour
        // le contenu courant et son horloge.
        firstV1.updatedAt = timestamp
        firstV1.clock = { rev: revision, writer }
        firstV1.content = sealed(`content-version-${writer}-${step}`)
        file.versions.push(
          versionRecord(`iv_${writer}_${step}`, firstV1.id, {
            content: sealed(`version-${writer}-${step}`),
            createdAt: timestamp,
          }),
        )
        break
      }
      case 'add-attachment': {
        if (!firstV1) break
        firstV1.updatedAt = timestamp
        firstV1.clock = { rev: revision, writer }
        firstV1.content = sealed(`content-attachment-${writer}-${step}`)
        file.attachments.push(
          attachmentRecord(`a_${writer}_${step}`, firstV1.id, {
            data: sealed(`attachment-${writer}-${step}`),
            createdAt: timestamp,
          }),
        )
        break
      }
      case 'delete-vault': {
        const vault = file.vaults.find((candidate) => candidate.id === 'v2')
        if (!vault) break
        file.vaults = file.vaults.filter((candidate) => candidate.id !== 'v2')
        file.items = file.items.filter((item) => item.vaultId !== 'v2')
        file.attachments = file.attachments.filter(
          (attachment) => attachment.vaultId !== 'v2',
        )
        file.versions = file.versions.filter(
          (version) => version.vaultId !== 'v2',
        )
        file.tombstones = [
          ...(file.tombstones ?? []),
          { kind: 'vault', id: 'v2', deletedAt: timestamp },
        ]
        break
      }
    }

    file.revision = revision
    file.writer = writer
    file.updatedAt = timestamp
  }

  return file
}

function device(
  writer: string,
  operations: Operation[],
): VaultFile {
  return applyOperations(baseFile(), writer, operations)
}

function comparable(result: MergeResult): unknown {
  return JSON.parse(JSON.stringify(result.file)) as unknown
}

const operation = fc.constantFrom<Operation>(
  'update-item',
  'delete-item',
  'rename-vault',
  'add-item',
  'add-version',
  'add-attachment',
  'delete-vault',
)

const operations = fc.array(operation, { maxLength: 7 })

describe('fusion de fichiers', () => {
  it('est commutative pour deux appareils', () => {
    fc.assert(
      fc.property(operations, operations, (leftOps, rightOps) => {
        const left = device('wa', leftOps)
        const right = device('wb', rightOps)
        const one = mergeVaultFiles(left, [right])
        const two = mergeVaultFiles(right, [left])
        expect(comparable(two)).toEqual(comparable(one))
        expect(JSON.parse(JSON.stringify(two.conflicts))).toEqual(
          JSON.parse(JSON.stringify(one.conflicts)),
        )
      }),
      { numRuns: 60 },
    )
  })

  it('est idempotente', () => {
    fc.assert(
      fc.property(operations, (ops) => {
        const file = device('wa', ops)
        const once = mergeVaultFiles(file, [])
        const twice = mergeVaultFiles(once.file, [])
        expect(comparable(twice)).toEqual(comparable(once))
        expect(mergeVaultFiles(file, [file]).conflicts).toEqual([])
        expect(comparable(mergeVaultFiles(file, [file]))).toEqual(
          comparable(once),
        )
      }),
      { numRuns: 40 },
    )
  })

  it('converge pour trois appareils, quel que soit l’ordre de fusion', () => {
    fc.assert(
      fc.property(operations, operations, operations, (a, b, c) => {
        const first = device('wa', a)
        const second = device('wb', b)
        const third = device('wc', c)

        const allAtOnce = mergeVaultFiles(first, [second, third])
        const sequential = mergeVaultFiles(
          mergeVaultFiles(third, [second]).file,
          [first],
        )
        const reverse = mergeVaultFiles(
          mergeVaultFiles(second, [first]).file,
          [third],
        )

        expect(comparable(sequential)).toEqual(comparable(allAtOnce))
        expect(comparable(reverse)).toEqual(comparable(allAtOnce))
      }),
      { numRuns: 40 },
    )
  })

  it('signale un conflit à révision égale et garde l’enregistrement perdant', () => {
    const left = baseFile()
    const right = structuredClone(left)
    const leftItem = left.items.find((item) => item.id === 'i1') as EncryptedItemRecord
    const rightItem = right.items.find((item) => item.id === 'i1') as EncryptedItemRecord
    leftItem.content = sealed('content-left')
    leftItem.updatedAt = at(1)
    leftItem.clock = { rev: 2, writer: 'wa' }
    rightItem.content = sealed('content-right')
    rightItem.updatedAt = at(1)
    rightItem.clock = { rev: 2, writer: 'wb' }

    const result = mergeVaultFiles(left, [right])
    const selected = result.file.items.find((item) => item.id === 'i1')
    expect(selected?.content).toEqual(sealed('content-right'))
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({
      kind: 'item',
      id: 'i1',
      reason: 'concurrent-edit',
    })
    if (result.conflicts[0].kind === 'item') {
      expect(result.conflicts[0].losing.content).toEqual(sealed('content-left'))
    }

    const reversed = mergeVaultFiles(right, [left])
    expect(comparable(reversed)).toEqual(comparable(result))
  })

  it('applique une pierre tombale plus récente que l’enregistrement', () => {
    const local = baseFile()
    const remote = structuredClone(local)
    remote.items = remote.items.filter((item) => item.id !== 'i1')
    remote.attachments = []
    remote.versions = []
    remote.tombstones = [
      { kind: 'item', id: 'i1', deletedAt: at(5) },
    ]

    const result = mergeVaultFiles(local, [remote])
    expect(result.file.items.some((item) => item.id === 'i1')).toBe(false)
    expect(result.file.tombstones).toContainEqual({
      kind: 'item',
      id: 'i1',
      deletedAt: at(5),
    })
    expect(result.file.attachments).toHaveLength(0)
    expect(result.file.versions).toHaveLength(0)
  })

  it('ressuscite un élément modifié après la pierre tombale', () => {
    const local = baseFile()
    const item = local.items.find((candidate) => candidate.id === 'i1') as EncryptedItemRecord
    item.updatedAt = at(9)
    item.clock = { rev: 4, writer: 'wa' }
    const remote = structuredClone(local)
    remote.items = remote.items.filter((candidate) => candidate.id !== 'i1')
    remote.attachments = []
    remote.versions = []
    remote.tombstones = [{ kind: 'item', id: 'i1', deletedAt: at(3) }]

    const result = mergeVaultFiles(local, [remote])
    expect(result.file.items.some((candidate) => candidate.id === 'i1')).toBe(true)
    // La pierre tombale reste conservée pour les fusions suivantes : elle est
    // seulement plus ancienne que l’enregistrement ressuscité.
    expect(result.file.tombstones).toContainEqual({
      kind: 'item',
      id: 'i1',
      deletedAt: at(3),
    })
  })

  it('supprime les éléments d’un coffre supprimé et conserve la tombstone inconnue', () => {
    const local = baseFile()
    const remote = structuredClone(local)
    remote.vaults = remote.vaults.filter((vault) => vault.id !== 'v2')
    remote.items = remote.items.filter((item) => item.vaultId !== 'v2')
    remote.tombstones = [
      { kind: 'vault', id: 'v2', deletedAt: at(6) },
      { kind: 'vault', id: 'v9', deletedAt: at(7) },
    ]

    const result = mergeVaultFiles(local, [remote])
    expect(result.file.vaults.map((vault) => vault.id)).toEqual(['v1'])
    expect(result.file.items.some((item) => item.vaultId === 'v2')).toBe(false)
    expect((result.file.tombstones ?? []).map((entry) => entry.id).sort()).toEqual([
      'v2',
      'v9',
    ])
  })

  it('unit versions et pièces jointes puis applique les plafonds', () => {
    const local = baseFile()
    const remote = structuredClone(local)
    remote.versions.push(
      versionRecord('iv-remote', 'i1', { content: sealed('remote-version') }),
    )
    remote.attachments.push(
      attachmentRecord('a-remote', 'i1', { data: sealed('remote-attachment') }),
    )

    const result = mergeVaultFiles(local, [remote])
    expect(result.file.versions.map((version) => version.id)).toContain('iv-remote')
    expect(result.file.attachments.map((attachment) => attachment.id)).toContain(
      'a-remote',
    )

    for (let index = 0; index < 25; index++) {
      local.versions.push(
        versionRecord(`iv-cap-${index}`, 'i1', {
          content: sealed(`content-cap-${index}`),
          createdAt: at(index + 1),
        }),
      )
    }
    const capped = mergeVaultFiles(local, [])
    expect(capped.file.versions).toHaveLength(20)
  })

  it('refuse des époques, des fichiers ou des paramètres incompatibles', () => {
    const local = baseFile()
    const otherEpoch = { ...structuredClone(local), keyEpoch: 2 }
    expect(() => mergeVaultFiles(local, [otherEpoch])).toThrowError(
      VaultSyncError,
    )
    try {
      mergeVaultFiles(local, [otherEpoch])
    } catch (error) {
      expect((error as VaultSyncError).code).toBe('epoch-mismatch')
      expect((error as VaultSyncError).epochs).toEqual([1, 2])
    }

    const otherId = { ...structuredClone(local), id: 'vf_other' }
    expect(() => mergeVaultFiles(local, [otherId])).toThrowError(VaultSyncError)

    const otherKdf = {
      ...structuredClone(local),
      kdf: { ...local.kdf, salt: 'YXV0cmUtc2Vs' },
    }
    expect(() => mergeVaultFiles(local, [otherKdf])).toThrowError(VaultSyncError)

    const legacy = { ...structuredClone(local), version: 3 as const }
    expect(() => mergeVaultFiles(legacy, [])).toThrowError(VaultSyncError)
  })

  it('écarte une enveloppe de récupération incomplète', () => {
    const local = baseFile()
    local.recovery = {
      version: 1,
      kdf: { ...KDF },
      createdAt: T0,
      key: sealed('recovery-key'),
      guard: sealed('recovery-guard'),
      wraps: [{ vaultId: 'v1', key: sealed('wrap-v1') }],
    }

    const result = mergeVaultFiles(local, [])
    expect(result.file.recovery).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('enveloppe de récupération')
  })
})

describe('intégration avec le format réel', () => {
  it('fusionne deux branches signées puis rouvre le fichier', async () => {
    const password = 'phrase de passe de test solide'
    const kdf = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }
    const opened = await createVaultFile(password, 'Personnel', kdf)
    const vaultId = opened.vaults[0].id

    const first = await createItem(opened.file, opened.session, {
      ...emptyDraft('login', vaultId),
      title: 'GitHub',
      username: 'studio26',
      password: 's3cret!',
      urls: ['https://github.com'],
      type: 'login',
      totp: '',
    } as ItemDraft)
    const base = await signVaultFile(first.file, opened.session, opened.file)

    const leftDraft = await updateItem(base, opened.session, {
      ...(first.item as LoginItem),
      title: 'GitHub gauche',
    })
    const left = await signVaultFile(leftDraft.file, opened.session, base)

    const second = await createItem(base, opened.session, {
      ...emptyDraft('note', vaultId),
      title: 'Note droite',
    } as ItemDraft)
    const right = await signVaultFile(second.file, opened.session, base)

    const merged = mergeVaultFiles(left, [right])
    expect(merged.conflicts).toEqual([])
    const signed = await signVaultFile(merged.file, opened.session, left)

    const parsed = parseVaultFileText(serializeVault(signed))
    expect(parsed.version).toBe(4)
    const reopened = await unlockVaultFile(parsed, password)
    expect(reopened.items.map((item) => item.title).sort()).toEqual([
      'GitHub gauche',
      'Note droite',
    ])
    const report = await verifyVaultFile(signed, reopened.session)
    expect(report.items).toBe(2)

    opened.session.lock()
    reopened.session.lock()
  })
})
