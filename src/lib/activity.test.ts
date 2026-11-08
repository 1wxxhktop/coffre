import { describe, expect, it } from 'vitest'
import {
  appendActivity,
  changeMasterPassword,
  createVaultFile,
  openVaultFileWithMasterKey,
  signVaultFile,
} from './vault'
import { mergeVaultFiles } from './sync'

const PASSWORD = 'phrase de passe de test solide'
const NEXT = 'nouvelle phrase de passe solide'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

describe('journal d’activité chiffré', () => {
  it('chiffre, relit et fusionne les événements', async () => {
    const opened = await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
    const base = await signVaultFile(opened.file, opened.session, opened.file)
    const first = await appendActivity(base, opened.session, {
      kind: 'unlock',
      detail: 'Déverrouillage par mot de passe',
    })
    const second = await appendActivity(first.file, opened.session, {
      kind: 'extension-fill',
      detail: 'GitHub',
      host: 'github.com',
    })
    const signed = await signVaultFile(second.file, opened.session, base)
    expect(JSON.stringify(signed)).not.toContain('Déverrouillage par mot de passe')

    const reopened = await openVaultFileWithMasterKey(signed, opened.session.masterKey)
    expect(reopened.activity).toHaveLength(2)
    expect(reopened.activity.map((event) => event.kind).sort()).toEqual([
      'extension-fill',
      'unlock',
    ])
    expect(reopened.activity.find((event) => event.kind === 'extension-fill')).toMatchObject({
      detail: 'GitHub',
      host: 'github.com',
    })
    reopened.session.lock()

    const merged = mergeVaultFiles(signed, [base])
    expect(merged.file.activity).toHaveLength(2)
    opened.session.lock()
  })

  it('rechiffre le journal lors d’un changement de mot de passe', async () => {
    const opened = await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
    const base = await signVaultFile(opened.file, opened.session, opened.file)
    const logged = await appendActivity(base, opened.session, {
      kind: 'export',
      detail: 'Fichier .coffre',
    })
    const signed = await signVaultFile(logged.file, opened.session, base)
    const rotated = await changeMasterPassword(signed, opened.session, NEXT, FAST_KDF)
    const reopened = await openVaultFileWithMasterKey(rotated, opened.session.masterKey)
    expect(reopened.activity).toHaveLength(1)
    expect(reopened.activity[0]).toMatchObject({
      kind: 'export',
      detail: 'Fichier .coffre',
    })
    reopened.session.lock()
    opened.session.lock()
  })
})
