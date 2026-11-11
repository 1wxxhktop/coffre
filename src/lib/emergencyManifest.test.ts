import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  changeMasterPassword,
  computeManifest,
  createVaultFile,
  enableRecovery,
  recoverVaultFile,
  signVaultFile,
  unlockVaultFile,
  verifyVaultFile,
} from './vault'
import {
  assertEmergencyRecordContacts,
  createEmergencyRecord,
  resealEmergencyRecord,
} from './emergencyVault'
import {
  generateSharingIdentity,
  publicSharingIdentity,
  type SharingIdentity,
} from './sharing'
import { hmacSha256, toBase64, utf8, wipe } from './crypto'
import type { EmergencyImmediateRecord, VaultFile } from './types'

const PASSWORD = 'phrase de passe de test solide'
const NEW_PASSWORD = 'nouvelle phrase de passe solide'
const PHRASE = 'abacus abdomen abdominal abide abiding ability abject ablaze abode abort'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

async function vaultWithEmergency(): Promise<{
  file: VaultFile
  contact: SharingIdentity
  emergency: EmergencyImmediateRecord
  session: Awaited<ReturnType<typeof createVaultFile>>['session']
}> {
  const opened = await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
  const contact = await generateSharingIdentity()
  const emergency = await createEmergencyRecord(
    opened.session.masterKey,
    publicSharingIdentity(contact),
  )
  const signed = await signVaultFile(
    { ...opened.file, emergency },
    opened.session,
    opened.file,
  )
  return { file: signed, contact, emergency, session: opened.session }
}

function swapEncryptionKey(
  file: VaultFile,
  encryptionPublicKey: string,
): VaultFile {
  const emergency = file.emergency as EmergencyImmediateRecord
  return {
    ...file,
    emergency: {
      ...emergency,
      contact: { ...emergency.contact, encryptionPublicKey },
    },
  }
}

/** Recalcule un MAC de manifeste 2 pour simuler un fichier signé avant 0.13. */
async function withLegacyManifest2(
  file: VaultFile,
  integrityKey: Uint8Array,
): Promise<VaultFile> {
  const manifest = await computeManifest(file, 2)
  const bytes = utf8(canonicalJson(manifest))
  try {
    const mac = await hmacSha256(integrityKey, bytes)
    return {
      ...file,
      integrity: {
        ...(file.integrity as NonNullable<VaultFile['integrity']>),
        mac: toBase64(mac),
      },
    }
  } finally {
    wipe(bytes)
  }
}

