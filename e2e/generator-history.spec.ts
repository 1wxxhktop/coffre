import { expect, test } from '@playwright/test'
import { createVault, showItems } from './helpers'

test('génère, retrouve dans l’historique et crée une connexion', async ({ page }) => {
  await createVault(page)
  await page.getByRole('button', { name: 'Générer un mot de passe' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Générateur' })).toBeVisible()
  const password = (await dialog.locator('.generator__output code').textContent()) ?? ''
  expect(password.length).toBeGreaterThan(8)

  await dialog.getByRole('button', { name: 'Copier', exact: true }).click()
  await expect(page.getByText('Valeur copiée')).toBeVisible()

  await dialog.getByRole('button', { name: 'Historique', exact: true }).click()
  await expect(dialog.getByText('••••••••')).toBeVisible()
  if (process.env.COFFRE_UPDATE_SCREENSHOTS === '1') {
    await dialog.screenshot({ path: 'docs/screenshots/generator-history.png' })
  }
  await dialog.getByRole('button', { name: 'Afficher' }).click()
  await expect(dialog.getByText(password)).toBeVisible()

  await dialog.getByRole('button', { name: 'Créer une connexion' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await showItems(page)
  await expect(
    page.locator('.item-row').filter({ hasText: 'Connexion générée' }),
  ).toBeVisible()

  // L’entrée a été consommée : l’historique est vide.
  await page.getByRole('button', { name: 'Tableau de bord' }).click()
  await page.getByRole('button', { name: 'Générer un mot de passe' }).click()
  await page.getByRole('button', { name: 'Historique', exact: true }).click()
  await expect(dialog.getByText('Aucun mot de passe généré récemment.')).toBeVisible()
})

test('désactiver la conservation efface l’historique', async ({ page }) => {
  await createVault(page)
  await page.getByRole('button', { name: 'Générer un mot de passe' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Copier', exact: true }).click()
  await dialog.getByRole('button', { name: 'Historique', exact: true }).click()
  await expect(dialog.getByText('••••••••')).toBeVisible()

  await dialog.getByLabel('Conservation').selectOption('0')
  await expect(dialog.getByText('Aucun mot de passe généré récemment.')).toBeVisible()
})
