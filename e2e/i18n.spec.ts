import { expect, test } from '@playwright/test'
import { closeDialog, createVault, openSettings, PASSWORD } from './helpers'

test('change la langue et affiche l’écran de déverrouillage en anglais', async ({
  page,
}) => {
  await createVault(page)
  const settings = await openSettings(page, 'Général')

  const languageSection = settings.locator('.settings-section').filter({
    hasText: 'Langue',
  })
  await languageSection.locator('select').selectOption('en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  await closeDialog(page)
  await page.getByRole('button', { name: 'Lock' }).first().click()

  await expect(page.getByRole('heading', { name: 'Unlock' })).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible()
  await expect(page.getByText('Your secrets')).toBeVisible()

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New item' })).toBeVisible({
    timeout: 45_000,
  })
})
