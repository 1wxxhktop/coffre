import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault } from './helpers'

async function createTwoLogins(page: import('@playwright/test').Page): Promise<void> {
  await createVault(page)
  await addLogin(page, 'Alpha', 'ada', 'mot-de-passe-alpha')
  await closeDialog(page)
  await addLogin(page, 'Beta', 'grace', 'mot-de-passe-beta')
  await closeDialog(page)
}

test('sélectionne plusieurs éléments et les met à la corbeille', async ({ page }) => {
  await createTwoLogins(page)

  await page.getByRole('button', { name: 'Sélectionner' }).click()
  await page.locator('.item-row').filter({ hasText: 'Alpha' }).click()
  await expect(page.locator('.item-row').filter({ hasText: 'Alpha' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.locator('.item-row').filter({ hasText: 'Beta' }).click()
  await expect(page.locator('.bulk-bar')).toContainText('2 sélectionnés')

  const bulk = page.locator('.bulk-bar')
  await bulk.getByRole('button', { name: 'Corbeille' }).click()
  const confirm = page.getByRole('dialog')
  await expect(confirm.getByRole('heading', { name: /Mettre 2 éléments/ })).toBeVisible()
  await confirm.getByRole('button', { name: 'Mettre à la corbeille' }).click()

  await expect(page.getByText(/2 éléments déplacés dans la corbeille/)).toBeVisible()
  await page.locator('.sidebar').getByRole('button', { name: /Corbeille/ }).click()
  await expect(page.locator('.item-row')).toHaveCount(2)
})

test('ajoute plusieurs éléments aux favoris', async ({ page }) => {
  await createTwoLogins(page)

  await page.getByRole('button', { name: 'Sélectionner' }).click()
  await page.locator('.item-row').filter({ hasText: 'Alpha' }).click()
  await page.locator('.item-row').filter({ hasText: 'Beta' }).click()
  await page.locator('.bulk-bar').getByRole('button', { name: 'Ajouter aux favoris' }).click()

  await expect(page.locator('.item-row__favorite')).toHaveCount(2)
})
