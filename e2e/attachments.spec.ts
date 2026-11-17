import { expect, test } from '@playwright/test'
import { addLogin, createVault } from './helpers'

const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=',
  'base64',
)

test('prévisualise une pièce jointe image sans la télécharger', async ({ page }) => {
  await createVault(page)
  const panel = await addLogin(page, 'Aperçu')

  await panel.getByRole('button', { name: 'Modifier' }).click()
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: PNG_PIXEL,
  })
  await expect(panel.getByText('pixel.png')).toBeVisible()
  await panel.getByRole('button', { name: 'Enregistrer' }).click()

  const previewButton = panel.getByRole('button', { name: 'Aperçu de pixel.png' })
  await expect(previewButton).toBeVisible()
  await previewButton.click()

  const preview = page.getByRole('dialog', { name: 'pixel.png' })
  await expect(preview).toBeVisible()
  await expect(preview.locator('img.blob-preview')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
})
