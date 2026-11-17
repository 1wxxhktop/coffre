import { expect, test } from '@playwright/test'
import { closeDialog, createVault } from './helpers'

test('conserve les options du générateur pour la prochaine ouverture', async ({ page }) => {
  await createVault(page)
  await page.getByRole('button', { name: 'Générer un mot de passe' }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Générateur' })).toBeVisible()

  // Mot de passe : longueur et classes de caractères.
  const length = dialog.locator('input[type="range"]')
  await expect(length).toHaveValue('20')
  await length.focus()
  await page.keyboard.press('ArrowRight')
  await expect(length).toHaveValue('21')
  await dialog.locator('.toggle').filter({ hasText: 'Symboles' }).click()
  await expect(dialog.getByLabel('Symboles')).not.toBeChecked()

  // Phrase de passe : nombre de mots et capitalisation.
  await dialog.getByRole('tab', { name: 'Phrase de passe' }).click()
  const words = dialog.locator('input[type="range"]')
  await expect(words).toHaveValue('5')
  await words.focus()
  await page.keyboard.press('ArrowRight')
  await expect(words).toHaveValue('6')
  await dialog
    .locator('.toggle')
    .filter({ hasText: 'Majuscule au début de chaque mot' })
    .click()
  await expect(
    dialog.getByLabel('Majuscule au début de chaque mot'),
  ).not.toBeChecked()

  await closeDialog(page)

  // Les mêmes choix sont restaurés à la réouverture.
  await page.getByRole('button', { name: 'Générer un mot de passe' }).click()
  dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('tab', { name: 'Phrase de passe' }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.locator('input[type="range"]')).toHaveValue('6')
  await expect(
    dialog.getByLabel('Majuscule au début de chaque mot'),
  ).not.toBeChecked()

  await dialog.getByRole('tab', { name: 'Mot de passe' }).click()
  await expect(dialog.locator('input[type="range"]')).toHaveValue('21')
  await expect(dialog.getByLabel('Symboles')).not.toBeChecked()
})
