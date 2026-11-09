import { expect, test } from '@playwright/test'
import { addLogin, createVault } from './helpers'

test('distingue les sites avec 2FA, sans 2FA connue et sans HTTPS', async ({ page }) => {
  await createVault(page)
  await addLogin(
    page,
    'GitHub',
    'ada',
    'Très-long-mot-de-passe-aléatoire-42!',
    'https://github.com',
  )
  await page.keyboard.press('Escape')

  await addLogin(
    page,
    'Site inconnu',
    'ada',
    'Autre-très-long-mot-de-passe-2026!',
    'https://example.com',
  )
  await page.keyboard.press('Escape')

  await addLogin(
    page,
    'Site HTTP',
    'ada',
    'Encore-un-autre-mot-de-passe-2026!',
    'http://example.com',
  )
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /^Sécurité/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Sécurité du coffre' })).toBeVisible()

  // GitHub propose une 2FA : une seule alerte, pas deux.
  await expect(
    dialog.locator('.security-category').filter({ hasText: 'Sans 2FA' }),
  ).toContainText('1')
  // GitHub accepte les passkeys.
  await expect(
    dialog.locator('.security-point').filter({ hasText: 'Passkeys disponibles' }),
  ).toContainText('1')
  // Une seule URL HTTP, example.com n’étant pas connu comme proposant une 2FA.
  await expect(
    dialog.locator('.security-point').filter({ hasText: 'Sites sans HTTPS' }),
  ).toContainText('1')
  await page.keyboard.press('Escape')

  await page.locator('.item-row').filter({ hasText: 'GitHub' }).click()
  const panel = page.locator('.item-panel')
  await expect(panel.getByText('2FA disponible')).toBeVisible()
  await expect(panel.getByText('2FA disponible').locator('..')).toContainText('TOTP')
  await expect(panel.getByText('Passkey disponible')).toBeVisible()
  if (process.env.COFFRE_UPDATE_SCREENSHOTS === '1') {
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8_000 })
    await panel.screenshot({ path: 'docs/screenshots/site-security.png' })
  }
  await page.keyboard.press('Escape')

  await page.locator('.item-row').filter({ hasText: 'Site HTTP' }).click()
  await expect(page.locator('.item-panel').getByText('Site sans HTTPS')).toBeVisible()
})
