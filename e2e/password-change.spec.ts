import { expect, test } from '@playwright/test'
import { addLogin, createVault } from './helpers'

test('met à jour le mot de passe depuis l’assistant guidé', async ({ page }) => {
  await createVault(page)
  const panel = await addLogin(
    page,
    'GitHub',
    'ada',
    'Ancien-mot-de-passe-2025!',
    'https://github.com',
  )

  await panel.getByRole('button', { name: 'Plus d’actions' }).click()
  await page.getByRole('menuitem', { name: /Changer le mot de passe/ }).click()

  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: 'Changer le mot de passe' }),
  ).toBeVisible()
  const field = dialog.getByLabel('Nouveau mot de passe')
  await expect(field).not.toHaveValue('')
  await expect(field).not.toHaveValue('Ancien-mot-de-passe-2025!')

  const newPassword = 'Nouveau-mot-de-passe-2026!'
  await field.fill(newPassword)
  await dialog.getByRole('button', { name: 'Enregistrer dans Coffre' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(panel.getByText('Mot de passe à changer')).toBeVisible()
  await panel.getByRole('button', { name: 'Afficher Mot de passe' }).click()
  await expect(panel.getByText(newPassword)).toBeVisible()
})
