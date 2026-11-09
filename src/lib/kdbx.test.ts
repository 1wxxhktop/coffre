import { describe, expect, it } from 'vitest'
import fixtureBase64 from './__fixtures__/NewDatabaseBrowser.kdbx.b64?raw'
import { KdbxError, readKdbx, writeKdbx } from './kdbx'
import type { LoginItem, NoteItem, RecoveryCodesItem, VaultItem } from './types'

const NOW = '2026-11-08T10:00:00.000Z'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

function login(overrides: Partial<LoginItem> = {}): LoginItem {
  return {
    id: 'i_login',
    vaultId: 'v1',
    type: 'login',
    title: 'GitHub',
    favorite: false,
    notes: 'Compte principal',
    tags: ['dev'],
    customFields: [
      { id: 'f1', label: 'Clé API', value: 'abc-123', type: 'hidden' },
    ],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: NOW,
    updatedAt: NOW,
    username: 'ada',
    password: 's3cret!',
    urls: ['https://github.com'],
    totp: 'otpauth://totp/GitHub?secret=JBSWY3DPEHPK3PXP',
    ...overrides,
  }
}

function recoveryCodes(): RecoveryCodesItem {
  return {
    id: 'i_recovery',
    vaultId: 'v1',
    type: 'recovery-codes',
    title: 'Codes GitHub',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: NOW,
    updatedAt: NOW,
    codes: [
      { id: 'rc_1', code: 'AAAA-BBBB', usedAt: null },
      { id: 'rc_2', code: 'CCCC-DDDD', usedAt: '2026-11-09T10:00:00.000Z' },
    ],
  }
}

function note(overrides: Partial<NoteItem> = {}): NoteItem {
  return {
    id: 'i_note',
    vaultId: 'v1',
    type: 'note',
    title: 'Note interne',
    favorite: false,
    notes: 'Contenu de la note',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    expiresAt: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('KDBX 4', () => {
  it('exporte les codes de secours dans un champ protégé', async () => {
    const bytes = await writeKdbx({
      password: 'mot de passe KDBX',
      items: [recoveryCodes()],
      vaultNames: new Map([['v1', 'Personnel']]),
      databaseName: 'Test Coffre',
      kdf: FAST_KDF,
    })
    const result = await readKdbx(bytes, 'mot de passe KDBX', 'v_import')
    const imported = result.items[0]
    expect(imported.notes).toBe('')
    expect(
      imported.customFields.find((field) => field.label === 'Codes de secours'),
    ).toMatchObject({
      type: 'hidden',
      value: expect.stringContaining('AAAA-BBBB'),
    })
  })

  it('exporte puis relit les éléments, champs protégés et TOTP', async () => {
    const bytes = await writeKdbx({
      password: 'mot de passe KDBX',
      items: [login(), note()],
      vaultNames: new Map([['v1', 'Personnel']]),
      databaseName: 'Test Coffre',
      kdf: FAST_KDF,
    })
    expect(bytes.length).toBeGreaterThan(100)

    const result = await readKdbx(bytes, 'mot de passe KDBX', 'v_import')
    expect(result.databaseName).toBe('Test Coffre')
    expect(result.items).toHaveLength(2)

    const imported = result.items[0]
    expect(imported).toMatchObject({
      type: 'login',
      title: 'GitHub',
      username: 'ada',
      password: 's3cret!',
      urls: ['https://github.com'],
      totp: 'otpauth://totp/GitHub?secret=JBSWY3DPEHPK3PXP',
      notes: 'Compte principal',
      tags: ['Personnel', 'dev'],
    })
    expect(imported.customFields[0]).toMatchObject({
      label: 'Clé API',
      value: 'abc-123',
      type: 'hidden',
    })
    expect(result.items[1]).toMatchObject({
      type: 'note',
      title: 'Note interne',
      notes: 'Contenu de la note',
    })
  })

  it('lit un fichier KeePassXC réel (KDBX 4, AES-KDF)', async () => {
    const bytes = Uint8Array.from(atob(fixtureBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await readKdbx(bytes, 'a', 'v_import')
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.some((item) => item.title === 'Sample Entry')).toBe(true)
  })

  it('refuse un mot de passe incorrect', async () => {
    const bytes = await writeKdbx({
      password: 'correct',
      items: [login()],
      kdf: FAST_KDF,
    })
    await expect(readKdbx(bytes, 'incorrect', 'v1')).rejects.toThrow(KdbxError)
  })

  it('accepte un fichier de clé binaire', async () => {
    const keyFile = new Uint8Array(32)
    for (let index = 0; index < keyFile.length; index += 1) keyFile[index] = index + 1
    const bytes = await writeKdbx({
      password: 'correct',
      keyFile,
      items: [login()],
      kdf: FAST_KDF,
    })
    const result = await readKdbx(bytes, 'correct', 'v1', keyFile)
    expect(result.items[0].title).toBe('GitHub')

    await expect(readKdbx(bytes, 'correct', 'v1')).rejects.toThrow(KdbxError)
  })

  it('refuse un fichier tronqué', async () => {
    const bytes = await writeKdbx({
      password: 'correct',
      items: [login()],
      kdf: FAST_KDF,
    })
    await expect(readKdbx(bytes.slice(0, 40), 'correct', 'v1')).rejects.toThrow(KdbxError)
  })

  it('refuse un fichier sans élément', async () => {
    await expect(
      writeKdbx({ password: 'correct', items: [] as VaultItem[], kdf: FAST_KDF }),
    ).rejects.toThrow(KdbxError)
  })
})
