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

/** Ajoute une connexion et renvoie la modale restée ouverte sur le détail. */
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

  await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
  return dialog
}

export async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Réglages' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Réglages' })).toBeVisible()
  return dialog
}

export async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
