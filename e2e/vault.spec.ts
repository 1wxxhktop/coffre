import { expect, test } from '@playwright/test'
import {
  addLogin,
  closeDialog,
  createVault,
  openSettings,
  showItems,
  sortItems,
  PASSWORD,
} from './helpers'

test.describe('coffre et éléments', () => {
  test('crée un coffre, ajoute un champ et une pièce jointe, puis vérifie l’intégrité', async ({
    page,
  }) => {
    await createVault(page)
    const dialog = await addLogin(page)

    await dialog.getByRole('button', { name: 'Modifier' }).click()
    await dialog.getByRole('button', { name: 'Ajouter un champ' }).click()
    await dialog.getByLabel('Nom du champ personnalisé').fill('API')
    await dialog.getByLabel('Valeur de API').fill('valeur secrète')

    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('contenu de la pièce jointe'),
    })
    await expect(dialog.getByText('note.txt')).toBeVisible()
    await expect(dialog.getByLabel('Valeur de API')).toHaveValue('valeur secrète')

    await dialog.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(dialog.getByText('note.txt')).toBeVisible()
    await closeDialog(page)

    const card = page.locator('.item-row').filter({ hasText: 'GitHub' })
    await expect(card).toBeVisible()
    await expect(card.getByText('1', { exact: true })).toBeVisible()

    const settings = await openSettings(page, 'Stockage')
    await settings.getByRole('button', { name: 'Vérifier le coffre' }).click()
    await expect(settings.getByText(/Intégrité confirmée/)).toBeVisible({ timeout: 45_000 })
    await closeDialog(page)
  })

  test('filtre depuis la bibliothèque et trie la liste', async ({ page }) => {
    await createVault(page)
    await addLogin(page)
    await closeDialog(page)

    const sidebar = page.locator('.sidebar')
    await sidebar.getByRole('button', { name: /^Cartes/ }).click()
    await expect(page.locator('.item-row')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible()

    await sidebar.getByRole('button', { name: /^Connexions/ }).click()
    await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible()

    await sidebar.getByRole('button', { name: /^Récents/ }).click()
    await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible()

    await sortItems(page, 'Nom Z–A')
    await page.getByRole('button', { name: 'Options de la liste' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'Nom Z–A' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  test('affiche « Aucun élément » pour une catégorie vide', async ({ page }) => {
    await createVault(page)
    await page.locator('.sidebar').getByRole('button', { name: /^Cartes/ }).click()
    await expect(page.locator('.topbar__sub')).toContainText('Aucun élément')
    await expect(page.locator('.topbar__sub')).not.toContainText('0 élément')
  })

  test('copie une adresse web depuis la fiche sans l’ouvrir', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await createVault(page)
    const panel = await addLogin(
      page,
      'GitHub',
      'studio26',
      's3cret!',
      'https://github.com/login',
    )
    const row = panel
      .locator('.detail-link')
      .filter({ hasText: 'https://github.com/login' })
    await expect(row).toBeVisible()
    await row
      .getByRole('button', { name: 'Copier l’adresse web' })
      .click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('https://github.com/login')
    await expect(page.locator('.item-panel')).toBeVisible()
  })

  test('verrouille et déverrouille avec le mot de passe maître', async ({ page }) => {
    await createVault(page)
    await addLogin(page)
    await closeDialog(page)

    await page.getByRole('button', { name: 'Verrouiller' }).first().click()
    await expect(page.getByRole('heading', { name: 'Déverrouiller' })).toBeVisible()
    await expect(page.locator('.item-row')).toHaveCount(0)

    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Déverrouiller' }).click()
    await showItems(page)
    await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible({
      timeout: 45_000,
    })
  })
})
