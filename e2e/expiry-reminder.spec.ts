import { expect, test } from '@playwright/test'
import { createVault } from './helpers'

test('active et conserve les rappels d’échéance du mot de passe et d’un champ', async ({
  page,
}) => {
  await createVault(page)
  await page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Nouvel élément' })).toBeVisible()
  await dialog.getByLabel('Titre', { exact: true }).fill('Site avec rappels')

  const passwordReminder = dialog
    .locator('.expiry-reminder')
    .getByRole('checkbox', { name: 'Rappel d’échéance' })
  await expect(passwordReminder).not.toBeChecked()
  await passwordReminder.check()
  await expect(dialog.getByLabel('Date du rappel d’échéance')).not.toHaveValue('')

  await dialog.getByLabel('Ajouter un champ prédéfini').selectOption('IBAN')
  const customField = dialog.locator('.custom-field').first()
  await expect(customField.getByLabel('Nom du champ personnalisé')).toHaveValue('IBAN')
  await expect(customField.getByLabel('Type du champ personnalisé')).toHaveValue(
    'iban',
  )
  await customField
    .getByLabel('Valeur de IBAN')
    .fill('FR76 3000 6000 0112 3456 7890 189')
  const fieldReminder = customField.getByRole('checkbox', {
    name: /Rappel d’échéance/,
  })
  await expect(fieldReminder).not.toBeChecked()
  await fieldReminder.check()
  await expect(
    customField.getByLabel('Date du rappel d’échéance — IBAN'),
  ).not.toHaveValue('')

  await dialog.getByLabel('Mot de passe', { exact: true }).fill('abc123!')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()

  const panel = page.locator('.item-panel')
  await expect(panel.getByRole('heading', { name: 'Site avec rappels' })).toBeVisible()
  await expect(panel.getByText('Mot de passe à changer')).toBeVisible()
  await expect(panel.getByText('IBAN · Rappel d’échéance')).toBeVisible()
  await expect(panel.getByText('FR76 3000 6000 0112 3456 7890 189')).toBeVisible()

  await panel.getByRole('button', { name: 'Modifier' }).click()
  await expect(
    panel
      .locator('.expiry-reminder')
      .getByRole('checkbox', { name: 'Rappel d’échéance' }),
  ).toBeChecked()
  await expect(
    panel
      .locator('.custom-field')
      .first()
      .getByRole('checkbox', { name: /Rappel d’échéance/ }),
  ).toBeChecked()
})
