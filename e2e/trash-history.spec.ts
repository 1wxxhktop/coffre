import { expect, test, type Locator, type Page } from '@playwright/test'
import { addLogin, clickItemMenu, closeDialog, createVault } from './helpers'

/** Ouvre la fiche d’un élément depuis la liste et renvoie le panneau. */
async function openItem(page: Page, title: string): Promise<Locator> {
  await page.locator('.item-row').filter({ hasText: title }).click()
  const panel = page.locator('.item-panel')
  await expect(panel.getByRole('heading', { name: title })).toBeVisible()
  return panel
}

/** Déplace un élément vers la corbeille depuis sa fiche. */
async function trashItem(page: Page, title: string): Promise<void> {
  const panel = await openItem(page, title)
  await clickItemMenu(page, panel, 'Supprimer…')

  const confirm = page.getByRole('dialog').last()
  await expect(
    confirm.getByRole('heading', { name: 'Déplacer vers la corbeille ?' }),
  ).toBeVisible()
  await confirm.getByRole('button', { name: 'Mettre à la corbeille' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.item-panel')).toHaveCount(0)
}

test.describe('corbeille et historique', () => {
  test('déplace un élément en corbeille puis le restaure', async ({ page }) => {
    await createVault(page)
    await addLogin(page)
    await closeDialog(page)

    await trashItem(page, 'GitHub')
    await expect(page.locator('.item-row')).toHaveCount(0)

    await page.locator('.sidebar').getByRole('button', { name: /^Corbeille/ }).click()
    const card = page.locator('.item-row').filter({ hasText: 'GitHub' })
    await expect(card).toBeVisible()
    await expect(card.getByText(/Supprimé le/)).toBeVisible()

    const panel = await openItem(page, 'GitHub')
    await expect(panel.getByText(/Dans la corbeille depuis le/)).toBeVisible()

    await panel.getByRole('button', { name: 'Restaurer' }).click()
    await expect(panel.getByText(/Dans la corbeille depuis le/)).toHaveCount(0)
    await closeDialog(page)

    await page.locator('.sidebar').getByRole('button', { name: /^Tous les éléments/ }).click()
    await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible()
  })

  test('vide la corbeille définitivement', async ({ page }) => {
    await createVault(page)
    await addLogin(page)
    await closeDialog(page)
    await trashItem(page, 'GitHub')

    await page.locator('.sidebar').getByRole('button', { name: /^Corbeille/ }).click()
    await page.getByRole('button', { name: 'Vider la corbeille' }).click()

    const confirm = page.getByRole('dialog').last()
    await expect(confirm.getByRole('heading', { name: 'Vider la corbeille ?' })).toBeVisible()
    await confirm.getByLabel(/Tapez/).fill('SUPPRIMER')
    await confirm.getByRole('button', { name: 'Vider définitivement' }).click()

    await expect(page.getByRole('heading', { name: 'La corbeille est vide' })).toBeVisible()
    await expect(page.locator('.item-row')).toHaveCount(0)
  })

  test('affiche l’historique et restaure une version précédente', async ({ page }) => {
    await createVault(page)
    const panel = await addLogin(page)

    await panel.getByRole('button', { name: 'Modifier' }).click()
    await panel.getByLabel('Mot de passe', { exact: true }).fill('nouveau-secret')
    await panel.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(panel.getByRole('heading', { name: 'GitHub' })).toBeVisible()

    await clickItemMenu(page, panel, 'Historique')
    const history = page.getByRole('dialog').last()
    await expect(history.getByRole('heading', { name: 'Historique' })).toBeVisible()

    const entry = history.locator('.history-item').filter({ hasText: 'GitHub' })
    await expect(entry).toHaveCount(1)
    await entry.getByRole('button', { name: 'Restaurer' }).click()

    const confirm = page.getByRole('dialog').last()
    await expect(
      confirm.getByRole('heading', { name: 'Restaurer cette version ?' }),
    ).toBeVisible()
    await confirm.getByRole('button', { name: 'Restaurer' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await panel.getByRole('button', { name: 'Modifier' }).click()
    await expect(panel.getByLabel('Mot de passe', { exact: true })).toHaveValue('s3cret!')
    await panel.getByLabel('Mot de passe', { exact: true }).fill('secret-final')
    await panel.getByRole('button', { name: 'Enregistrer' }).click()

    await clickItemMenu(page, panel, 'Historique')
    const reopened = page.getByRole('dialog').last()
    await expect(reopened.locator('.history-item')).toHaveCount(3)
  })
})
