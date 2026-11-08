import { describe, expect, it } from 'vitest'
import {
  createTemplate,
  createVaultFile,
  deleteTemplate,
  openVaultFileWithMasterKey,
  signVaultFile,
  updateTemplate,
} from './vault'
import { mergeVaultFiles } from './sync'
import type { TemplateField } from './types'

const PASSWORD = 'phrase de passe de test solide'
const FAST_KDF = { memoryKiB: 8_192, iterations: 1, parallelism: 1 }

function fields(): TemplateField[] {
  return [
    { id: 'tf1', label: 'Compte', type: 'text', required: true, fillable: true },
    { id: 'tf2', label: 'Clé', type: 'secret' },
    { id: 'tf3', label: 'Site', type: 'url', fillable: true },
  ]
}

describe('modèles d’éléments', () => {
  it('chiffre, relit, modifie et supprime un modèle', async () => {
    const opened = await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
    const created = await createTemplate(opened.file, opened.session, {
      name: 'Serveur',
      icon: '🖥️',
      fields: fields(),
    })
    const signed = await signVaultFile(created.file, opened.session, opened.file)

    const reopened = await openVaultFileWithMasterKey(signed, opened.session.masterKey)
    expect(reopened.templates).toHaveLength(1)
    expect(reopened.templates[0]).toMatchObject({
      id: created.template.id,
      name: 'Serveur',
      icon: '🖥️',
      fields: [
        expect.objectContaining({ label: 'Compte', type: 'text', fillable: true }),
        expect.objectContaining({ label: 'Clé', type: 'secret' }),
        expect.objectContaining({ label: 'Site', type: 'url' }),
      ],
    })
    expect(JSON.stringify(signed)).not.toContain('Serveur')
    reopened.session.lock()

    const updated = await updateTemplate(
      signed,
      opened.session,
      created.template.id,
      { name: 'Serveur SSH', icon: '🔐', fields: fields().slice(0, 2) },
    )
    const signedUpdate = await signVaultFile(updated.file, opened.session, signed)
    const reopenedUpdate = await openVaultFileWithMasterKey(
      signedUpdate,
      opened.session.masterKey,
    )
    expect(reopenedUpdate.templates[0].name).toBe('Serveur SSH')
    expect(reopenedUpdate.templates[0].fields).toHaveLength(2)
    reopenedUpdate.session.lock()

    const deleted = deleteTemplate(signedUpdate, created.template.id)
    const signedDelete = await signVaultFile(deleted, opened.session, signedUpdate)
    const reopenedDelete = await openVaultFileWithMasterKey(
      signedDelete,
      opened.session.masterKey,
    )
    expect(reopenedDelete.templates).toEqual([])
    expect(
      reopenedDelete.file.tombstones?.some(
        (tombstone) =>
          tombstone.kind === 'template' && tombstone.id === created.template.id,
      ),
    ).toBe(true)
    reopenedDelete.session.lock()
    opened.session.lock()
  })

  it('fusionne et supprime les modèles entre appareils', async () => {
    const opened = await createVaultFile(PASSWORD, 'Personnel', FAST_KDF)
    const base = await signVaultFile(opened.file, opened.session, opened.file)
    const created = await createTemplate(base, opened.session, {
      name: 'Serveur',
      fields: fields(),
    })
    const withTemplate = await signVaultFile(created.file, opened.session, base)

    const merged = mergeVaultFiles(withTemplate, [base])
    expect(merged.file.templates).toHaveLength(1)
    expect(merged.conflicts).toEqual([])

    const deleted = await signVaultFile(
      deleteTemplate(withTemplate, created.template.id),
      opened.session,
      withTemplate,
    )
    const mergedDelete = mergeVaultFiles(deleted, [withTemplate])
    expect(mergedDelete.file.templates).toEqual([])
    opened.session.lock()
  })
})
