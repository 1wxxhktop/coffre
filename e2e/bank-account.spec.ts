import { expect, test } from '@playwright/test'
import { createVault, newItemButton, selectItemType } from './helpers'

test.describe('compte et carte', () => {
  test('se crée avec ⌘N/Ctrl-N et conserve compte, IBAN, carte et BIC', async ({
    page,
  }) => {
    await createVault(page)
    await page.keyboard.press('Control+n')

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Nouvel élément' })).toBeVisible()

    await selectItemType(page, 'Compte et carte')

    await dialog.getByLabel('Titre', { exact: true }).fill('Compte courant')
    await dialog.getByLabel('Titulaire du compte').fill('Ada Lovelace')
    await dialog.getByLabel('Banque').fill('Banque de test')
    await dialog
      .getByLabel('IBAN', { exact: true })
      .fill('FR76 3000 6000 0112 3456 7890 189')
    await dialog.getByLabel('BIC / SWIFT').fill('agrifrpp')
    await dialog.getByLabel('Devise').fill('eur')
    await dialog.getByLabel('Titulaire de la carte').fill('Ada Lovelace')
    await dialog.getByLabel('Numéro de carte').fill('4242 4242 4242 4242')
    await dialog.getByLabel('Expiration').fill('1229')
    await dialog.getByLabel('CVC').fill('123')
    await dialog.getByLabel('Code PIN').fill('1234')
    await dialog.getByLabel('Réseau / type').fill('Visa')
    await dialog.getByRole('button', { name: 'Enregistrer' }).click()

    const panel = page.locator('.item-panel')
    await expect(panel.getByRole('heading', { name: 'Compte courant' })).toBeVisible()
    await expect(panel.getByText('Banque de test')).toBeVisible()
    await expect(panel.getByText('AGRIFRPP', { exact: true })).toBeVisible()
    await expect(panel.getByText('EUR', { exact: true })).toBeVisible()
    await expect(panel.getByText('Carte associée')).toBeVisible()
    await expect(panel.getByText('Visa', { exact: true })).toBeVisible()
    await expect(panel.getByText(/12\/29/)).toBeVisible()
  })

  test('le sélecteur propose Compte et carte mais plus de carte séparée', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 760, height: 800 })
    await createVault(page)
    const trigger = await newItemButton(page)
    await trigger.click()

    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('radio', { name: 'Compte et carte' }),
    ).toBeVisible()
    const more = dialog.getByRole('button', { name: 'Plus de types d’éléments' })
    await expect(more).toBeVisible()
    await more.click()
    await expect(
      page.getByRole('menuitemradio', { name: 'Carte', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('menuitemradio', { name: 'Clé SSH' }).click()
    await expect(
      dialog.getByRole('radio', { name: 'Clé SSH' }),
    ).toHaveAttribute('aria-checked', 'true')
  })
})
