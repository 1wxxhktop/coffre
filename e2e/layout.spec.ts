import { expect, test, type Page } from '@playwright/test'
import { addLogin, closeDialog, createVault, showItems, PASSWORD } from './helpers'

async function drag(page: Page, handleName: string, deltaX: number) {
  const handle = page.getByRole('separator', { name: handleName })
  const box = await handle.boundingBox()
  if (!box) throw new Error(`Poignée introuvable : ${handleName}`)
  await page.mouse.move(box.x + box.width / 2, box.y + 160)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + 160, { steps: 8 })
  await page.mouse.up()
}

test('redimensionne les colonnes et mémorise les largeurs', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await createVault(page)
  await addLogin(page)
  await closeDialog(page)

  const defaultSidebar = await page
    .locator('.sidebar')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).width))
  const defaultList = await page
    .locator('.list-pane')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).width))

  await drag(page, 'Redimensionner la barre latérale', 80)
  await expect
    .poll(() =>
      page
        .locator('.sidebar')
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).width)),
    )
    .toBeGreaterThan(defaultSidebar + 40)

  await drag(page, 'Redimensionner la liste des éléments', 90)
  await expect
    .poll(() =>
      page
        .locator('.list-pane')
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).width)),
    )
    .toBeGreaterThan(defaultList + 50)

  const stored = await page.evaluate(() => ({
    sidebar: Number(localStorage.getItem('coffre:ui:sidebar-width')),
    list: Number(localStorage.getItem('coffre:ui:list-width')),
  }))

  await page.reload()
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await showItems(page)
  await expect(page.locator('.item-row').first()).toBeVisible({ timeout: 45_000 })

  const restoredSidebar = await page
    .locator('.sidebar')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).width))
  const restoredList = await page
    .locator('.list-pane')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).width))
  expect(restoredSidebar).toBeCloseTo(stored.sidebar, 0)
  expect(restoredList).toBeCloseTo(stored.list, 0)
})

test('replie la barre latérale en icônes puis la déploie', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await createVault(page)

  const sidebar = page.locator('.sidebar')
  const brandText = page.locator('.sidebar .brand__text')
  const allItems = page.getByRole('button', { name: 'Tous les éléments' })
  await expect(brandText).toBeVisible()
  await expect(allItems).toBeVisible()

  await page.getByRole('button', { name: 'Réduire la barre latérale' }).click()
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await expect
    .poll(() =>
      sidebar.evaluate((element) => Number.parseFloat(getComputedStyle(element).width)),
    )
    .toBe(64)
  await expect(brandText).toBeHidden()
  await expect(page.locator('.sidebar__section-label').first()).toBeHidden()
  await expect(allItems.locator('span').first()).toBeHidden()
  await expect(allItems).toHaveAttribute('aria-label', 'Tous les éléments')
  await expect(page.getByRole('button', { name: 'Déployer la barre latérale' })).toBeVisible()

  await page.reload()
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.locator('.sidebar')).toHaveClass(/is-collapsed/)
  await expect
    .poll(() =>
      page
        .locator('.sidebar')
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).width)),
    )
    .toBe(64)

  await page.getByRole('button', { name: 'Déployer la barre latérale' }).click()
  await expect(sidebar).not.toHaveClass(/is-collapsed/)
  await expect(brandText).toBeVisible()
  await expect(allItems).toBeVisible()
})

test('les poignées sont masquées sur mobile et le menu reste lisible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await createVault(page)
  await addLogin(page)
  await closeDialog(page)

  const sidebarHandle = page.locator('.column-resizer--sidebar')
  await expect(sidebarHandle).toHaveCount(1)
  await expect(sidebarHandle).toBeHidden()
  const listHandle = page.locator('.column-resizer--list')
  await expect(listHandle).toHaveCount(1)
  await expect(listHandle).toBeHidden()

  await page.getByRole('button', { name: 'Ouvrir le menu' }).click()
  await expect(page.locator('.sidebar').getByText('Tous les coffres')).toBeVisible()
  await expect(page.locator('.sidebar .brand__text')).toBeVisible()
})


test('le titre de la ligne reste lisible à la largeur par défaut', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await createVault(page)
  const longTitle = 'Compte professionnel GitHub avec un titre assez long'
  await addLogin(page, longTitle, 'ada', 'abc123')
  await closeDialog(page)

  const metrics = await page
    .locator('.item-row__title-text')
    .first()
    .evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      text: element.textContent,
    }))
  expect(metrics.text).toContain(longTitle)
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1)
})

test('garde l’en-tête et le pied de la barre latérale fixes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 })
  await createVault(page)

  const head = page.locator('.sidebar__head')
  const footer = page.locator('.sidebar__footer')
  const scroll = page.locator('.sidebar__scroll')
  await expect(head).toBeVisible()
  await expect(footer).toBeVisible()

  const beforeHead = await head.boundingBox()
  const beforeFooter = await footer.boundingBox()
  if (!beforeHead || !beforeFooter) throw new Error('Barre latérale incomplète')

  expect(
    await scroll.evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true)
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)

  const afterHead = await head.boundingBox()
  const afterFooter = await footer.boundingBox()
  expect(afterHead?.y).toBeCloseTo(beforeHead.y, 0)
  expect(afterFooter?.y).toBeCloseTo(beforeFooter.y, 0)

  const viewport = page.viewportSize()
  expect((afterFooter?.y ?? 0) + (afterFooter?.height ?? 0)).toBeLessThanOrEqual(
    (viewport?.height ?? 0) + 1,
  )
})

test('sélectionne ou crée un coffre depuis le menu supérieur', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await createVault(page)

  const trigger = page.locator('.sidebar__vault-trigger')
  await expect(trigger).toContainText('Tous les coffres')
  await trigger.click()

  const menu = page.getByRole('menu', { name: 'Choisir un coffre' })
  await expect(menu).toBeVisible()
  await expect(
    menu.getByRole('menuitemradio', { name: /Tous les coffres/ }),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(
    menu.getByRole('menuitemradio', { name: /Personnel/ }),
  ).toBeVisible()

  await menu.getByRole('menuitem', { name: 'Créer un coffre' }).click()
  await expect(page.getByRole('dialog')).toContainText('Nouveau coffre')
})
