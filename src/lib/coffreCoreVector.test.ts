import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  listItemVersions,
  openAttachment,
  parseVaultFileText,
  unlockVaultFile,
  verifyVaultFile,
} from './vault'
import type { LoginItem } from './types'

const PASSWORD = 'phrase de passe de test solide'

describe('vecteur produit par coffre-core', () => {
  it('ouvre le fichier Rust, vérifie le MAC et déchiffre tous les contenus', async () => {
    const path = fileURLToPath(
      new URL('../../test-vectors/rust-v4.coffre.json', import.meta.url),
    )
    const file = parseVaultFileText(readFileSync(path, 'utf8'))
    expect(file.version).toBe(4)
    expect(file.integrity?.mac).toBeTruthy()

    const opened = await unlockVaultFile(file, PASSWORD)
    expect(opened.integrity).toBe('valid')
    expect(opened.readOnly).toBe(false)
    expect(opened.vaults[0].name).toBe('Vecteur Rust')
    expect(opened.items).toHaveLength(1)

    const item = opened.items[0] as LoginItem
    expect(item.password).toBe('s3cret-rust!')
    expect(item.urls).toEqual(['https://rust.example'])

    const attachment = await openAttachment(
      opened.file,
      opened.session,
      item,
      'att_rust_vector',
    )
    expect(new TextDecoder().decode(attachment.bytes)).toBe('rust-attachment')

    const versions = await listItemVersions(
      opened.file,
      opened.session,
      item.id,
    )
    expect(versions).toHaveLength(1)
    expect((versions[0].content as LoginItem).password).toBe('old-rust')

    const report = await verifyVaultFile(opened.file, opened.session)
    expect(report).toMatchObject({
      vaults: 1,
      items: 1,
      attachments: 1,
      versions: 1,
    })
    opened.session.lock()
  })
})
