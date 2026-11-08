import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault, openSettings, showItems } from './helpers'

const NEW_PASSWORD = 'nouvelle phrase de passe solide'

test.describe('phrase de récupération', () => {
  test('configure une phrase, verrouille puis récupère avec un nouveau mot de passe', async ({
    page,
  }) => {
    await createVault(page)
    await addLogin(page)
    await closeDialog(page)

    const settings = await openSettings(page, 'Sécurité')
    await settings.getByRole('button', { name: 'Configurer une phrase' }).click()

    const recovery = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Phrase de récupération', level: 2 }),
    })
    await expect(
      recovery.getByRole('heading', { name: 'Phrase de récupération' }),
    ).toBeVisible()
    await recovery.getByRole('button', { name: 'Générer une phrase' }).click()

    const words = await recovery.locator('.recovery-phrase__word').evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent ?? '').replace(/^\d+/, '').trim()),
    )
    expect(words).toHaveLength(10)
    const phrase = words.join(' ')

    await recovery.getByRole('checkbox').check()
    await recovery.getByRole('button', { name: 'Activer la récupération' }).click()
    await expect(recovery).toHaveCount(0)
    await expect(settings.getByText(/Phrase configurée le/)).toBeVisible()
    await closeDialog(page)

    await page.getByRole('button', { name: 'Verrouiller' }).first().click()
    await expect(page.getByRole('heading', { name: 'Déverrouiller' })).toBeVisible()

    await page
      .getByRole('button', { name: 'Déverrouiller avec une phrase de récupération' })
      .click()
    const unlock = page.getByRole('dialog')
    await unlock.getByLabel('Phrase de récupération').fill(phrase)
    await unlock.getByLabel('Nouveau mot de passe maître').fill(NEW_PASSWORD)
    await unlock.getByLabel('Confirmer le mot de passe').fill(NEW_PASSWORD)
    await unlock.getByRole('button', { name: 'Récupérer le coffre' }).click()

    await expect(page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' })).toBeVisible({
      timeout: 45_000,
    })
    await showItems(page)
    await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible()

    // L’ancien mot de passe ne doit plus ouvrir le coffre.
    await page.getByRole('button', { name: 'Verrouiller' }).first().click()
    await page.getByLabel('Mot de passe', { exact: true }).fill('phrase de passe de test solide')
    await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(/incorrect/i, { timeout: 30_000 })

    await page.getByLabel('Mot de passe', { exact: true }).fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click()
    await expect(page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' })).toBeVisible({
      timeout: 45_000,
    })
  })
})
