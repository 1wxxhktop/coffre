import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault, openSettings } from './helpers'

test.describe('sécurité de l’interface', () => {
  test('aucune requête tierce et neutralisation des URL dangereuses', async ({
    page,
    baseURL,
  }) => {
    const appHost = new URL(baseURL ?? 'http://127.0.0.1:4173').host
    const external: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.host !== appHost
      ) {
        external.push(request.url())
      }
    })

    await createVault(page)
    const dialog = await addLogin(page)

    await dialog.getByRole('button', { name: 'Modifier' }).click()
    await dialog.getByRole('button', { name: 'Ajouter une adresse' }).click()
    await dialog.locator('.url-row input').first().fill('javascript:alert(1)')
    await dialog.getByRole('button', { name: 'Enregistrer' }).click()

    // Le schéma n’est pas accepté : la valeur reste affichée en texte, sans lien.
    await expect(dialog.locator('.detail-link a')).toHaveCount(0)
    await expect(dialog.getByText('javascript:alert(1)')).toBeVisible()

    await closeDialog(page)

    const settings = await openSettings(page, 'Stockage')
    await settings.getByRole('button', { name: 'Vérifier le coffre' }).click()
    await expect(settings.getByText(/Intégrité confirmée/)).toBeVisible({
      timeout: 45_000,
    })
    await closeDialog(page)

    expect(external).toEqual([])
  })
})
