import { expect, test } from '@playwright/test'
import { closeDialog, createVault, openSettings } from './helpers'

test('change de thème et conserve le choix après rechargement', async ({ page }) => {
  await createVault(page)
  const settings = await openSettings(page)

  await settings.getByLabel('Apparence').selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await closeDialog(page)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('suit le thème système quand il est sélectionné', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await createVault(page)
  const settings = await openSettings(page)

  await settings.getByLabel('Apparence').selectOption('system')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('démarre en thème clair et bascule depuis l’écran de verrouillage', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Passer en thème sombre' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(
    page.getByRole('button', { name: 'Passer en thème clair' }),
  ).toBeVisible()
})
