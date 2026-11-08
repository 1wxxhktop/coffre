import { expect, test, type Page } from '@playwright/test'
import { addLogin, closeDialog, createVault } from './helpers'

async function openDashboard(page: Page) {
  const sidebarButton = page.getByRole('button', { name: 'Tableau de bord' }).first()
  if (await sidebarButton.isVisible()) {
    await sidebarButton.click()
  } else {
    await page.getByRole('button', { name: 'Accueil' }).click()
  }
  await expect(page.locator('.dashboard')).toBeVisible()
}

test('affiche le tableau de bord et ouvre une catégorie de sécurité', async ({ page }) => {
  await createVault(page)
  await addLogin(page, 'Compte faible', 'ada', 'abc123')
  await closeDialog(page)

  await openDashboard(page)
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible()
  await expect(page.locator('.dashboard__stats')).toContainText('Connexions')
  await expect(page.locator('.dashboard__health')).toContainText('/100')
  const storage = page.locator('.dashboard-card').filter({ hasText: 'Stockage' })
  await expect(storage).toContainText('Coffre local à jour')
  await expect(storage).toContainText('Dernière écriture')
  await expect(storage).toContainText('3 sauvegardes locales tournantes')
  const weakRow = page
    .locator('.dashboard-watch__row')
    .filter({ hasText: 'Mots de passe faibles' })
  await expect(weakRow).toContainText('1')

  await weakRow.click()
  await expect(page.locator('.dashboard')).toHaveCount(0)
  await expect(page.locator('.security-filter-bar')).toContainText(
    'Mots de passe faibles',
  )
  await expect(
    page.locator('.item-row').filter({ hasText: 'Compte faible' }),
  ).toBeVisible()
})

test('ouvre un élément et crée depuis le tableau de bord', async ({ page }) => {
  await createVault(page)
  await addLogin(page, 'GitHub', 'ada', 'abc123')
  await closeDialog(page)

  await openDashboard(page)
  await page.locator('.dashboard-item').filter({ hasText: 'GitHub' }).first().click()
  await expect(
    page.locator('.item-panel').getByRole('heading', { name: 'GitHub' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  await openDashboard(page)
  await page
    .locator('.dashboard__quick-actions')
    .getByRole('button', { name: 'Nouvel élément' })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Nouvel élément' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('le tableau de bord est accessible sur mobile et sans débordement', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await createVault(page)
  await expect(page.locator('.dashboard')).toBeVisible()
  await addLogin(page, 'GitHub', 'ada', 'abc123')
  await closeDialog(page)

  await page.getByRole('button', { name: 'Accueil' }).click()
  await expect(page.locator('.dashboard')).toBeVisible()
  const accueil = page.getByRole('button', { name: 'Accueil' })
  await expect(accueil).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: 'Tout', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('button', { name: 'Sécurité', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  )

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight,
  }))
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth)
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight)

  await page.getByRole('button', { name: 'Tout', exact: true }).click()
  await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible()
  await expect(page.locator('.dashboard')).toHaveCount(0)
})
