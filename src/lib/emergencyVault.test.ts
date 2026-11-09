import { describe, expect, it } from 'vitest'
import {
  createEmergencyRecord,
  createShamirEmergencyRecord,
  openEmergencyRecord,
  openShamirEmergencyRecord,
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
    if (resealed.mode !== 'immediate') throw new Error('mode immédiat attendu')
    const opened = await openEmergencyRecord(resealed, contact)
    expect(Array.from(opened)).toEqual(Array.from(nextKey))
    expect(resealed.createdAt).toBe(record.createdAt)
  })

  it('partage la clé en Shamir 2/3', async () => {
    const contacts = await Promise.all([
      generateSharingIdentity(),
      generateSharingIdentity(),
      generateSharingIdentity(),
    ])
    const record = await createShamirEmergencyRecord(
      masterKey,
      contacts.map(publicSharingIdentity),
      2,
    )
    expect(record.mode).toBe('shamir')
    expect(record.shares).toHaveLength(3)
    for (const pair of [
      [contacts[0], contacts[1]],
      [contacts[0], contacts[2]],
      [contacts[1], contacts[2]],
    ]) {
      expect(Array.from(await openShamirEmergencyRecord(record, pair))).toEqual(
        Array.from(masterKey),
      )
    }
    await expect(
      openShamirEmergencyRecord(record, [contacts[0]]),
    ).rejects.toThrow()
    expect(
      Array.from(await openShamirEmergencyRecord(record, contacts)),
    ).toEqual(Array.from(masterKey))

    const nextKey = randomBytes(32)
    const resealed = await resealEmergencyRecord(record, nextKey)
    if (resealed.mode !== 'shamir') throw new Error('mode Shamir attendu')
    expect(Array.from(await openShamirEmergencyRecord(resealed, contacts.slice(0, 2)))).toEqual(
      Array.from(nextKey),
    )
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
    if (reopened.file.emergency?.mode !== 'immediate') throw new Error('mode immédiat attendu')
    expect(Array.from(await openEmergencyRecord(reopened.file.emergency, contact))).toEqual(
      Array.from(opened.session.masterKey),
    )
    const next = await changeMasterPassword(signed, opened.session, nextPassword, fastKdf)
    const unlocked = await unlockVaultFile(next, nextPassword)
    expect(unlocked.file.emergency).toBeDefined()
    if (unlocked.file.emergency?.mode !== 'immediate') throw new Error('mode immédiat attendu')
    expect((await openEmergencyRecord(unlocked.file.emergency, contact)).length).toBe(32)
    unlocked.session.lock()
    reopened.session.lock()
  })
})
