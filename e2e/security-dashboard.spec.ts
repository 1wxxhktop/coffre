import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault } from './helpers'

test('affiche le tableau de bord Sécurité et ouvre la liste filtrée', async ({ page }) => {
  await createVault(page)
  await addLogin(page, 'Compte faible', 'ada', 'abc123')
  await closeDialog(page)

  const securityButton = page.getByRole('button', { name: /^Sécurité/ })
  await expect(securityButton).toBeVisible()
  await securityButton.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Sécurité du coffre' })).toBeVisible()
  await expect(dialog.getByText('Mots de passe faciles à deviner')).toBeVisible()
  await expect(dialog.locator('.security-score__value')).toContainText('/100')
  await expect(dialog.locator('.security-score__value')).toContainText('40')
  await expect(dialog.getByText(/Score plafonné à 40\/100/)).toBeVisible()
  const primary = dialog.locator('.security-primary')
  await expect(primary).toContainText('Faibles')
  await expect(primary).toContainText('Réutilisés')
  await expect(primary).toContainText('Sans 2FA')
  await expect(dialog.locator('.security-points')).toContainText('Connexions incomplètes')
  await expect(dialog.locator('.security-distribution__legend')).toContainText('Solides')

  await primary.getByRole('button', { name: /Faibles/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.security-filter-bar')).toContainText('Mots de passe faibles')
  const row = page.locator('.item-row').filter({ hasText: 'Compte faible' })
  await expect(row).toBeVisible()
  await row.click()
  await expect(
    page.locator('.item-panel').getByRole('heading', { name: 'Compte faible' }),
  ).toBeVisible()
  await expect(page.locator('.alert-banner')).toContainText('Mot de passe faible')
})

test('ne signale aucun problème pour un coffre vide', async ({ page }) => {
  await createVault(page)
  await page.getByRole('button', { name: /^Sécurité/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Sécurité du coffre' })).toBeVisible()
  await expect(dialog.getByText('Aucune connexion à analyser')).toBeVisible()
  await expect(dialog.getByText('Aucun problème détecté')).toHaveCount(0)
  await closeDialog(page)
})
