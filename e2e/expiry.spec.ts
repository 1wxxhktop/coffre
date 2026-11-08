import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault } from './helpers'

function localIsoDate(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

test('signale une échéance proche et la retrouve dans la vue dédiée', async ({ page }) => {
  await createVault(page)
  const dialog = await addLogin(page)

  await dialog.getByRole('button', { name: 'Modifier' }).click()
  await dialog.getByLabel('Rappel d’échéance').fill(localIsoDate(15))
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()

  await expect(dialog.getByText('Mot de passe à changer')).toBeVisible()
  await expect(dialog.locator('.expiry-badge')).toContainText('J-15')
  await closeDialog(page)

  const sidebar = page.locator('.sidebar')
  const expiringFilter = sidebar.getByRole('button', { name: /^Bientôt expirés/ })
  await expect(expiringFilter).toContainText('1')
  await expiringFilter.click()

  await expect(page.getByRole('heading', { name: 'Bientôt expirés' })).toBeVisible()
  const row = page.locator('.item-row').filter({ hasText: 'GitHub' })
  await expect(row).toBeVisible()
  await expect(row.locator('.expiry-badge')).toContainText('J-15')

  // Une échéance passée reste visible avec un ton d’alerte.
  await row.click()
  await page.getByRole('button', { name: 'Modifier' }).click()
  await page.getByLabel('Rappel d’échéance').fill(localIsoDate(-2))
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.locator('.detail-pane .expiry-badge')).toContainText('Expiré')
  await closeDialog(page)
})

test('enregistre l’expiration d’un document d’identité', async ({ page }) => {
  await createVault(page)
  await page.getByRole('button', { name: 'Nouvel élément' }).click()
  const form = page.getByRole('dialog')
  await form.locator('.type-picker__item').filter({ hasText: 'Identité' }).click()
  await form.getByLabel('Titre', { exact: true }).fill('Passeport')
  await form.getByLabel('Expiration du passeport').fill(localIsoDate(20))
  await form.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.locator('.item-row').filter({ hasText: 'Passeport' })).toBeVisible()

  await page.locator('.sidebar').getByRole('button', { name: /^Bientôt expirés/ }).click()
  const row = page.locator('.item-row').filter({ hasText: 'Passeport' })
  await expect(row).toBeVisible()
  await expect(row.locator('.expiry-badge')).toContainText('J-20')
})
