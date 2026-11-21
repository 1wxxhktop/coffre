import { expect, test } from '@playwright/test'
import {
  addLogin,
  closeDialog,
  createVault,
  openSettings,
  sortItems,
} from './helpers'

test('groupe automatiquement les éléments par date', async ({ page }) => {
  await createVault(page)
  await addLogin(page, 'Alpha')
  await closeDialog(page)
  await addLogin(page, 'Beta')
  await closeDialog(page)

  const groups = page.locator('.item-group')
  await expect(groups).toHaveCount(1)
  await expect(
    groups.first().getByRole('heading', { name: /aujourd’hui/i }),
  ).toBeVisible()

  const rows = groups.first().locator('.item-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Alpha')
  await expect(rows.nth(1)).toContainText('Beta')

  // Le tri choisi s’applique à l’intérieur du groupe.
  await sortItems(page, 'Créés')
  await expect(page.locator('.item-group')).toHaveCount(1)
  await expect(
    page.locator('.item-group').first().getByRole('heading', {
      name: /aujourd’hui/i,
    }),
  ).toBeVisible()

  // L’interrupteur revient à une liste plate.
  await page.getByRole('button', { name: 'Options de la liste' }).click()
  const toggle = page.getByRole('menuitemcheckbox', { name: 'Grouper par date' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(page.locator('.item-group')).toHaveCount(0)
  await expect(page.locator('.item-row')).toHaveCount(2)
})

test('les en-têtes de date restent lisibles au défilement mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(`
    (() => {
      const RealDate = Date;
      let offset = 0;
      class FakeDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) super(RealDate.now() + offset);
          else super(...args);
        }
        static now() { return RealDate.now() + offset; }
      }
      window.Date = FakeDate;
      window.__setCoffreDateOffset = (ms) => { offset = ms; };
    })();
  `)
  const setOffset = (ms: number) =>
    page.evaluate(
      (value) => (window as unknown as { __setCoffreDateOffset: (n: number) => void }).__setCoffreDateOffset(value),
      ms,
    )

  const importRows = async (prefix: string) => {
    const settings = await openSettings(page, 'Sauvegarde et import')
    const csv = [
      'name,url,username,password,notes',
      ...Array.from(
        { length: 8 },
        (_, index) => `${prefix} ${index},https://example.com/${index},ada,secret-${index},`,
      ),
    ].join('\n')
    await settings.locator('input[type="file"][accept*=".csv"]').setInputFiles({
      name: 'lot.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    })
    await settings.getByRole('button', { name: /Importer 8 éléments/ }).click()
    await expect(settings.getByText(/8 éléments ajoutés au coffre/)).toBeVisible({
      timeout: 45_000,
    })
    await closeDialog(page)
  }

  await createVault(page)
  await setOffset(-3 * 24 * 60 * 60 * 1000)
  await importRows('Semaine')
  await setOffset(0)
  await importRows('Aujourd hui')
  await page
    .locator('.mobile-tabs')
    .getByRole('button', { name: 'Coffre', exact: true })
    .click()

  const header = page
    .locator('.item-group__title')
    .filter({ hasText: /7 derniers jours|7 days/i })
  await header.evaluate((element) =>
    element.scrollIntoView({ block: 'start', behavior: 'instant' }),
  )
  await expect(header).toBeVisible()
  const group = page.locator('.item-group').filter({ has: header })
  const firstRow = group.locator('.item-row').first()
  await expect(firstRow).toBeVisible()
  expect(
    await page
      .locator('.mobile-list-tools')
      .evaluate((element) => getComputedStyle(element).position),
  ).toBe('static')
  expect(
    await header.evaluate((element) => getComputedStyle(element).position),
  ).toBe('static')
  expect(
    await firstRow.evaluate(
      (element) => getComputedStyle(element).contentVisibility,
    ),
  ).toBe('visible')
})
