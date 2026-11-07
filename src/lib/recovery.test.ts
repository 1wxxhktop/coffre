import { describe, expect, it } from 'vitest'
import {
  addVault,
  changeMasterPassword,
  createItem,
  createVaultFile,
  deleteVault,
  disableRecovery,
  enableRecovery,
  parseVaultFile,
  recoverVaultFile,
  serializeVault,
  unlockVaultFile,
  VaultValidationError,
  WrongPasswordError,
} from './vault'
import {
  generateRecoveryPhrase,
  isRecoveryPhrase,
  normalizeRecoveryPhrase,
  RECOVERY_WORDS,
} from './recovery'
import { emptyDraft, type ItemDraft, type LoginItem } from './types'

const PASSWORD = 'phrase de passe de test solide'
const NEW_PASSWORD = 'nouvelle phrase de passe solide'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }
const PHRASE = 'abacus abdomen abdominal abide abiding ability abject ablaze abode abort'

async function freshVault() {
  return createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
}

async function addLogin(opened: Awaited<ReturnType<typeof createVaultFile>>, title = 'GitHub') {
  const vaultId = opened.vaults[0].id
  return createItem(opened.file, opened.session, {
    ...emptyDraft('login', vaultId),
    title,
    username: 'studio26',
    password: 's3cret!',
    urls: ['https://github.com'],
    type: 'login',
    totp: '',
  } as ItemDraft)
}

describe('phrase de récupération', () => {
  it('génère dix mots de la liste EFF', () => {
    const phrase = generateRecoveryPhrase()
    expect(phrase.split(' ')).toHaveLength(RECOVERY_WORDS)
    expect(isRecoveryPhrase(phrase)).toBe(true)
    expect(phrase).toBe(phrase.toLowerCase())
  })

  it('normalise la casse et les espaces', () => {
    expect(normalizeRecoveryPhrase('  Abacus   ABDOMEN\nabdominal ')).toBe(
      'abacus abdomen abdominal',
    )
    expect(isRecoveryPhrase('trop court')).toBe(false)
  })
})

describe('enveloppe de récupération', () => {
  it('active une enveloppe et la relit après sérialisation', async () => {
    const opened = await freshVault()
    const withItem = await addLogin(opened)
    const file = await enableRecovery(withItem.file, opened.session, PHRASE, FAST_KDF)

    expect(file.version).toBe(3)
    expect(file.recovery?.wraps).toHaveLength(1)
    expect(opened.session.hasRecoveryKey).toBe(true)

    const text = serializeVault(file)
    expect(text).not.toContain('abacus abdomen')
    const parsed = parseVaultFile(JSON.parse(text))
    expect(parsed.recovery?.version).toBe(1)

    const unlocked = await unlockVaultFile(parsed, PASSWORD)
    expect(unlocked.items).toHaveLength(1)
    expect(unlocked.session.hasRecoveryKey).toBe(true)
    unlocked.session.lock()
  })

  it('refuse une enveloppe incomplète', async () => {
    const opened = await freshVault()
    const file = await enableRecovery(opened.file, opened.session, PHRASE, FAST_KDF)
    expect(() =>
      parseVaultFile({
        ...file,
        recovery: { ...file.recovery, wraps: [] },
      }),
    ).toThrow(VaultValidationError)
  })

  it('récupère le coffre et impose un nouveau mot de passe', async () => {
    const opened = await freshVault()
    const withItem = await addLogin(opened)
    const file = await enableRecovery(withItem.file, opened.session, PHRASE, FAST_KDF)

    const recovered = await recoverVaultFile(
      parseVaultFile(JSON.parse(serializeVault(file))),
      PHRASE,
      NEW_PASSWORD,
      FAST_KDF,
    )
    expect(recovered.items).toHaveLength(1)
    expect((recovered.items[0] as LoginItem).password).toBe('s3cret!')

    await expect(unlockVaultFile(recovered.file, PASSWORD)).rejects.toThrow(
      WrongPasswordError,
    )
    const reopened = await unlockVaultFile(recovered.file, NEW_PASSWORD)
    expect(reopened.items).toHaveLength(1)
    reopened.session.lock()
    recovered.session.lock()

    // La phrase reste valable après le changement de mot de passe.
    const again = await recoverVaultFile(
      recovered.file,
      PHRASE,
      'troisième phrase de passe solide',
      FAST_KDF,
    )
    expect(again.items).toHaveLength(1)
    again.session.lock()
  })

  it('refuse une phrase incorrecte', async () => {
    const opened = await freshVault()
    const file = await enableRecovery(opened.file, opened.session, PHRASE, FAST_KDF)
    await expect(
      recoverVaultFile(
        file,
        'abacus abdomen abdominal abide abiding ability abject ablaze abound abort',
        NEW_PASSWORD,
        FAST_KDF,
      ),
    ).rejects.toThrow(VaultValidationError)
  })

  it('couvre les coffres ajoutés et oublie les coffres supprimés', async () => {
    const opened = await freshVault()
    const file = await enableRecovery(opened.file, opened.session, PHRASE, FAST_KDF)

    const added = await addVault(file, opened.session, 'Travail')
    expect(added.file.recovery?.wraps).toHaveLength(2)

    const removed = await deleteVault(added.file, opened.session, added.vault.id)
    expect(removed.recovery?.wraps).toHaveLength(1)
    expect(removed.recovery?.wraps[0].vaultId).toBe(opened.vaults[0].id)

    const recovered = await recoverVaultFile(removed, PHRASE, NEW_PASSWORD, FAST_KDF)
    expect(recovered.vaults).toHaveLength(1)
    recovered.session.lock()
    opened.session.lock()
  })

  it('maintient la phrase après un changement de mot de passe', async () => {
    const opened = await freshVault()
    const file = await enableRecovery(opened.file, opened.session, PHRASE, FAST_KDF)
    const changed = await changeMasterPassword(
      file,
      opened.session,
      NEW_PASSWORD,
      FAST_KDF,
    )

    const recovered = await recoverVaultFile(
      changed,
      PHRASE,
      'encore une autre phrase solide',
      FAST_KDF,
    )
    expect(recovered.items).toHaveLength(0)
    recovered.session.lock()
  })

  it('supprime l’enveloppe et rend la phrase inutile', async () => {
    const opened = await freshVault()
    const file = await enableRecovery(opened.file, opened.session, PHRASE, FAST_KDF)
    const removed = disableRecovery(file, opened.session)

    expect(removed.recovery).toBeUndefined()
    expect(opened.session.hasRecoveryKey).toBe(false)
    await expect(
      recoverVaultFile(removed, PHRASE, NEW_PASSWORD, FAST_KDF),
    ).rejects.toThrow(VaultValidationError)
  })

  it('refuse la récupération si aucune phrase n’est configurée', async () => {
    const opened = await freshVault()
    await expect(
      recoverVaultFile(opened.file, PHRASE, NEW_PASSWORD, FAST_KDF),
    ).rejects.toThrow(VaultValidationError)
  })
})
