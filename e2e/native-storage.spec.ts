import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault, openSettings, PASSWORD } from './helpers'

/**
 * Simule le runtime Tauri dans la page Web : `isTauriRuntime()` devient vrai et
 * les commandes `vault_*` sont implémentées avec `localStorage`. Cela permet de
 * tester le chemin natif et la migration IndexedDB → natif sans lancer Tauri.
 */
test('migre le coffre IndexedDB vers le stockage natif puis conserve les sauvegardes', async ({
  page,
}) => {
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

    const internals = {
      invoke: async (
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<unknown> => {
        switch (command) {
          case 'vault_read':
            return read('current')
          case 'vault_backup_read':
            return read(`bak${String(args.generation)}`)
          case 'vault_backup_write':
            write(`bak${String(args.generation)}`, String(args.contents))
            return null
          case 'vault_write': {
            // Même rotation que `vault_store.rs` : l’ancien courant devient bak1.
            for (let generation = 3; generation > 1; generation -= 1) {
              write(`bak${generation}`, read(`bak${generation - 1}`))
            }
            write('bak1', read('current'))
            write('current', String(args.contents))
            return null
          }
          case 'vault_clear':
            write('current', null)
            write('bak1', null)
            write('bak2', null)
            write('bak3', null)
            return null
          default:
            throw new Error(`commande native inattendue : ${command}`)
        }
      },
    }
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals
  })

  await page.goto('/?native=1')
  await expect(page.getByRole('heading', { name: 'Déverrouiller' })).toBeVisible()

  const migrated = await page.evaluate(() => {
    const raw = localStorage.getItem('e2e:native:current')
    return raw ? (JSON.parse(raw) as { format?: string; items?: unknown[] }) : null
  })
  expect(migrated?.format).toBe('coffre')
  expect(migrated?.items).toHaveLength(1)

  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible({
    timeout: 45_000,
  })

  const settings = await openSettings(page)
  await expect(settings.getByText('Stockage natif', { exact: true })).toBeVisible()
  await expect(settings.getByText(/trois sauvegardes tournantes/)).toBeVisible()
  await closeDialog(page)

  await addLogin(page, 'GitLab', 'studio26', 'autre-secret')
  await closeDialog(page)

  const store = await page.evaluate(() => {
    const rawCurrent = localStorage.getItem('e2e:native:current')
    const rawBackup = localStorage.getItem('e2e:native:bak1')
    return {
      currentItems: rawCurrent
        ? (JSON.parse(rawCurrent) as { items: unknown[] }).items.length
        : -1,
      backupItems: rawBackup
        ? (JSON.parse(rawBackup) as { items: unknown[] }).items.length
        : -1,
      current: rawCurrent,
      backup: rawBackup,
    }
  })
  expect(store.currentItems).toBe(2)
  expect(store.backupItems).toBe(1)
  expect(store.current).not.toBe(store.backup)

  // Un rechargement lit directement le fichier natif, sans re-migration.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Déverrouiller' })).toBeVisible()
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible({
    timeout: 45_000,
  })
  await expect(page.locator('.item-row').filter({ hasText: 'GitLab' })).toBeVisible()
})
