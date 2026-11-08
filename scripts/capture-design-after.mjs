import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.BASE_URL
const OUT = 'docs/design-captures/after'
const password = 'phrase de passe de test solide'
await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()

async function contextFor(width, height, theme) {
  const context = await browser.newContext({ viewport: { width, height } })
  await context.addInitScript((value) => {
    localStorage.setItem('coffre:settings:v1', JSON.stringify({ theme: value }))
  }, theme)
  return context
}

async function createVault(page) {
  await page.goto(BASE + '/')
  await page.getByRole('heading', { name: 'Créer votre coffre' }).waitFor()
  await page.getByLabel('Mot de passe maître').fill(password)
  await page.getByLabel('Confirmer le mot de passe').fill(password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Créer mon coffre' }).click()
  await page.getByRole('button', { name: 'Nouvel élément' }).waitFor({ timeout: 45000 })
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 })
}

async function run(width, height, theme) {
  const context = await contextFor(width, height, theme)
  const page = await context.newPage()
  const suffix = `${theme}-${width}`

  await page.goto(BASE + '/')
  await page.getByRole('heading', { name: 'Créer votre coffre' }).waitFor()
  await shot(page, `auth-${suffix}`)
  await createVault(page)

  await page.getByRole('button', { name: 'Nouvel élément' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('heading', { name: 'Nouvel élément' }).waitFor()
  await dialog.getByLabel('Titre', { exact: true }).fill('GitHub')
  await dialog.getByLabel('Identifiant', { exact: true }).fill('studio26')
  await dialog.getByLabel('Mot de passe', { exact: true }).fill('s3cret!')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.locator('.item-panel').getByRole('heading', { name: 'GitHub' }).waitFor()
  await page.waitForTimeout(250)
  await shot(page, `detail-${suffix}`)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await shot(page, `list-${suffix}`)

  if (width < 640) {
    await page.getByRole('button', { name: 'Accueil' }).click()
  } else {
    await page.getByRole('button', { name: 'Tableau de bord' }).first().click()
  }
  await page.locator('.dashboard').waitFor()
  await page.waitForTimeout(300)
  await shot(page, `dashboard-${suffix}`)

  if (width < 640) {
    await page.getByRole('button', { name: 'Réglages' }).click()
  } else {
    await page.getByRole('button', { name: 'Réglages' }).first().click()
  }
  const settings = page.getByRole('dialog')
  await settings.getByRole('heading', { name: 'Réglages' }).waitFor()
  if (width < 640) {
    await settings.getByRole('button', { name: 'Général', exact: true }).click()
  }
  await page.waitForTimeout(250)
  await shot(page, `settings-${suffix}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  if (width < 640) {
    await page.getByRole('button', { name: 'Sécurité', exact: true }).click()
  } else {
    await page.getByRole('button', { name: /^Sécurité/ }).click()
  }
  await page
    .getByRole('dialog')
    .getByRole('heading', { name: 'Sécurité du coffre' })
    .waitFor()
  await page.waitForTimeout(250)
  await shot(page, `security-${suffix}`)
  await context.close()
}

await run(1280, 800, 'dark')
await run(1280, 800, 'light')
await run(375, 812, 'dark')
await run(375, 812, 'light')
await browser.close()
console.log('after captures done')
