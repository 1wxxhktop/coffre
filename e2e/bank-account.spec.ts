import { expect, test } from '@playwright/test'
import { createVault, selectItemType } from './helpers'

test.describe('compte bancaire', () => {
  test('se crée avec ⌘N/Ctrl-N et conserve IBAN et BIC', async ({ page }) => {
    await createVault(page)
    await page.keyboard.press('Control+n')

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Nouvel élément' })).toBeVisible()

    await selectItemType(page, 'Compte bancaire')

    await dialog.getByLabel('Titre', { exact: true }).fill('Compte courant')
    await dialog.getByLabel('Titulaire du compte').fill('Ada Lovelace')
    await dialog.getByLabel('Banque').fill('Banque de test')
    await dialog
      .getByLabel('IBAN', { exact: true })
      .fill('FR76 3000 6000 0112 3456 7890 189')
    await dialog.getByLabel('BIC / SWIFT').fill('agrifrpp')
    await dialog.getByLabel('Devise').fill('eur')
    await dialog.getByRole('button', { name: 'Enregistrer' }).click()

    const panel = page.locator('.item-panel')
    await expect(panel.getByRole('heading', { name: 'Compte courant' })).toBeVisible()
    await expect(panel.getByText('Banque de test')).toBeVisible()
    await expect(panel.getByText('AGRIFRPP', { exact: true })).toBeVisible()
    await expect(panel.getByText('EUR', { exact: true })).toBeVisible()
  })

  test('le sélecteur de type tient sur une ligne et propose les autres types', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 760, height: 800 })
    await createVault(page)
    await page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }).click()

    const dialog = page.getByRole('dialog')
    const more = dialog.getByRole('button', { name: 'Plus de types d’éléments' })
    await expect(more).toBeVisible()
    await more.click()
    await expect(
      page.getByRole('menuitemradio', { name: 'Compte bancaire' }),
    ).toBeVisible()
    await page.getByRole('menuitemradio', { name: 'Compte bancaire' }).click()
    await expect(dialog.getByRole('radio', { name: 'Compte bancaire' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })
})
