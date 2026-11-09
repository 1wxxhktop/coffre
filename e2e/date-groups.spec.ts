import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault, sortItems } from './helpers'

test('groupe automatiquement les éléments par date', async ({ page }) => {
  await createVault(page)
  await addLogin(page, 'Alpha')
  await closeDialog(page)
  await addLogin(page, 'Beta')
  await closeDialog(page)

  const groups = page.locator('.item-group')
  await expect(groups).toHaveCount(1)
  await expect(
    groups.first().getByRole('heading', { name: /aujourd’hui/i }),
  ).toBeVisible()

  const rows = groups.first().locator('.item-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Alpha')
  await expect(rows.nth(1)).toContainText('Beta')

  // Le tri choisi s’applique à l’intérieur du groupe.
  await sortItems(page, 'Créés')
  await expect(page.locator('.item-group')).toHaveCount(1)
  await expect(
    page.locator('.item-group').first().getByRole('heading', {
      name: /aujourd’hui/i,
    }),
  ).toBeVisible()

  // L’interrupteur revient à une liste plate.
  await page.getByRole('button', { name: 'Options de la liste' }).click()
  const toggle = page.getByRole('menuitemcheckbox', { name: 'Grouper par date' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(page.locator('.item-group')).toHaveCount(0)
  await expect(page.locator('.item-row')).toHaveCount(2)
})
