import { test, expect, type Page } from '@playwright/test'

/**
 * Régression visuelle optionnelle.
 *
 * Les baselines dépendent du système (polices, rendu Chromium). Elles ne sont
 * donc pas exécutées dans la CI générale : lancez-les avec `VISUAL=1` et
 * régénérez-les dans l’environnement cible.
 *
 *   bun run test:visual --update-snapshots
 */
const enabled = process.env.VISUAL === '1'
test.skip(!enabled, 'Régression visuelle : lancer avec VISUAL=1.')

const VIEWPORT = { width: 1280, height: 800 }
const PASSWORD = 'phrase de passe de test solide'

async function createVault(page: Page) {
  await page.getByRole('heading', { name: 'Créer votre coffre' }).waitFor()
  await page.getByLabel('Mot de passe maître').fill(PASSWORD)
  await page.getByLabel('Confirmer le mot de passe').fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Créer mon coffre' }).click()
  await page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }).waitFor({ timeout: 45_000 })
}

async function addLogin(page: Page) {
  await page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('heading', { name: 'Nouvel élément' }).waitFor()
  await dialog.getByLabel('Titre', { exact: true }).fill('GitHub')
  await dialog.getByLabel('Identifiant', { exact: true }).fill('studio26')
  await dialog.getByLabel('Mot de passe', { exact: true }).fill('s3cret!')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.locator('.item-panel').getByRole('heading', { name: 'GitHub' }).waitFor()
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250)
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.01,
    stylePath: 'e2e/visual.css',
  })
}

for (const theme of ['dark', 'light'] as const) {
  test(`écrans principaux — thème ${theme}`, async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext({ viewport: VIEWPORT })
    await context.addInitScript((value) => {
      localStorage.setItem('coffre:settings:v1', JSON.stringify({ theme: value }))
    }, theme)
    const page = await context.newPage()

    await page.goto('/')
    await shot(page, `auth-${theme}.png`)

    await createVault(page)
    await shot(page, `empty-${theme}.png`)

    await addLogin(page)
    await shot(page, `detail-${theme}.png`)

    await page.keyboard.press('Escape')
    await shot(page, `list-${theme}.png`)

    await page.getByRole('button', { name: 'Tableau de bord' }).first().click()
    await page.locator('.dashboard').waitFor()
    await shot(page, `dashboard-${theme}.png`)

    await page.getByRole('button', { name: 'Réglages' }).first().click()
    const settings = page.getByRole('dialog')
    await settings.getByRole('heading', { name: 'Réglages' }).waitFor()
    await shot(page, `settings-${theme}.png`)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: /^Sécurité/ }).click()
    await page
      .getByRole('dialog')
      .getByRole('heading', { name: 'Sécurité du coffre' })
      .waitFor()
    await shot(page, `security-${theme}.png`)

    await context.close()
  })
}
