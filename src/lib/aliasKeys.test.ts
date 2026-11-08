import { describe, expect, it } from 'vitest'
import {
  changeMasterPassword,
  createVaultFile,
  openVaultFileWithMasterKey,
  setAliasKey,
  signVaultFile,
} from './vault'

const PASSWORD = 'phrase de passe de test solide'
const NEXT = 'nouvelle phrase de passe solide'
const FAST = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

describe('clés API d’alias chiffrées', () => {
  it('chiffre, relit et survit au changement de mot de passe', async () => {
    const opened = await createVaultFile(PASSWORD, 'Personnel', FAST)
    const withKey = await setAliasKey(opened.file, opened.session, 'simplelogin', 'sl-secret')
    const signed = await signVaultFile(withKey, opened.session, opened.file)
    expect(JSON.stringify(signed)).not.toContain('sl-secret')

    const reopened = await openVaultFileWithMasterKey(signed, opened.session.masterKey)
    expect(reopened.aliasKeys.simplelogin).toBe('sl-secret')
    reopened.session.lock()

    const rotated = await changeMasterPassword(signed, opened.session, NEXT, FAST)
    const reopenedRotated = await openVaultFileWithMasterKey(
      rotated,
      opened.session.masterKey,
    )
    expect(reopenedRotated.aliasKeys.simplelogin).toBe('sl-secret')
    reopenedRotated.session.lock()
    opened.session.lock()
  })
})
