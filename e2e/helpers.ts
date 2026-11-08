import { expect, type Locator, type Page } from '@playwright/test'

export const PASSWORD = 'phrase de passe de test solide'

/** Crée un coffre neuf dans un contexte navigateur vierge. */
export async function createVault(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Créer votre coffre' })).toBeVisible()

  await page.getByLabel('Nom du coffre').fill('Personnel')
  await page.getByLabel('Mot de passe maître').fill(PASSWORD)
  await page.getByLabel('Confirmer le mot de passe').fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Créer mon coffre' }).click()

  await expect(page.getByRole('button', { name: 'Nouvel élément' })).toBeVisible({
    timeout: 45_000,
  })
}

/**
 * Ajoute une connexion via la modale de création et renvoie le panneau de
 * détail resté ouvert sur la fiche de l’élément.
 */
export async function addLogin(
  page: Page,
  title = 'GitHub',
  username = 'studio26',
  password = 's3cret!',
  url = '',
): Promise<Locator> {
  await page.getByRole('button', { name: 'Nouvel élément' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Nouvel élément' })).toBeVisible()

  await dialog.getByLabel('Titre', { exact: true }).fill(title)
  await dialog.getByLabel('Identifiant', { exact: true }).fill(username)
  await dialog.getByLabel('Mot de passe', { exact: true }).fill(password)
  if (url) {
    await dialog.getByPlaceholder('https://exemple.com').fill(url)
  }
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const panel = page.locator('.item-panel')
  await expect(panel.getByRole('heading', { name: title })).toBeVisible()
  return panel
}

/** Ouvre les réglages, éventuellement sur une page donnée. */
export async function openSettings(page: Page, section?: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Réglages' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Réglages' })).toBeVisible()
  if (section) {
    await dialog.getByRole('button', { name: section, exact: true }).click()
  }
  return dialog
}

/** Ferme la vue courante (modale ou panneau de détail) avec Échap. */
export async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** Ouvre le menu d’actions d’un élément et clique sur une entrée. */
export async function clickItemMenu(page: Page, panel: Locator, label: string) {
  await panel.getByRole('button', { name: 'Plus d’actions' }).click()
  await page.getByRole('menuitem', { name: label }).click()
}

/** Active la sélection multiple depuis le menu de la liste. */
export async function enableSelection(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Options de la liste' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Sélection multiple' }).click()
}

/** Change le tri depuis le menu de la liste. */
export async function sortItems(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Options de la liste' }).click()
  await page.getByRole('menuitemradio', { name: label }).click()
}
