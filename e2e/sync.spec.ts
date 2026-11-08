import { expect, test } from '@playwright/test'
import { closeDialog, createVault, openSettings, PASSWORD } from './helpers'

test.describe('synchronisation', () => {
  test('propose la synchronisation par dossier ou le repli manuel', async ({
    page,
  }) => {
    await createVault(page)
    const settings = await openSettings(page, 'Synchronisation')
    const supported = await page.evaluate(
      () => 'showDirectoryPicker' in window,
    )
    if (supported) {
      await expect(
        settings.getByRole('button', { name: 'Choisir un dossier' }),
      ).toBeVisible()
    } else {
      await expect(
        settings.getByText(/ne propose pas de sélection de dossier local/),
      ).toBeVisible()
    }
    await closeDialog(page)
  })

  test('configure un dossier Web et écrit un snapshot chiffré', async ({ page }) => {
    await page.addInitScript(() => {
      if (!('showDirectoryPicker' in window)) return
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async () => {
          const root = await navigator.storage.getDirectory()
          return root.getDirectoryHandle('coffre-e2e-sync', { create: true })
        },
      })
    })
    await createVault(page)
    const supported = await page.evaluate(
      () => 'showDirectoryPicker' in window,
    )
    test.skip(!supported, 'File System Access API indisponible sur ce moteur')

    const settings = await openSettings(page, 'Synchronisation')
    await settings.getByRole('button', { name: 'Choisir un dossier' }).click()
    await expect(settings.getByText('Dernière synchronisation :')).toBeVisible({
      timeout: 20_000,
    })

    const files = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const syncRoot = await root.getDirectoryHandle('coffre-e2e-sync')
      const coffre = await syncRoot.getDirectoryHandle('Coffre')
      const result: Array<{ name: string; contents: string }> = []
      for await (const [, vaultHandle] of coffre.entries()) {
        if (vaultHandle.kind !== 'directory') continue
        for await (const [name, entry] of vaultHandle.entries()) {
          if (entry.kind !== 'file' || !name.endsWith('.coffre')) continue
          const file = await entry.getFile()
          result.push({ name, contents: await file.text() })
        }
      }
      return result
    })

    expect(files).toHaveLength(1)
    expect(files[0].contents.startsWith('{"format":"coffre"')).toBe(true)
    expect(files[0].contents).toContain('"integrity"')

    // Le handle de dossier doit survivre à un rechargement de la page.
    await page.reload()
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Déverrouiller' }).click()
    await expect(page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' })).toBeVisible({
      timeout: 45_000,
    })
    const reopenedSettings = await openSettings(page, 'Synchronisation')
    await expect(reopenedSettings.getByText('Dernière synchronisation :')).toBeVisible()

    // Simule un second appareil en copiant le fichier signé sous un autre nom,
    // puis vérifie que la synchronisation le lit et le fusionne sans erreur.
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const syncRoot = await root.getDirectoryHandle('coffre-e2e-sync')
      const coffre = await syncRoot.getDirectoryHandle('Coffre')
      for await (const [, vaultHandle] of coffre.entries()) {
        if (vaultHandle.kind !== 'directory') continue
        for await (const [name, entry] of vaultHandle.entries()) {
          if (entry.kind !== 'file' || !name.endsWith('.coffre')) continue
          const contents = await (await entry.getFile()).text()
          const remote = await vaultHandle.getFileHandle('w_remote.coffre', {
            create: true,
          })
          const writable = await remote.createWritable()
          await writable.write(contents)
          await writable.close()
          return
        }
      }
      throw new Error('aucun fichier de synchronisation')
    })

    await reopenedSettings.getByRole('button', { name: 'Synchroniser maintenant' }).click()
    await expect(page.getByText('Synchronisation terminée.')).toBeVisible({
      timeout: 20_000,
    })
    await closeDialog(page)
  })
})
