import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault } from './helpers'

test('affiche le tableau de bord Sécurité et ouvre la liste filtrée', async ({ page }) => {
  await createVault(page)
  await addLogin(page, 'Compte faible', 'ada', 'abc123')
  await closeDialog(page)

  const securityButton = page.getByRole('button', { name: /^Sécurité/ })
  await expect(securityButton).toBeVisible()
  await securityButton.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Sécurité du coffre' })).toBeVisible()
  await expect(dialog.getByText('Mots de passe faciles à deviner')).toBeVisible()
  await expect(dialog.locator('.security-score__value')).toContainText('/100')
  await expect(dialog.locator('.security-score__value')).toContainText('40')
  await expect(dialog.getByText(/Score plafonné à 40\/100/)).toBeVisible()
  const plan = dialog.locator('.security-plan')
  await expect(plan).toContainText('Plan d’action')
  await expect(plan).toContainText('Faibles')
  await expect(plan).toContainText('Connexions incomplètes')
  await expect(dialog.locator('.security-distribution__legend')).toContainText('Solides')

  await plan.getByRole('button', { name: /Faibles/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.security-filter-bar')).toContainText('Mots de passe faibles')
  const row = page.locator('.item-row').filter({ hasText: 'Compte faible' })
  await expect(row).toBeVisible()
  await row.click()
  await expect(
    page.locator('.item-panel').getByRole('heading', { name: 'Compte faible' }),
  ).toBeVisible()
  await expect(page.locator('.alert-banner')).toContainText('Mot de passe faible')
})

test('exporte un rapport agrégé sans secret', async ({ page }) => {
  await createVault(page)
  await addLogin(page, 'Compte faible', 'ada', 'abc123')
  await closeDialog(page)

  await page.getByRole('button', { name: /^Sécurité/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Sécurité du coffre' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Exporter le rapport' }).click()
  const download = await downloadPromise
  const path = await download.path()
  if (!path) throw new Error('Rapport non téléchargé')
  const exported = JSON.parse(readFileSync(path, 'utf8')) as {
    format: string
    counts: { weak: number }
  }
  expect(exported.format).toBe('coffre-security-report')
  expect(exported.counts.weak).toBe(1)
  const serialized = JSON.stringify(exported)
  expect(serialized).not.toContain('Compte faible')
  expect(serialized).not.toContain('ada')
  expect(serialized).not.toContain('abc123')
  expect(download.suggestedFilename()).toMatch(
    /^coffre-securite-\d{4}-\d{2}-\d{2}\.json$/,
  )
})

test('ne signale aucun problème pour un coffre vide', async ({ page }) => {
  await createVault(page)
  await page.getByRole('button', { name: /^Sécurité/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Sécurité du coffre' })).toBeVisible()
  await expect(dialog.getByText('Aucune connexion à analyser')).toBeVisible()
  await expect(dialog.getByText('Aucun problème détecté')).toHaveCount(0)
  await closeDialog(page)
})
