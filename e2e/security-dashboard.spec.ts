import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault } from './helpers'

test('affiche le tableau de bord Sécurité et ouvre un élément à corriger', async ({ page }) => {
  await createVault(page)
  await addLogin(page, 'Compte faible', 'ada', 'abc123')
  await closeDialog(page)

  const securityButton = page.getByRole('button', { name: /^Sécurité/ })
  await expect(securityButton).toBeVisible()
  await securityButton.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Sécurité du coffre' })).toBeVisible()
  await expect(dialog.getByText('Mots de passe faibles')).toBeVisible()
  await expect(dialog.locator('.security-score__value')).toContainText('/100')
  const summary = dialog.locator('.security-summary')
  await expect(summary).toContainText('Faibles')
  await expect(summary).toContainText('Réutilisés')
  await expect(summary).toContainText('Sans 2FA')
  await expect(summary).toContainText('Incomplets')
  await expect(summary).toContainText('Doublons')
  await expect(dialog.locator('.security-distribution__legend')).toContainText('Solides')
  await expect(dialog.getByText('Sans double authentification')).toBeVisible()

  await dialog.locator('.security-item').filter({ hasText: 'Compte faible' }).first().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.locator('.item-panel').getByRole('heading', { name: 'Compte faible' }),
  ).toBeVisible()
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
