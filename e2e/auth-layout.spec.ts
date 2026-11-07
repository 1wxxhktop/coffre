import { expect, test } from '@playwright/test'

test.describe('mise en page de l’authentification', () => {
  test('ne défile pas sur une fenêtre de bureau', async ({ page }) => {
    for (const height of [800, 900, 1000]) {
      await page.setViewportSize({ width: 1180, height })
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Créer votre coffre' })).toBeVisible()
      const metrics = await page.evaluate(() => ({
        viewport: innerHeight,
        document: document.documentElement.scrollHeight,
      }))
      expect(metrics.document, `hauteur ${height}`).toBeLessThanOrEqual(metrics.viewport)
    }
  })
})
