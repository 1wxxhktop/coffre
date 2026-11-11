import { expect, test } from '@playwright/test'
import { addLogin, createVault } from './helpers'

test.describe('outils des éléments', () => {
  test('saisit une clé TOTP simple et affiche le code', async ({ page }) => {
    await createVault(page)
    const panel = await addLogin(page)

    await panel.getByRole('button', { name: 'Modifier' }).click()
    await panel.getByLabel('Clé TOTP (2FA)').fill('jbsw y3dp ehpk 3pxp')
    await expect(panel.getByText(/Clé invalide/)).toHaveCount(0)
    await panel.getByRole('button', { name: 'Enregistrer' }).click()

    // Le code à 6 chiffres est affiché (« 123 456 »).
    await expect(panel.getByText(/^\d{3} \d{3}$/).first()).toBeVisible()

    // En modification, le champ montre la clé, pas le lien.
    await panel.getByRole('button', { name: 'Modifier' }).click()
    await expect(panel.getByLabel('Clé TOTP (2FA)')).toHaveValue('JBSW Y3DP EHPK 3PXP')
  })

  test('duplique un élément en un clic et ouvre la copie en modification', async ({
    page,
  }) => {
    await createVault(page)
    const panel = await addLogin(page, 'Banque')

    await panel.getByRole('button', { name: 'Dupliquer' }).click()
    await expect(panel.getByLabel('Titre', { exact: true })).toHaveValue('Banque (copie)')
    await panel.getByRole('button', { name: 'Enregistrer' }).click()

    await expect(page.locator('.item-row').filter({ hasText: 'Banque' })).toHaveCount(2)
  })

  test('crée des champs personnalisés de chaque famille', async ({ page }) => {
    await createVault(page)
    const panel = await addLogin(page, 'Carte bancaire')
    await panel.getByRole('button', { name: 'Modifier' }).click()

    const addField = async (label: string, type: string) => {
      await panel.getByRole('button', { name: 'Ajouter un champ' }).click()
      const names = panel.getByLabel('Nom du champ personnalisé')
      await names.last().fill(label)
      await panel.getByLabel('Type du champ personnalisé').last().selectOption({ label: type })
    }

    await addField('Code', 'Code PIN')
    await panel.getByLabel('Valeur de Code').fill('1234')
    await addField('Contact', 'E-mail')
    await panel.getByLabel('Valeur de Contact').fill('ada@example.com')
    await addField('Ouverture', 'Date')
    await panel.getByLabel('Valeur de Ouverture').fill('2027-02-28')
    await addField('Active', 'Oui / non')
    await panel.getByLabel('Valeur de Active').check()

    await panel.getByRole('button', { name: 'Enregistrer' }).click()

    // Le PIN est masqué, la date lisible, la case affichée « Oui ».
    await expect(panel.getByText('1234')).toHaveCount(0)
    await expect(panel.getByText('28 février 2027')).toBeVisible()
    await expect(panel.getByText('ada@example.com')).toBeVisible()
    await expect(
      panel.locator('.detail-row').filter({ hasText: 'Active' }).getByText('Oui'),
    ).toBeVisible()
  })
})
