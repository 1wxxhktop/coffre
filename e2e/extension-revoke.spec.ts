import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault, openSettings, PASSWORD } from './helpers'

/**
 * Simule le runtime Tauri (comme `native-storage.spec.ts`) : stockage natif
 * du coffre, clé d’appairage du pont et copie gérée de l’extension, le tout
 * dans `localStorage`. Vérifie le parcours réel de révocation dans les
 * réglages, jusqu’à l’effacement de la clé.
 */
test('révoque les extensions associées depuis les réglages', async ({ page }) => {
  await createVault(page)
  await addLogin(page)
  await closeDialog(page)

  await page.addInitScript(() => {
    if (!location.search.includes('native=1')) return
    const prefix = 'e2e:native:'
    const read = (name: string) => localStorage.getItem(prefix + name)
    const write = (name: string, value: string | null) => {
      if (value === null) localStorage.removeItem(prefix + name)
      else localStorage.setItem(prefix + name, value)
    }
    // Une extension a déjà été associée.
    if (read('bridge-key') === null && read('bridge-key-revoked') === null) {
      write('bridge-key', 'q83vEjRWeJCrze8BI0VniavN7wEjRWeJq83vASNFZ4k=')
    }

    const internals = {
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        switch (command) {
          case 'vault_read':
            return read('current')
          case 'vault_backup_read':
            return read(`bak${String(args.generation)}`)
          case 'vault_backup_write':
            write(`bak${String(args.generation)}`, String(args.contents))
            return null
          case 'vault_write':
            write('bak1', read('current'))
            write('current', String(args.contents))
            return null
          case 'bridge_key_load':
            return read('bridge-key')
          case 'bridge_key_delete':
            write('bridge-key', null)
            write('bridge-key-revoked', '1')
            return null
          case 'extension_info':
            return {
              available: true,
              version: '0.17.0',
              path: '/Users/test/Library/Application Support/app.coffre.desktop/extension',
              updated: false,
            }
          default:
            throw new Error(`commande native inattendue : ${command}`)
        }
      },
    }
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals
  })

  await page.goto('/?native=1')
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()

  const settings = await openSettings(page, 'Mises à jour')
  const revoke = settings.getByRole('button', { name: 'Révoquer les extensions associées' })
  await expect(revoke).toBeVisible()

  // Annuler ne touche à rien.
  await revoke.click()
  const confirm = page.getByRole('dialog', { name: 'Révoquer les extensions associées ?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Annuler' }).click()
  await expect(confirm).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('e2e:native:bridge-key'))).not.toBeNull()

  // Confirmer efface la clé et retire le bouton.
  await revoke.click()
  await page
    .getByRole('dialog', { name: 'Révoquer les extensions associées ?' })
    .getByRole('button', { name: 'Révoquer', exact: true })
    .click()
  await expect(
    page.getByText('Extensions dissociées. Associez de nouveau celles que vous utilisez.'),
  ).toBeVisible()
  await expect(revoke).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('e2e:native:bridge-key'))).toBeNull()
})
