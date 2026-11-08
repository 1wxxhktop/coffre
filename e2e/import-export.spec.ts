import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault, openSettings, PASSWORD } from './helpers'

test.describe('import et sauvegarde', () => {
  test('importe un CSV générique dans le coffre', async ({ page }) => {
    await createVault(page)
    const settings = await openSettings(page, 'Sauvegarde et import')

    const csv = [
      'name,url,username,password,notes',
      'GitLab,https://gitlab.com,studio26,motdepasse1,Compte professionnel',
      'Banque,https://banque.fr,client,secret2,',
    ].join('\n')

    await settings.locator('input[type="file"][accept*=".csv"]').setInputFiles({
      name: 'export.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    })

    await expect(
      settings.getByRole('button', { name: 'Importer 2 éléments' }),
    ).toBeVisible()
    await settings.getByRole('button', { name: 'Importer 2 éléments' }).click()
    await expect(settings.getByText(/2 éléments ajoutés au coffre/)).toBeVisible({
      timeout: 45_000,
    })
    await closeDialog(page)

    await expect(page.locator('.item-row').filter({ hasText: 'GitLab' })).toBeVisible()
    await expect(page.locator('.item-row').filter({ hasText: 'Banque' })).toBeVisible()
  })

  test('importe un export Proton Pass en ignorant les doublons', async ({ page }) => {
    await createVault(page)
    await addLogin(page)
    await closeDialog(page)

    const settings = await openSettings(page, 'Sauvegarde et import')
    const protonExport = {
      version: '1.0.0',
      userId: 'user-1',
      encrypted: false,
      vaults: {
        'share-1': {
          name: 'Personnel',
          items: [
            {
              itemId: 'item-1',
              state: 1,
              data: {
                metadata: { name: 'GitHub', note: 'Compte principal' },
                type: 'login',
                content: {
                  username: 'studio26',
                  password: 's3cret!',
                  urls: ['https://github.com'],
                },
              },
            },
            {
              itemId: 'item-2',
              state: 1,
              data: {
                metadata: { name: 'Proton Mail' },
                type: 'login',
                content: {
                  username: 'ada@proton.me',
                  password: 'autre-secret',
                  urls: ['https://mail.proton.me'],
                },
              },
            },
          ],
        },
      },
    }

    await settings.locator('input[type="file"][accept*=".csv"]').setInputFiles({
      name: 'proton-pass.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(protonExport)),
    })

    await expect(
      settings.locator('.import-summary').getByText(/JSON Proton Pass/),
    ).toBeVisible()
    await expect(
      settings.locator('.import-summary').getByText(/1 doublon/),
    ).toBeVisible()
    await expect(
      settings.getByRole('button', { name: 'Importer 1 élément' }),
    ).toBeVisible()
    await settings.getByRole('button', { name: 'Importer 1 élément' }).click()
    await expect(settings.getByText(/1 élément ajouté au coffre/)).toBeVisible({
      timeout: 45_000,
    })
    await expect(settings.getByText(/1 doublon ignoré/)).toBeVisible()
    await closeDialog(page)

    await expect(page.locator('.item-row').filter({ hasText: 'Proton Mail' })).toBeVisible()
    await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toHaveCount(1)
  })

  test('importe un export Enpass avec dossiers et champs', async ({ page }) => {
    await createVault(page)
    const settings = await openSettings(page, 'Sauvegarde et import')

    const enpassExport = {
      folders: [
        { uuid: 'folder-1', parent_uuid: '', title: 'Travail' },
      ],
      items: [
        {
          uuid: 'item-1',
          title: 'Enpass',
          subtitle: 'ada',
          category: 'login',
          favorite: 1,
          folders: ['folder-1'],
          note: 'Compte importé depuis Enpass',
          fields: [
            { label: 'Username', type: 'username', value: 'ada', sensitive: 0 },
            { label: 'Password', type: 'password', value: 's3cret!', sensitive: 1 },
            { label: 'Website', type: 'url', value: 'https://enpass.io', sensitive: 0 },
            { label: 'Clé API', type: 'text', value: 'abc-123', sensitive: 1 },
          ],
        },
      ],
    }

    await settings.locator('input[type="file"][accept*=".csv"]').setInputFiles({
      name: 'enpass.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(enpassExport)),
    })

    await expect(
      settings.locator('.import-summary').getByText(/JSON Enpass/),
    ).toBeVisible()
    await expect(
      settings.getByRole('button', { name: 'Importer 1 élément' }),
    ).toBeVisible()
    await settings.getByRole('button', { name: 'Importer 1 élément' }).click()
    await expect(settings.getByText(/1 élément ajouté au coffre/)).toBeVisible({
      timeout: 45_000,
    })
    await closeDialog(page)

    const card = page.locator('.item-row').filter({ hasText: 'Enpass' })
    await expect(card).toBeVisible()
    await card.click()

    const panel = page.locator('.item-panel')
    await expect(panel.getByRole('heading', { name: 'Enpass' })).toBeVisible()
    await panel.getByRole('button', { name: 'Afficher Mot de passe' }).click()
    await expect(panel.getByText('s3cret!')).toBeVisible()
    await panel.getByRole('button', { name: 'Afficher Clé API' }).click()
    await expect(panel.getByText('abc-123')).toBeVisible()
  })


  test('exporte en CSV Apple puis au format complet', async ({
    page,
  }, testInfo) => {
    await createVault(page)
    await addLogin(page, 'GitHub', 'studio26', 's3cret!', 'https://github.com')
    await closeDialog(page)

    const settings = await openSettings(page, 'Sauvegarde et import')
    await expect(settings.getByLabel('Format CSV')).toHaveValue('apple')

    const downloadPromise = page.waitForEvent('download')
    await settings.getByRole('button', { name: 'Exporter en CSV' }).click()
    const download = await downloadPromise
    const csvPath = testInfo.outputPath('mots-de-passe.csv')
    await download.saveAs(csvPath)

    const content = await readFile(csvPath, 'utf8')
    const [header, row] = content.split('\r\n')
    expect(header).toBe('Title,URL,Username,Password,Notes,OTPAuth')
    expect(row).toContain('GitHub,https://github.com,studio26,s3cret!')
    expect(content.endsWith('\r\n')).toBe(true)

    await settings.getByLabel('Format CSV').selectOption('coffre')
    const fullDownloadPromise = page.waitForEvent('download')
    await settings.getByRole('button', { name: 'Exporter en CSV' }).click()
    const fullDownload = await fullDownloadPromise
    const fullPath = testInfo.outputPath('coffre-complet.csv')
    await fullDownload.saveAs(fullPath)
    const fullContent = await readFile(fullPath, 'utf8')
    const [fullHeader] = fullContent.split('\r\n')
    expect(fullHeader).toContain('type,title,url,username,password')
    expect(fullContent).toContain('GitHub')
  })

  test('exporte puis réimporte le coffre', async ({ page }, testInfo) => {
    await createVault(page)
    await addLogin(page)
    await closeDialog(page)

    const settings = await openSettings(page, 'Sauvegarde et import')
    const downloadPromise = page.waitForEvent('download')
    await settings.getByRole('button', { name: 'Exporter le coffre' }).click()
    const download = await downloadPromise
    const exportPath = testInfo.outputPath('sauvegarde.coffre')
    await download.saveAs(exportPath)

    await settings
      .locator('input[type="file"][accept=".coffre,.json,application/json"]')
      .setInputFiles(exportPath)
    await settings.getByLabel('Mot de passe du fichier').fill(PASSWORD)
    await settings.getByLabel(/Je comprends que le coffre local actuel/).check()
    await settings.getByRole('button', { name: 'Remplacer par ce coffre' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 45_000 })
    const card = page.locator('.item-row').filter({ hasText: 'GitHub' })
    await expect(card).toBeVisible()
    await card.click()

    const panel = page.locator('.item-panel')
    await expect(panel.getByRole('heading', { name: 'GitHub' })).toBeVisible()
    await panel.getByRole('button', { name: 'Afficher Mot de passe' }).click()
    await expect(panel.getByText('s3cret!')).toBeVisible()
  })
})
