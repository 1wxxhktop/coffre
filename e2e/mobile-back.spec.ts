import { expect, test } from '@playwright/test'
import { addLogin, createVault } from './helpers'

declare global {
  interface Window {
    __coffreHandleBack?: () => boolean
  }
}

test('le retour ferme les couches avant de quitter', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await createVault(page)

  // Détail d’un élément.
  await addLogin(page)
  await expect(page.locator('.item-panel')).toBeVisible()
  expect(await page.evaluate(() => window.__coffreHandleBack?.())).toBe(true)
  await expect(page.locator('.item-panel')).toHaveCount(0)
  await expect(page.locator('.mobile-tabs')).toBeVisible()

  // Tiroir de navigation.
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click()
  await expect(page.locator('.sidebar')).not.toHaveAttribute('inert', '')
  expect(await page.evaluate(() => window.__coffreHandleBack?.())).toBe(true)
  await expect(page.locator('.sidebar')).toHaveAttribute('inert', '')

  // Réglages en plein écran.
  await page
    .locator('.mobile-tabs')
    .getByRole('button', { name: 'Réglages', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => window.__coffreHandleBack?.())).toBe(true)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Liste -> accueil, puis accueil -> sortie demandée au natif.
  expect(await page.evaluate(() => window.__coffreHandleBack?.())).toBe(true)
  await expect(page.locator('.dashboard')).toBeVisible()
  expect(await page.evaluate(() => window.__coffreHandleBack?.())).toBe(false)
})
