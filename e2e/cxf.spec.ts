import { expect, test } from '@playwright/test'
import { PASSWORD, addLogin, closeDialog, createVault, openSettings } from './helpers'

test('exporte en CXF puis réimporte le fichier', async ({ page }, testInfo) => {
  await createVault(page)
  await addLogin(page, 'Compte CXF')
  await closeDialog(page)

  let settings = await openSettings(page, 'Sauvegarde et import')
  await settings.getByRole('button', { name: 'Exporter en CXF' }).click()

  const exportDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Exporter en CXF', level: 2 }),
  })
  await exportDialog.getByLabel('Mot de passe maître').fill(PASSWORD)
  await exportDialog.getByRole('checkbox').check()

  const downloadPromise = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: 'Exporter le fichier CXF' }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).not.toBeNull()
  const exportPath = testInfo.outputPath('coffre.cxf.json')
  await download.saveAs(exportPath)
  await closeDialog(page)

  settings = await openSettings(page, 'Sauvegarde et import')
  const importSection = settings.locator('.settings-section').filter({
    hasText: 'Importer depuis un autre gestionnaire',
  })
  await importSection
    .locator('input[type="file"][accept*=".cxf"]')
    .setInputFiles(exportPath)

  await expect(importSection.getByText(/élément détecté/)).toBeVisible()
  const skipDuplicates = importSection.getByRole('checkbox', {
    name: /Ignorer les doublons/,
  })
  if (await skipDuplicates.isChecked()) await skipDuplicates.uncheck()
  await importSection.getByRole('button', { name: /Importer 1 élément/ }).click()
  await expect(settings.getByText(/1 élément ajouté au coffre/)).toBeVisible()
  await closeDialog(page)

  await expect(page.locator('.item-row').filter({ hasText: 'Compte CXF' })).toHaveCount(2)
})
