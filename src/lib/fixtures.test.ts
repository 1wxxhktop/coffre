import { describe, expect, it } from 'vitest'
import {
  listItemVersions,
  parseVaultFile,
  recoverVaultFile,
  unlockVaultFile,
  verifyVaultFile,
} from './vault'
import type { LoginItem } from './types'

const PASSWORD = 'phrase de passe de test solide'
const RECOVERY_PHRASE =
  'abacus abdomen abdominal abide abiding ability abject ablaze abode abort'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

/** Contenu brut des fichiers figés, lu par Vite (aucun accès disque manuel). */
const FIXTURES = import.meta.glob('./__fixtures__/*.coffre.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function loadFixture(name: string): unknown {
  const content = FIXTURES[`./__fixtures__/${name}`]
  if (!content) throw new Error(`Jeu d’essai introuvable : ${name}`)
  return JSON.parse(content)
}

/**
 * Jeux d’essai figés : ils garantissent qu’un fichier produit par une version
 * antérieure reste lisible. Ne jamais les régénérer, seulement en ajouter.
 */
describe('compatibilité des fichiers figés', () => {
  it('lit un fichier v1, le migre en v3 et le déverrouille', async () => {
    const parsed = parseVaultFile(loadFixture('v1.coffre.json'))
    expect(parsed.version).toBe(3)
    expect(parsed.versions).toEqual([])
    expect(parsed.items).toHaveLength(2)

    const opened = await unlockVaultFile(parsed, PASSWORD)
    expect(opened.items).toHaveLength(2)
    expect(opened.vaults[0].name).toBe('Ancien format')
    expect(opened.vaults[0].itemCount).toBe(2)
    expect(opened.items.every((item) => item.deletedAt === null)).toBe(true)

    const login = opened.items.find((item) => item.title === 'GitHub') as LoginItem
    expect(login.password).toBe('s3cret!')
    expect(login.urls).toEqual(['https://github.com'])

    const report = await verifyVaultFile(parsed, opened.session)
    expect(report).toMatchObject({ vaults: 1, items: 2, versions: 0 })
    opened.session.lock()
  })

  it('lit un fichier v2 avec historique et corbeille', async () => {
    const parsed = parseVaultFile(loadFixture('v2.coffre.json'))
    expect(parsed.version).toBe(3)
    expect(parsed.versions).toHaveLength(2)

    const opened = await unlockVaultFile(parsed, PASSWORD)
    expect(opened.items).toHaveLength(2)
    expect(opened.vaults[0].itemCount).toBe(1)

    const active = opened.items.find((item) => item.title === 'GitHub') as LoginItem
    expect(active.password).toBe('s3cret-v3!')
    expect(active.deletedAt).toBeNull()

    const trashed = opened.items.find((item) => item.title === 'Ancien compte')
    expect(trashed?.deletedAt).not.toBeNull()

    const versions = await listItemVersions(parsed, opened.session, active.id)
    expect(versions).toHaveLength(2)
    expect((versions[0].content as LoginItem).password).toBe('s3cret-v2!')
    expect((versions[1].content as LoginItem).password).toBe('s3cret!')

    const report = await verifyVaultFile(parsed, opened.session)
    expect(report).toMatchObject({ vaults: 1, items: 2, versions: 2 })
    opened.session.lock()
  })

  it('lit un fichier v3 et le déverrouille par phrase', async () => {
    const parsed = parseVaultFile(loadFixture('v3.coffre.json'))
    expect(parsed.version).toBe(3)
    expect(parsed.recovery?.wraps).toHaveLength(1)

    const unlocked = await unlockVaultFile(parsed, PASSWORD)
    expect(unlocked.items).toHaveLength(1)
    unlocked.session.lock()

    const recovered = await recoverVaultFile(
      parsed,
      RECOVERY_PHRASE,
      'mot de passe récupéré solide',
      FAST_KDF,
    )
    expect(recovered.items).toHaveLength(1)
    expect((recovered.items[0] as LoginItem).password).toBe('s3cret!')
    recovered.session.lock()
  })

  it('refuse un fichier figé altéré', async () => {
    const parsed = parseVaultFile(loadFixture('v2.coffre.json'))
    const tampered = {
      ...parsed,
      versions: [
        { ...parsed.versions[0], content: { ...parsed.versions[0].content, c: 'AAAA' } },
      ],
    }

    const opened = await unlockVaultFile(parsed, PASSWORD)
    await expect(verifyVaultFile(tampered, opened.session)).rejects.toThrow()
    opened.session.lock()
  })
})
