import { describe, expect, it } from 'vitest'
import {
  createEmergencyRecord,
  openEmergencyRecord,
  resealEmergencyRecord,
} from './emergencyVault'
import { generateSharingIdentity, publicSharingIdentity } from './sharing'
import { randomBytes } from './crypto'

const masterKey = randomBytes(32)

describe('accès d’urgence', () => {
  it('scelle la clé maîtresse pour un contact', async () => {
    const contact = await generateSharingIdentity()
    const record = await createEmergencyRecord(
      masterKey,
      publicSharingIdentity(contact),
    )
    const opened = await openEmergencyRecord(record, contact)
    expect(Array.from(opened)).toEqual(Array.from(masterKey))
    const other = await generateSharingIdentity()
    await expect(openEmergencyRecord(record, other)).rejects.toThrow()
  })

  it('ré-enveloppe la clé après une rotation', async () => {
    const contact = await generateSharingIdentity()
    const record = await createEmergencyRecord(
      masterKey,
      publicSharingIdentity(contact),
    )
    const nextKey = randomBytes(32)
    const resealed = await resealEmergencyRecord(record, nextKey)
    await expect(openEmergencyRecord(record, contact)).resolves.toBeDefined()
    const opened = await openEmergencyRecord(resealed, contact)
    expect(Array.from(opened)).toEqual(Array.from(nextKey))
    expect(resealed.createdAt).toBe(record.createdAt)
  })

  it('survit à un changement de mot de passe du fichier', async () => {
    const {
      changeMasterPassword,
      createVaultFile,
      openVaultFileWithMasterKey,
      signVaultFile,
      unlockVaultFile,
    } = await import('./vault')
    const password = 'phrase de passe de test solide'
    const nextPassword = 'autre phrase de passe solide'
    const fastKdf = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }
    const contact = await generateSharingIdentity()
    const opened = await createVaultFile(password, 'Personnel', fastKdf)
    const record = await createEmergencyRecord(
      opened.session.masterKey,
      publicSharingIdentity(contact),
    )
    const signed = await signVaultFile(
      { ...opened.file, emergency: record },
      opened.session,
      opened.file,
    )
    const reopened = await openVaultFileWithMasterKey(signed, opened.session.masterKey)
    expect(reopened.file.emergency).toBeDefined()
    expect(Array.from(await openEmergencyRecord(reopened.file.emergency!, contact))).toEqual(
      Array.from(opened.session.masterKey),
    )
    const next = await changeMasterPassword(signed, opened.session, nextPassword, fastKdf)
    const unlocked = await unlockVaultFile(next, nextPassword)
    expect(unlocked.file.emergency).toBeDefined()
    expect((await openEmergencyRecord(unlocked.file.emergency!, contact)).length).toBe(32)
    unlocked.session.lock()
    reopened.session.lock()
  })
})
