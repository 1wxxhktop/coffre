import { expect, test } from '@playwright/test'
import {
  closeDialog,
  createVault,
  openSettings,
  selectItemType,
} from './helpers'

test('formate IBAN, carte, téléphone et code de routage', async ({ page }) => {
  await createVault(page)
  await page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }).click()
  const dialog = page.getByRole('dialog')
  await selectItemType(page, 'Compte et carte')
  await dialog.getByLabel('Titre', { exact: true }).fill('Compte formaté')
  await dialog
    .getByLabel('IBAN', { exact: true })
    .fill('fr7630006000011234567890189')
  await expect(dialog.getByLabel('IBAN', { exact: true })).toHaveValue(
    'FR76 3000 6000 0112 3456 7890 189',
  )
  await dialog.getByLabel('Numéro de carte').fill('4242424242424242')
  await expect(dialog.getByLabel('Numéro de carte')).toHaveValue(
    '4242 4242 4242 4242',
  )
  await dialog.getByLabel('Routing / sort code').fill('123456')
  await expect(dialog.getByLabel('Routing / sort code')).toHaveValue(
    '12-34-56',
  )

  await dialog.getByRole('radio', { name: 'Identité' }).click()
  await dialog.getByLabel('Téléphone').fill('0612345678')
  await expect(dialog.getByLabel('Téléphone')).toHaveValue('06 12 34 56 78')
})

test('le formatage automatique peut être désactivé', async ({ page }) => {
  await createVault(page)
  const settings = await openSettings(page)
  await settings
    .getByRole('checkbox', { name: 'Formater automatiquement les numéros' })
    .uncheck()
  await closeDialog(page)

  await page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }).click()
  const dialog = page.getByRole('dialog')
  await selectItemType(page, 'Compte et carte')
  await dialog
    .getByLabel('IBAN', { exact: true })
    .fill('fr7630006000011234567890189')
  await expect(dialog.getByLabel('IBAN', { exact: true })).toHaveValue(
    'fr7630006000011234567890189',
  )
  await dialog.getByLabel('Numéro de carte').fill('4242424242424242')
  await expect(dialog.getByLabel('Numéro de carte')).toHaveValue(
    '4242424242424242',
  )

  await dialog.getByLabel('Ajouter un champ prédéfini').selectOption('IBAN')
  const customField = dialog.locator('.custom-field').first()
  await customField
    .getByLabel('Valeur de IBAN')
    .fill('fr7630006000011234567890189')
  await expect(customField.getByLabel('Valeur de IBAN')).toHaveValue(
    'fr7630006000011234567890189',
  )
})
