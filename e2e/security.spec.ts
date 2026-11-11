import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault, openSettings } from './helpers'

test.describe('sécurité de l’interface', () => {
  test('liste les comptes qui partagent le mot de passe et permet de les ouvrir', async ({
    page,
  }) => {
    await createVault(page)
    await addLogin(
      page,
      'Compte partagé A',
      'ada',
      'MotDePassePartagé!42',
      'https://a.example.com',
    )
    const panel = await addLogin(
      page,
      'Compte partagé B',
      'grace',
      'MotDePassePartagé!42',
      'https://b.example.com',
    )

    await expect(
      panel.getByText('Comptes qui partagent ce mot de passe'),
    ).toBeVisible()
    await panel.getByRole('button', { name: 'Ouvrir Compte partagé A' }).click()
    await expect(
      panel.getByRole('heading', { name: 'Compte partagé A' }),
    ).toBeVisible()
    await expect(
      panel.getByRole('button', { name: 'Ouvrir Compte partagé B' }),
    ).toBeVisible()
  })

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
