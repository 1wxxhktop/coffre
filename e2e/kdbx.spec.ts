import { expect, test } from '@playwright/test'
import { PASSWORD, addLogin, closeDialog, createVault, openSettings } from './helpers'

test('exporte un coffre en KDBX 4 puis le réimporte', async ({ page }, testInfo) => {
  await createVault(page)
  await addLogin(page, 'Compte KDBX')
  await closeDialog(page)

  let settings = await openSettings(page, 'Sauvegarde et import')
  await settings.getByRole('button', { name: 'Exporter en KDBX' }).click()

  const exportDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Exporter en KDBX', level: 2 }),
  })
  await exportDialog.getByLabel('Mot de passe maître').fill(PASSWORD)
  await exportDialog.getByLabel('Mot de passe KDBX').fill('mot de passe kdbx')
  await exportDialog.getByLabel('Confirmer le mot de passe').fill('mot de passe kdbx')

  const downloadPromise = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: 'Exporter', exact: true }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).not.toBeNull()
  const exportPath = testInfo.outputPath('coffre.kdbx')
  await download.saveAs(exportPath)
  await expect(exportDialog).toHaveCount(0)

  await closeDialog(page)

  settings = await openSettings(page, 'Sauvegarde et import')
  const importSection = settings.locator('.settings-section').filter({
    hasText: 'Importer une base KeePass',
  })
  await importSection
    .locator('input[type="file"][accept*=".kdbx"]')
    .setInputFiles(exportPath)
  await importSection.getByLabel('Mot de passe KDBX').fill('mot de passe kdbx')
  await importSection.getByRole('button', { name: 'Importer la base KDBX' }).click()

  await expect(settings.getByText(/1 élément importé/)).toBeVisible({
    timeout: 45_000,
  })
  await closeDialog(page)

  await expect(page.locator('.item-row').filter({ hasText: 'Compte KDBX' })).toHaveCount(2)
})
