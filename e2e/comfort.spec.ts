import { expect, test } from '@playwright/test'
import { addLogin, createVault } from './helpers'

test.describe('confort de la fiche et accès rapides', () => {
  test('la palette ouvre un élément ou lance une action', async ({ page }) => {
    await createVault(page)
    await addLogin(page, 'Banque Postale', 'ada@exemple.fr')
    await addLogin(page, 'Intranet')

    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Palette de commandes' })
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('option', { name: /Nouvel élément/ })).toBeVisible()

    await palette.getByRole('combobox').fill('banq')
    await expect(palette.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(palette).toHaveCount(0)
    await expect(
      page.locator('.item-panel').getByRole('heading', { name: 'Banque Postale' }),
    ).toBeVisible()

    await page.keyboard.press('ControlOrMeta+k')
    await palette.getByRole('combobox').fill('reglages')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Réglages' })).toBeVisible()
  })

  test('Échap ferme la palette sans rien changer', async ({ page }) => {
    await createVault(page)
    const panel = await addLogin(page, 'Intranet')
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Palette de commandes' })
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
    await expect(panel.getByRole('heading', { name: 'Intranet' })).toBeVisible()
  })

  test('l’accès rapide liste les éléments utilisés et les rouvre', async ({ page }) => {
    await createVault(page)
    await addLogin(page, 'Banque Postale')
    await addLogin(page, 'Intranet')
    await page.locator('.item-row', { hasText: 'Banque Postale' }).click()
    await page.locator('.item-row', { hasText: 'Intranet' }).click()

    const quick = page.getByRole('group', { name: 'Accès rapide' })
    await expect(quick.getByRole('button')).toHaveCount(2)
    await quick.getByRole('button', { name: 'Banque Postale' }).click()
    await expect(
      page.locator('.item-panel').getByRole('heading', { name: 'Banque Postale' }),
    ).toBeVisible()

    // Masqué pendant une recherche.
    await page.getByRole('searchbox').fill('intra')
    await expect(quick).toHaveCount(0)
  })

  test('un compte sans site reçoit une pastille à initiale teintée', async ({ page }) => {
    await createVault(page)
    await addLogin(page, 'Élan Coopérative')
    const monogram = page.locator('.item-row .item-icon__monogram')
    await expect(monogram).toHaveText('E')
    await expect(monogram).toHaveAttribute('data-tint', /^[1-6]$/)
  })

  test('la fiche résume la sécurité et place l’alerte sous le mot de passe', async ({
    page,
  }) => {
    await createVault(page)
    const panel = await addLogin(page, 'Faible', 'ada', 'abc123')

    const health = panel.locator('.detail-health')
    await expect(health.locator('.alert-banner--inline')).toContainText('Mot de passe faible')
    await expect(health.getByRole('button', { name: 'Générer' })).toBeVisible()

    const facts = panel.getByRole('region', { name: 'Sécurité' })
    await expect(facts).toContainText('Robustesse')
    await expect(facts).toContainText('Mot de passe unique')
    await expect(facts).toContainText('Aujourd’hui')
  })

  test('les flèches réordonnent les champs personnalisés', async ({ page }) => {
    await createVault(page)
    const panel = await addLogin(page, 'Ordre')
    await panel.getByRole('button', { name: 'Modifier' }).click()
    for (const name of ['Premier', 'Second']) {
      await panel.getByRole('button', { name: 'Ajouter un champ' }).click()
      await panel.getByLabel('Nom du champ personnalisé').last().fill(name)
      await panel.locator('.custom-field').last().getByLabel(/^Valeur de/).fill(`v-${name}`)
    }

    await panel.getByRole('button', { name: 'Déplacer le champ Premier' }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(panel.getByLabel('Nom du champ personnalisé').first()).toHaveValue('Second')

    await panel.getByRole('button', { name: 'Enregistrer' }).click()
    const labels = panel.locator('.detail-list--custom .detail-row__label')
    await expect(labels).toHaveText(['Second', 'Premier'])
  })
})
