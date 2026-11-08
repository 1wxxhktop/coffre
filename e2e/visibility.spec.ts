import { expect, test, type Page } from '@playwright/test'
import {
  addLogin,
  closeDialog,
  createVault,
  openSettings,
  showItems,
  PASSWORD,
} from './helpers'

/**
 * Simule un passage en arrière-plan. Chromium headless garde tous les onglets
 * visibles, donc on remplace la propriété `document.hidden` puis on émet
 * l’événement natif `visibilitychange`.
 */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => value,
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (value ? 'hidden' : 'visible'),
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

test('verrouille immédiatement lorsque l’onglet passe en arrière-plan', async ({ page }) => {
  await createVault(page)
  await addLogin(page)
  await closeDialog(page)

  await setHidden(page, true)

  await expect(page.getByRole('heading', { name: 'Déverrouiller' })).toBeVisible()
  await expect(page.locator('.item-row')).toHaveCount(0)

  await setHidden(page, false)
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await showItems(page)
  await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible({
    timeout: 45_000,
  })
})

test('respecte la désactivation du verrouillage en arrière-plan', async ({ page }) => {
  await createVault(page)
  await addLogin(page)
  await closeDialog(page)

  const settings = await openSettings(page)
  await settings
    .getByLabel('Verrouiller lorsque l’onglet passe en arrière-plan')
    .uncheck()
  await closeDialog(page)

  await setHidden(page, true)
  await page.waitForTimeout(500)
  await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Déverrouiller' })).toHaveCount(0)

  await setHidden(page, false)
  await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible()
})
