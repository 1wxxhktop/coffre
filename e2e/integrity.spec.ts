import { expect, test } from '@playwright/test'
import { createVault, PASSWORD } from './helpers'

/** Ouvre la base IndexedDB `coffre` du contexte de la page. */
async function withVaultStore<T>(
  page: import('@playwright/test').Page,
  callback: 'tamper' | 'bump-state',
): Promise<T> {
  return page.evaluate(async (mode) => {
    const request = indexedDB.open('coffre', 1)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const read = <V>(key: string) =>
        new Promise<V>((resolve, reject) => {
          const tx = db.transaction('vault', 'readonly')
          const get = tx.objectStore('vault').get(key)
          get.onsuccess = () => resolve(get.result as V)
          get.onerror = () => reject(get.error)
        })
      const write = async (key: string, value: unknown) => {
        const tx = db.transaction('vault', 'readwrite')
        tx.objectStore('vault').put(value, key)
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      }

      if (mode === 'tamper') {
        const file = await read<{
          vaults: Array<{ clock: { rev: number; writer: string } }>
        }>('current')
        if (!file?.vaults[0]?.clock) throw new Error('coffre non signé')
        file.vaults[0].clock.rev += 7
        await write('current', file)
      } else {
        const file = await read<{ id: string; revision: number; updatedAt: string }>(
          'current',
        )
        await write('state', {
          fileId: file.id,
          revision: file.revision + 5,
          updatedAt: new Date().toISOString(),
        })
      }
      return true as T
    } finally {
      db.close()
    }
  }, callback)
}

test.describe('intégrité du fichier', () => {
  test('ouvre en lecture seule un fichier altéré entre deux ouvertures', async ({
    page,
  }) => {
    await createVault(page)
    await withVaultStore(page, 'tamper')
    await page.reload()

    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Déverrouiller' }).click()

    await expect(page.getByRole('alert')).toContainText(
      'Coffre ouvert en lecture seule',
      { timeout: 45_000 },
    )
    await expect(page.getByRole('button', { name: 'Nouvel élément' })).toBeDisabled()
  })

  test('avertit lorsque la révision déjà vue est supérieure au fichier', async ({
    page,
  }) => {
    await createVault(page)
    await withVaultStore(page, 'bump-state')
    await page.reload()

    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Déverrouiller' }).click()

    await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 45_000 })
    await expect(page.locator('.banner')).toContainText('avertissement')
    await page.getByText('Voir les détails').click()
    await expect(page.locator('.banner')).toContainText('version antérieure')
  })
})