describe('accès d’urgence : manifeste 3', () => {
  it('couvre les clés publiques du contact, pas seulement son empreinte', async () => {
    const { file, session } = await vaultWithEmergency()
    const other = await generateSharingIdentity()
    const tampered = swapEncryptionKey(
      file,
      other.encryptionPublicKey,
    )

    const v3 = await computeManifest(file, 3)
    const tamperedV3 = await computeManifest(tampered, 3)
    const original = v3.records.find((record) => record.type === 'emergency')
    const changed = tamperedV3.records.find((record) => record.type === 'emergency')
    expect(original?.ciphertext).not.toBe(changed?.ciphertext)

    // Le manifeste 2 ne couvrait que l’empreinte et le ciphertext : le swap
    // restait invisible. C’est précisément le défaut corrigé.
    const v2 = await computeManifest(file, 2)
    const tamperedV2 = await computeManifest(tampered, 2)
    expect(
      tamperedV2.records.find((record) => record.type === 'emergency')
        ?.ciphertext,
    ).toBe(v2.records.find((record) => record.type === 'emergency')?.ciphertext)

    session.lock()
  })

  it('refuse un fichier manifeste 3 dont la clé d’urgence a été remplacée', async () => {
    const { file, contact, session } = await vaultWithEmergency()
    const other = await generateSharingIdentity()
    const tampered = swapEncryptionKey(file, other.encryptionPublicKey)

    const opened = await unlockVaultFile(tampered, PASSWORD)
    expect(opened.integrity).toBe('invalid')
    expect(opened.readOnly).toBe(true)
    expect(opened.warnings.join(' ')).toMatch(/urgence|MAC global invalide/)
    opened.session.lock()

    await expect(
      changeMasterPassword(tampered, session, NEW_PASSWORD, FAST_KDF),
    ).rejects.toThrow()

    // Le contact d’origine reste valide : le refus vient bien de l’identité
    // remplacée, pas d’une validation trop stricte.
    await expect(
      assertEmergencyRecordContacts({
        ...(tampered.emergency as EmergencyImmediateRecord),
        contact: publicSharingIdentity(contact),
      }),
    ).resolves.toBeUndefined()
    session.lock()
  })

  it('protège aussi les anciens fichiers signés en manifeste 2', async () => {
    const { file, session } = await vaultWithEmergency()
    const other = await generateSharingIdentity()
    const legacy = await withLegacyManifest2(file, session.integrityKey())
    const tampered = swapEncryptionKey(legacy, other.encryptionPublicKey)

    const opened = await unlockVaultFile(tampered, PASSWORD)
    expect(opened.integrity).toBe('invalid')
    expect(opened.readOnly).toBe(true)
    expect(opened.warnings.join(' ')).toContain('urgence')
    await expect(verifyVaultFile(tampered, opened.session)).rejects.toThrow(
      /urgence/,
    )
    opened.session.lock()
    session.lock()
  })

  it('refuse de reseeller une identité d’urgence incohérente', async () => {
    const { file, session } = await vaultWithEmergency()
    const other = await generateSharingIdentity()
    const tampered = swapEncryptionKey(file, other.encryptionPublicKey)

    await expect(
      resealEmergencyRecord(
        tampered.emergency as EmergencyImmediateRecord,
        new Uint8Array(32).fill(7),
      ),
    ).rejects.toThrow(/empreinte|partage/i)
    session.lock()
  })

  it('conserve un accès d’urgence valide lors d’un changement de mot de passe', async () => {
    const { file, contact, session } = await vaultWithEmergency()
    const draft = await changeMasterPassword(
      file,
      session,
      NEW_PASSWORD,
      FAST_KDF,
    )
    const rotated = await signVaultFile(draft, session, file)

    const reopened = await unlockVaultFile(rotated, NEW_PASSWORD)
    expect(reopened.integrity).toBe('valid')
    expect(reopened.readOnly).toBe(false)
    const emergency = reopened.file.emergency as EmergencyImmediateRecord
    expect(emergency.contact.fingerprint).toBe(contact.fingerprint)
    await expect(
      assertEmergencyRecordContacts(emergency),
    ).resolves.toBeUndefined()
    reopened.session.lock()
    session.lock()
  })

  it('retire un accès d’urgence incohérent lors d’une récupération', async () => {
    const opened = await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
    const withRecoveryDraft = await enableRecovery(
      opened.file,
      opened.session,
      PHRASE,
      FAST_KDF,
    )
    const withRecovery = await signVaultFile(
      withRecoveryDraft,
      opened.session,
      opened.file,
    )

    const contact = await generateSharingIdentity()
    const emergency = await createEmergencyRecord(
      opened.session.masterKey,
      publicSharingIdentity(contact),
    )
    const signed = await signVaultFile(
      { ...withRecovery, emergency },
      opened.session,
      withRecovery,
    )
    const other = await generateSharingIdentity()
    const tampered = swapEncryptionKey(signed, other.encryptionPublicKey)

    const recovered = await recoverVaultFile(
      tampered,
      PHRASE,
      NEW_PASSWORD,
      FAST_KDF,
    )
    expect(recovered.integrity).toBe('valid')
    expect(recovered.file.emergency).toBeUndefined()
    expect(recovered.warnings.join(' ')).toContain('urgence')
    recovered.session.lock()
    opened.session.lock()
  })
})
