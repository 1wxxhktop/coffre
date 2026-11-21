// @ts-nocheck
import { test } from '@playwright/test'
import { addLogin, closeDialog, createVault, openSettings } from './helpers'

const OUT = '/private/var/folders/mj/x85v_5kj60947727q0c0xl640000gn/T/opencode/mobile-dark'

test('audit sombre et changement d’onglets', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('coffre:settings:v1', JSON.stringify({ theme: 'dark' }))
  })
  await createVault(page)
  for (let index = 0; index < 6; index += 1) {
    await addLogin(page, `Compte ${index}`)
    await closeDialog(page)
  }
  await page
    .locator('.mobile-tabs')
    .getByRole('button', { name: 'Coffre', exact: true })
    .click()
  await page.waitForTimeout(300)
  await page.locator('.list-pane').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await page.waitForTimeout(300)

  const shot = async (name) => {
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${OUT}/${name}.png` })
  }
  await shot('01-list-bottom')
  await page
    .locator('.mobile-tabs')
    .getByRole('button', { name: 'Accueil', exact: true })
    .click()
  await shot('02-after-home')
  await page
    .locator('.mobile-tabs')
    .getByRole('button', { name: 'Coffre', exact: true })
    .click()
  await shot('03-after-vault')
  await page
    .locator('.mobile-tabs')
    .getByRole('button', { name: 'Favoris', exact: true })
    .click()
  await shot('04-after-favorites')
  await page
    .locator('.mobile-tabs')
    .getByRole('button', { name: 'Récents', exact: true })
    .click()
  await shot('05-after-recent')

  await page
    .locator('.mobile-tabs')
    .getByRole('button', { name: 'Coffre', exact: true })
    .click()
  await page.locator('.item-row').first().click()
  await page.waitForTimeout(300)
  await shot('06-detail')
  await page
    .locator('.mobile-tabs')
    .getByRole('button', { name: 'Accueil', exact: true })
    .click()
  await shot('07-detail-to-home')
  await page
    .locator('.mobile-tabs')
    .getByRole('button', { name: 'Coffre', exact: true })
    .click()
  await page.waitForTimeout(200)
  await openSettings(page)
  await page.waitForTimeout(300)
  await shot('08-settings')
  await page
    .locator('.mobile-tabs')
    .getByRole('button', { name: 'Coffre', exact: true })
    .click()
  await shot('09-settings-to-vault')

  const metrics = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-tabs')
    const style = nav ? getComputedStyle(nav) : null
    const list = document.querySelector('.list-pane')
    const dashboard = document.querySelector('.dashboard')
    const dialogs = document.querySelectorAll('.modal-overlay')
    const atBottom = document.elementFromPoint(innerWidth / 2, innerHeight - 20)
    return {
      navBackground: style?.backgroundColor,
      navBackdrop: style?.backdropFilter,
      navRect: nav
        ? (() => {
            const rect = nav.getBoundingClientRect()
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          })()
        : null,
      list: list
        ? { scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight }
        : null,
      dashboard: dashboard
        ? { scrollTop: dashboard.scrollTop, scrollHeight: dashboard.scrollHeight, clientHeight: dashboard.clientHeight }
        : null,
      dialogs: dialogs.length,
      bottomElement: atBottom
        ? { tag: atBottom.tagName, className: atBottom.className, background: getComputedStyle(atBottom).backgroundColor }
        : null,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      htmlTheme: document.documentElement.dataset.theme,
    }
  })
  console.log('METRICS', JSON.stringify(metrics, null, 2))
})
