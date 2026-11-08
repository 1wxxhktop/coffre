import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault } from './helpers'

const HASH = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8'
const PREFIX = HASH.slice(0, 5)
const SUFFIX = HASH.slice(5)

test('vérifie les fuites en k-anonymat uniquement après activation', async ({
  page,
}) => {
  const requests: string[] = []
  await page.route('https://api.pwnedpasswords.com/range/**', async (route) => {
    requests.push(route.request().url())
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET',
          'access-control-allow-headers': 'Add-Padding',
        },
      })
      return
    }
    expect(route.request().headers()['add-padding']).toBe('true')
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      headers: { 'access-control-allow-origin': '*' },
      body: `${SUFFIX}:42\r\n${'0'.repeat(35)}:0\r\n`,
    })
  })

  await createVault(page)
  await addLogin(page, 'GitHub', 'ada', 'password')
  await closeDialog(page)

  await page.getByRole('button', { name: /^Sécurité/ }).click()
  let security = page.getByRole('dialog')
  await expect(security.getByText('Fuites connues')).toBeVisible()
  await expect(security.getByText(/Surveillance désactivée/)).toBeVisible()
  expect(requests).toHaveLength(0)

  await security.getByRole('button', { name: 'Ouvrir les réglages' }).click()
  const settings = page.getByRole('dialog')
  await expect(settings.getByRole('heading', { name: 'Réglages' })).toBeVisible()
  await settings.getByRole('button', { name: 'Sécurité', exact: true }).click()
  await settings
    .getByRole('checkbox', { name: /fuites connues/i })
    .check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: /^Sécurité/ }).click()
  security = page.getByRole('dialog')
  await expect(security.getByText(/Aucune vérification récente/)).toBeVisible()
  await security.getByRole('button', { name: 'Vérifier maintenant' }).click()
  await expect(
    security.getByText('1 mot de passe compromis détecté.'),
  ).toBeVisible()

  expect(requests.length).toBeGreaterThanOrEqual(1)
  for (const url of requests) {
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`)
    const pathname = new URL(url).pathname
    expect(pathname).not.toContain(HASH)
    expect(pathname).not.toContain(SUFFIX)
    expect(pathname).not.toContain('password')
  }

  await security
    .getByRole('button', { name: /Mots de passe compromis/ })
    .click()
  await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible()
})
