import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault, openSettings } from './helpers'

test('partage un élément hors ligne puis l’importe avec la clé séparée', async ({
  page,
}) => {
  await createVault(page)
  const panel = await addLogin(page, 'Compte partagé')

  await panel.getByRole('button', { name: 'Plus d’actions' }).click()
  await page.getByRole('menuitem', { name: 'Partager hors ligne' }).click()

  const shareDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Partager hors ligne', level: 2 }),
  })
  await expect(shareDialog).toBeVisible()
  await shareDialog.getByRole('button', { name: 'Générer le partage' }).click()

  const keyWords = await shareDialog
    .locator('.offline-share__word-groups code')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? '').join(' ').trim())
  expect(keyWords.split(/\s+/).length).toBeGreaterThan(15)
  await expect(shareDialog.locator('.offline-share__qr img')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await shareDialog.getByRole('button', { name: 'Télécharger le fichier' }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).not.toBeNull()
  const shareContent = await readFile(path!, 'utf8')
  expect(shareContent).toContain('"format": "coffre-share"')
  expect(shareContent).not.toContain('s3cret!')

  await shareDialog.locator('.modal__footer').getByRole('button', { name: 'Fermer' }).click()
  await closeDialog(page)

  const settings = await openSettings(page, 'Sauvegarde et import')
  const shareSection = settings.locator('.settings-section').filter({
    hasText: 'Importer un partage hors ligne',
  })
  await shareSection.locator('input[type="file"]').setInputFiles({
    name: 'partage.coffre-share',
    mimeType: 'application/json',
    buffer: Buffer.from(shareContent, 'utf8'),
  })
  await shareSection.getByLabel('Clé de partage').fill(keyWords)
  await shareSection.getByRole('button', { name: 'Importer le partage' }).click()

  await expect(settings.getByText(/1 élément importé/)).toBeVisible()
  await closeDialog(page)

  await expect(
    page.locator('.item-row').filter({ hasText: 'Compte partagé' }),
  ).toHaveCount(2)
})
