import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault } from './helpers'

test('affiche l’évolution du score et propose le changement sur le site', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'coffre:security-history:v1',
      JSON.stringify([
        {
          date: '2026-11-01',
          score: 32,
          total: 10,
          weak: 6,
          reused: 2,
          no2fa: 4,
          affected: 7,
        },
        {
          date: '2026-11-02',
          score: 58,
          total: 10,
          weak: 3,
          reused: 1,
          no2fa: 3,
          affected: 4,
        },
      ]),
    )
  })

  await createVault(page)
  await addLogin(page, 'Compte faible', 'ada', 'abc123', 'https://example.com')
  await closeDialog(page)

  await page.getByRole('button', { name: /^Sécurité/ }).click()
  const security = page.getByRole('dialog')
  await expect(security.getByText('Évolution du score')).toBeVisible()
  await expect(security.locator('.security-history__chart')).toBeVisible()
  await expect(security.locator('.security-history__delta')).toContainText('pts')

  await security.getByRole('button', { name: /Faibles/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.item-row').filter({ hasText: 'Compte faible' }).click()

  const panel = page.locator('.item-panel')
  await expect(panel.getByText('Mot de passe faible')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Changer sur le site' })).toBeVisible()
})
