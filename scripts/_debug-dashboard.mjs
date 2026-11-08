import { chromium } from '@playwright/test'
const BASE = process.env.BASE_URL
const browser = await chromium.launch()

async function seed(page) {
  await page.goto(BASE + '/')
  await page.getByRole('heading', { name: 'Créer votre coffre' }).waitFor()
  await page.getByLabel('Mot de passe maître').fill('phrase de passe de test solide')
  await page.getByLabel('Confirmer le mot de passe').fill('phrase de passe de test solide')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Créer mon coffre' }).click()
  await page.getByRole('button', { name: 'Nouvel élément' }).waitFor({ timeout: 45000 })
  for (const [title, password] of [
    ['GitHub', 'abc123'],
    ['Banque', 'mot-de-passe-solide-2026!'],
    ['Proton Mail', 'reused-password'],
    ['Assistant', 'reused-password'],
  ]) {
    await page.getByRole('button', { name: 'Nouvel élément' }).click()
    const panel = page.locator('.item-panel')
    await panel.getByLabel('Titre', { exact: true }).fill(title)
    await panel.getByLabel('Identifiant', { exact: true }).fill('ada')
    await panel.getByLabel('Mot de passe', { exact: true }).fill(password)
    const save = page.locator('.detail-actionbar').getByRole('button', { name: 'Enregistrer' })
    if (await save.isVisible()) await save.click()
    else await panel.getByRole('button', { name: 'Enregistrer' }).click()
    await panel.getByRole('heading', { name: title }).waitFor()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

async function dashboardShot(width, height, theme, file) {
  const context = await browser.newContext({ viewport: { width, height } })
  await context.addInitScript((value) => {
    localStorage.setItem('coffre:settings:v1', JSON.stringify({ theme: value }))
  }, theme)
  const page = await context.newPage()
  await seed(page)
  if (width < 640) {
    await page.getByRole('button', { name: 'Accueil' }).click()
  } else {
    await page.getByRole('button', { name: 'Tableau de bord' }).first().click()
  }
  await page.locator('.dashboard').waitFor()
  await page.waitForTimeout(300)
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight,
    dashboard: Boolean(document.querySelector('.dashboard')),
  }))
  console.log(file, metrics)
  await page.screenshot({ path: `/tmp/${file}.png` })
  await context.close()
}

await dashboardShot(1280, 800, 'dark', 'dashboard-dark-1280')
await dashboardShot(1280, 800, 'light', 'dashboard-light-1280')
await dashboardShot(375, 812, 'dark', 'dashboard-dark-375')
await browser.close()
