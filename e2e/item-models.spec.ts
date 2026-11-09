import { expect, test } from '@playwright/test'
import {
  addLogin,
  closeDialog,
  createVault,
  openSettings,
  showItems,
} from './helpers'

test('affiche l’icône du service d’une connexion', async ({ page }) => {
  await createVault(page)
  await addLogin(page, 'GitHub', 'ada', 's3cret!', 'https://github.com/login')
  await closeDialog(page)
  const icon = page.locator('.item-row [data-service="github"]')
  await expect(icon).toBeVisible()
  await page.locator('.item-row').filter({ hasText: 'GitHub' }).click()
  await expect(
    page.locator('.item-panel [data-service="github"]:visible').first(),
  ).toBeVisible()
})

test('affiche un monogramme pour un domaine inconnu', async ({ page }) => {
  await createVault(page)
  await addLogin(page, 'Intranet', 'ada', 's3cret!', 'https://portail.exemple.fr')
  await closeDialog(page)
  const icon = page.locator('.item-row [data-service="domain:portail.exemple.fr"]')
  await expect(icon).toBeVisible()
  await expect(icon).toHaveText('E')
})

test('propose un modèle intégré pour chaque type', async ({ page }) => {
  await createVault(page)
  const settings = await openSettings(page, 'Modèles')
  const grid = settings.locator('.model-grid')
  await expect(grid.locator('.model-card')).toHaveCount(10)
  for (const type of [
    'login',
    'note',
    'card',
    'identity',
    'passkey',
    'ssh-key',
    'wifi',
    'api-credential',
    'software-license',
    'document',
  ]) {
    await expect(grid.locator(`[data-model="${type}"]`)).toBeVisible()
  }
  await expect(grid.locator('[data-model="passkey"] .button')).toBeDisabled()
  await expect(grid.locator('[data-model="passkey"] .button')).toContainText('WebAuthn')
  await closeDialog(page)
})

test('crée un élément depuis un modèle intégré', async ({ page }) => {
  await createVault(page)
  const settings = await openSettings(page, 'Modèles')
  await settings
    .locator('[data-model="card"]')
    .getByRole('button', { name: 'Créer un élément' })
    .click()
  await expect(page.getByText('Élément créé depuis le modèle intégré.')).toBeVisible()
  await closeDialog(page)
  await showItems(page)
  const row = page.locator('.item-row').filter({ hasText: 'Carte bancaire' })
  await expect(row).toBeVisible()
  await expect(row.locator('.item-icon--card')).toBeVisible()
})

test('crée un modèle personnalisé typé', async ({ page }) => {
  await createVault(page)
  const settings = await openSettings(page, 'Modèles')
  await settings.getByRole('button', { name: 'Créer un modèle' }).click()
  await settings.getByLabel('Nom du modèle').fill('Modèle carte')
  await settings.getByLabel('Type d’élément').selectOption('card')
  await settings.getByLabel('Libellé du champ').fill('Code client')
  await settings.getByRole('button', { name: 'Enregistrer le modèle' }).click()

  const template = settings
    .locator('.template-list__item')
    .filter({ hasText: 'Modèle carte' })
  await expect(template).toContainText('Carte')
  await template
    .getByRole('button', { name: 'Créer un élément depuis Modèle carte' })
    .click()
  await expect(page.getByText('Élément créé depuis le modèle.')).toBeVisible()
  await closeDialog(page)
  await showItems(page)
  const row = page.locator('.item-row').filter({ hasText: 'Modèle carte' })
  await expect(row).toBeVisible()
  await expect(row.locator('.item-icon--card')).toBeVisible()
})
