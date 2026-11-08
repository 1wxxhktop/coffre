import { describe, expect, it } from 'vitest'
import {
  createSharingIdentity,
  openSharingIdentity,
  resealSharingIdentity,
  sealSharingIdentity,
} from './sharingVault'
import { generateSharingIdentity } from './sharing'
import { randomBytes } from './crypto'

const fileId = 'v_file'
const masterKey = randomBytes(32)

describe('identité de partage dans le fichier', () => {
  it('scelle et rouvre les clés privées', async () => {
    const { identity, record } = await createSharingIdentity(masterKey, fileId)
    const opened = await openSharingIdentity(record, masterKey, fileId)
    expect(opened.fingerprint).toBe(identity.fingerprint)
    expect(opened.encryptionPrivateKey).toBe(identity.encryptionPrivateKey)
    expect(opened.signingPrivateKey).toBe(identity.signingPrivateKey)
    expect(JSON.stringify(record)).not.toContain(identity.encryptionPrivateKey)
    expect(JSON.stringify(record)).not.toContain(identity.signingPrivateKey)
  })

  it('refuse un autre fichier, une autre clé ou une clé publique altérée', async () => {
    const { record } = await createSharingIdentity(masterKey, fileId)
    await expect(openSharingIdentity(record, masterKey, 'v_other')).rejects.toThrow()
    await expect(
      openSharingIdentity(record, randomBytes(32), fileId),
    ).rejects.toThrow()
    const tampered = {
      ...record,
      signingPublicKey: (await generateSharingIdentity()).signingPublicKey,
    }
    await expect(openSharingIdentity(tampered, masterKey, fileId)).rejects.toThrow()
  })

  it('ré-enveloppe après une rotation de clé maîtresse', async () => {
    const identity = await generateSharingIdentity()
    const record = await sealSharingIdentity(identity, masterKey, fileId)
    const nextMasterKey = randomBytes(32)
    const resealed = await resealSharingIdentity(record, masterKey, nextMasterKey, fileId)
    await expect(openSharingIdentity(record, nextMasterKey, fileId)).rejects.toThrow()
    const opened = await openSharingIdentity(resealed, nextMasterKey, fileId)
    expect(opened.fingerprint).toBe(identity.fingerprint)
    expect(resealed.createdAt).toBe(record.createdAt)
  })
})

describe('intégration au fichier .coffre', () => {
  const password = 'phrase de passe de test solide'
  const nextPassword = 'autre phrase de passe solide'
  const fastKdf = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

  it('persiste l’identité et la conserve après changement de mot de passe', async () => {
    const { createVaultFile, changeMasterPassword, openVaultFileWithMasterKey, signVaultFile, unlockVaultFile } = await import('./vault')
    const opened = await createVaultFile(password, 'Personnel', fastKdf)
    const { record } = await createSharingIdentity(opened.session.masterKey, opened.file.id)
    const signed = await signVaultFile(
      { ...opened.file, sharing: record },
      opened.session,
      opened.file,
    )
    const reopened = await openVaultFileWithMasterKey(signed, opened.session.masterKey)
    expect(reopened.sharing?.fingerprint).toBe(record.fingerprint)

    const next = await changeMasterPassword(signed, opened.session, nextPassword, fastKdf)
    const unlocked = await unlockVaultFile(next, nextPassword)
    expect(unlocked.sharing?.fingerprint).toBe(record.fingerprint)
    expect(unlocked.sharing?.encryptionPrivateKey).toBe(
      reopened.sharing?.encryptionPrivateKey,
    )
    unlocked.session.lock()
  })
})
