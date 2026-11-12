import { describe, expect, it } from 'vitest'
import {
  createItem,
  createVaultFile,
  removeAttachment,
  signVaultFile,
  unlockVaultFile,
  updateItem,
  verifyVaultFile,
} from './vault'
import { emptyDraft, type AttachmentMeta, type ItemDraft, type LoginItem } from './types'

const PASSWORD = 'phrase de passe de test solide'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

function blobAttachment(): AttachmentMeta {
  return {
    id: 'a_blob',
    name: 'document.pdf',
    mime: 'application/pdf',
    // Plus de 5 Mio : la limite des pièces jointes inline ne s’applique pas.
    size: 6 * 1024 * 1024,
    createdAt: '2026-11-11T10:00:00.000Z',
    storage: 'blob',
    blobId: 'blob_document',
    blobKey: 'cle-de-blob',
    sha256: 'empreinte',
  }
}

async function itemWithBlob() {
  const opened = await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
  const vaultId = opened.vaults[0].id
  const created = await createItem(opened.file, opened.session, {
    ...emptyDraft('login', vaultId),
    title: 'Banque',
    username: 'ada',
    password: 'secret',
    urls: ['https://banque.test'],
    type: 'login',
    totp: '',
  } as ItemDraft)
  const base = await signVaultFile(created.file, opened.session, opened.file)
  const updated = await updateItem(base, opened.session, {
    ...(created.item as LoginItem),
    attachments: [blobAttachment()],
  })
  const signed = await signVaultFile(updated.file, opened.session, base)
  return { opened, signed }
}

describe('pièces jointes blob', () => {
  it('survit au verrouillage, à une modification et à la vérification', async () => {
    const { opened, signed } = await itemWithBlob()
    const reopened = await unlockVaultFile(signed, PASSWORD)
    expect(reopened.items[0].attachments).toContainEqual(blobAttachment())

    const report = await verifyVaultFile(signed, reopened.session)
    expect(report.items).toBe(1)

    const renamed = await updateItem(signed, reopened.session, {
      ...reopened.items[0],
      title: 'Banque renommée',
    })
    expect(renamed.item.title).toBe('Banque renommée')
    expect(renamed.item.attachments).toContainEqual(blobAttachment())

    opened.session.lock()
    reopened.session.lock()
  })

  it('se supprime sans exiger un enregistrement inline', async () => {
    const { opened, signed } = await itemWithBlob()
    const reopened = await unlockVaultFile(signed, PASSWORD)
    expect(reopened.file.attachments).toHaveLength(0)

    const removed = await removeAttachment(
      reopened.file,
      reopened.session,
      reopened.items[0],
      'a_blob',
    )
    expect(removed.item.attachments).toHaveLength(0)
    expect(removed.file.attachments).toHaveLength(0)
    const resigned = await signVaultFile(
      removed.file,
      reopened.session,
      reopened.file,
    )
    const after = await unlockVaultFile(resigned, PASSWORD)
    expect(after.items[0].attachments).toHaveLength(0)
    expect((await verifyVaultFile(resigned, after.session)).items).toBe(1)

    opened.session.lock()
    reopened.session.lock()
    after.session.lock()
  })
})
