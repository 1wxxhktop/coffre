import { expect, test } from '@playwright/test'
import { closeDialog, createVault } from './helpers'

test('importe dix codes, en utilise huit et alerte le tableau de bord', async ({
  page,
}) => {
  await createVault(page)

  await page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Nouvel élément' })).toBeVisible()
  await dialog.getByRole('tab', { name: 'Codes de secours' }).click()

  await dialog.getByLabel('Titre', { exact: true }).fill('GitHub')
  const codes = [
    'AAAA-BBBB',
    'CCCC-DDDD',
    'EEEE-FFFF',
    'GGGG-HHHH',
    'IIII-JJJJ',
    'KKKK-LLLL',
    'MMMM-NNNN',
    'OOOO-PPPP',
    'QQQQ-RRRR',
    'SSSS-TTTT',
  ]
  await dialog.getByLabel('Coller des codes de secours').fill(codes.join('\n'))
  await dialog.getByRole('button', { name: 'Ajouter les codes' }).click()
  await expect(dialog.getByLabel('Code de secours')).toHaveCount(10)

  await dialog.getByRole('button', { name: 'Enregistrer' }).first().click()
  const panel = page.locator('.item-panel')
  await expect(panel.getByRole('heading', { name: 'GitHub' })).toBeVisible()

  await panel.getByRole('button', { name: 'Copier ce code' }).first().click()
  const markDialog = page.getByRole('dialog')
  await expect(
    markDialog.getByRole('heading', { name: 'Marquer ce code comme utilisé ?' }),
  ).toBeVisible()
  await markDialog.getByRole('button', { name: 'Marquer utilisé' }).click()
  await expect(panel.getByRole('button', { name: 'Rétablir' })).toHaveCount(1)

  for (let used = 2; used <= 8; used += 1) {
    await panel.getByRole('button', { name: 'Marquer utilisé' }).first().click()
    await expect(panel.getByRole('button', { name: 'Rétablir' })).toHaveCount(used)
  }
  await expect(panel.getByRole('button', { name: 'Marquer utilisé' })).toHaveCount(2)

  await closeDialog(page)
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Tableau de bord' })
    .click()
  const alert = page.locator('.dashboard-recovery-alert')
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('Codes de secours à renouveler')
  await expect(alert).toContainText(
    'Un élément ne contient plus que deux codes de secours ou moins.',
  )
})
