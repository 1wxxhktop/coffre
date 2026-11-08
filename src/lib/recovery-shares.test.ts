import { describe, expect, it } from 'vitest'
import {
  createVaultFile,
  enableRecovery,
  recoverVaultFileWithRecoveryKey,
  unlockVaultFile,
} from './vault'
import { combineShares, splitSecret } from './shamir'
import { wipe } from './crypto'

const PASSWORD = 'phrase de passe de test solide'
const NEW_PASSWORD = 'nouvelle phrase de passe solide'
const PHRASE = 'abacus abdomen abdominal abide abiding ability abject ablaze abode abort'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

describe('récupération par parts Shamir', () => {
  it('ouvre le coffre avec k parts et impose un nouveau mot de passe', async () => {
    const opened = await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
    const file = await enableRecovery(opened.file, opened.session, PHRASE, FAST_KDF)
    const recoveryKey = opened.session.recoveryKey().slice()
    const shares = await splitSecret(recoveryKey, 3, 5)

    const combined = await combineShares([shares[0], shares[2], shares[4]])
    try {
      expect(combined).toEqual(recoveryKey)

      const recovered = await recoverVaultFileWithRecoveryKey(
        file,
        combined,
        NEW_PASSWORD,
        FAST_KDF,
      )
      expect(recovered.items).toHaveLength(0)
      expect(recovered.file.recovery).toBeDefined()
      recovered.session.lock()

      await expect(unlockVaultFile(recovered.file, PASSWORD)).rejects.toThrow()
      const reopened = await unlockVaultFile(recovered.file, NEW_PASSWORD)
      expect(reopened.items).toHaveLength(0)
      reopened.session.lock()
    } finally {
      wipe(recoveryKey, combined)
      opened.session.lock()
    }
  })

  it('refuse un mélange de parts provenant de partages différents', async () => {
    const opened = await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
    const file = await enableRecovery(opened.file, opened.session, PHRASE, FAST_KDF)
    const recoveryKey = opened.session.recoveryKey().slice()
    const first = await splitSecret(recoveryKey, 3, 5)
    const second = await splitSecret(recoveryKey, 3, 5)
    const mixed = await combineShares([first[0], second[1], second[2]])

    try {
      await expect(
        recoverVaultFileWithRecoveryKey(file, mixed, NEW_PASSWORD, FAST_KDF),
      ).rejects.toThrow()
    } finally {
      wipe(recoveryKey, mixed)
      opened.session.lock()
    }
  })
})
