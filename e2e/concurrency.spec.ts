import { expect, test, type Page } from '@playwright/test'
import { addLogin, closeDialog, createVault, PASSWORD } from './helpers'

async function unlock(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Déverrouiller' })).toBeVisible()
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByRole('button', { name: 'Nouvel élément' })).toBeVisible({
    timeout: 45_000,
  })
}

async function lockFromToolbar(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Verrouiller' }).first().click()
  await expect(page.getByRole('heading', { name: 'Déverrouiller' })).toBeVisible()
}

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (value ? 'hidden' : 'visible'),
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

test.describe('cohérence des écritures', () => {
  test('un onglet resté ouvert relit le coffre avant de le déverrouiller', async ({
    context,
    page,
  }) => {
    await createVault(page)
    await addLogin(page, 'Alpha')
    await closeDialog(page)

    // Onglet B chargé pendant que A est ouvert : il reste verrouillé.
    const tabB = await context.newPage()
    await tabB.goto('/')
    await expect(tabB.getByRole('heading', { name: 'Déverrouiller' })).toBeVisible()

    // A ajoute Beta puis verrouille.
    await page.bringToFront()
    await addLogin(page, 'Beta')
    await closeDialog(page)
    await lockFromToolbar(page)

    // B voit Beta et l’écriture suivante le conserve.
    await tabB.bringToFront()
    await unlock(tabB)
    await expect(tabB.locator('.item-row').filter({ hasText: 'Beta' })).toHaveCount(1)
    await addLogin(tabB, 'Gamma')
    await closeDialog(tabB)
    await lockFromToolbar(tabB)

    const tabC = await context.newPage()
    await tabC.goto('/')
    await unlock(tabC)
    const rows = tabC.locator('.item-row')
    for (const title of ['Alpha', 'Beta', 'Gamma']) {
      await expect(rows.filter({ hasText: title })).toHaveCount(1)
    }
  })

  test('un verrouillage pendant un enregistrement ne perd pas la modification', async ({
    context,
    page,
  }) => {
    // Ralentit le chiffrement pour que le verrouillage tombe pendant l’écriture.
    await context.addInitScript(() => {
      const original = crypto.subtle.encrypt.bind(crypto.subtle)
      crypto.subtle.encrypt = (async (...args: Parameters<SubtleCrypto['encrypt']>) => {
        if ((window as unknown as { __slow?: boolean }).__slow) {
          await new Promise((resolve) => setTimeout(resolve, 1_500))
        }
        return original(...args)
      }) as SubtleCrypto['encrypt']
    })

    await createVault(page)
    const dialog = await addLogin(page, 'Alpha')
    await dialog.getByRole('button', { name: 'Modifier' }).click()
    await dialog.getByLabel('Titre', { exact: true }).fill('Alpha modifié')

    await page.evaluate(() => ((window as unknown as { __slow: boolean }).__slow = true))
    await dialog.getByRole('button', { name: 'Enregistrer' }).click()
    await page.waitForTimeout(300)
    await setHidden(page, true)
    await expect(page.getByRole('heading', { name: 'Déverrouiller' })).toBeVisible()
    // Laisse l’écriture se terminer après le verrouillage.
    await page.waitForTimeout(4_000)
    await page.evaluate(() => ((window as unknown as { __slow: boolean }).__slow = false))
    await setHidden(page, false)

    await unlock(page)
    await expect(page.locator('.item-row').filter({ hasText: 'Alpha modifié' })).toHaveCount(1)
    await addLogin(page, 'Delta')
    await closeDialog(page)
    await lockFromToolbar(page)

    await page.reload()
    await unlock(page)
    const rows = page.locator('.item-row')
    await expect(rows.filter({ hasText: 'Alpha modifié' })).toHaveCount(1)
    await expect(rows.filter({ hasText: 'Delta' })).toHaveCount(1)
  })
})
