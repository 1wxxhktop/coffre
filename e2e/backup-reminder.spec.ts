import { expect, test } from '@playwright/test'
import { closeDialog, createVault, openSettings } from './helpers'

test.describe('sauvegardes planifiées sur le Web', () => {
  test('rappelle l’export puis l’efface après une sauvegarde manuelle', async ({
    page,
    baseURL,
  }) => {
    const appHost = new URL(baseURL ?? 'http://127.0.0.1:4173').host
    const external: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.host !== appHost
      ) {
        external.push(request.url())
      }
    })

    await createVault(page)

    const settings = await openSettings(page, 'Sauvegarde et import')
    await expect(
      settings.getByRole('heading', { name: 'Sauvegardes planifiées' }),
    ).toBeVisible()
    await settings.getByLabel('Fréquence').selectOption('daily')
    await expect(
      settings.getByText('Aucune sauvegarde planifiée n’a encore réussi.'),
    ).toBeVisible()
    await closeDialog(page)

    const alert = page.locator('.dashboard-backup-alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('Sauvegarde planifiée')
    await expect(alert).toContainText(
      'Aucune sauvegarde planifiée n’a encore réussi.',
    )

    const backupSettings = await openSettings(page, 'Sauvegarde et import')
    const download = page.waitForEvent('download')
    await backupSettings
      .getByRole('button', { name: 'Exporter le coffre' })
      .click()
    await download
    await closeDialog(page)

    await expect(page.locator('.dashboard-backup-alert')).toHaveCount(0)
    expect(external).toEqual([])
  })
})
