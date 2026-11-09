import { expect, test, chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test.describe('extension — historique du générateur', () => {
  test.skip(({ browserName }) => browserName !== 'chromium')

  test('un mot de passe copié depuis l’extension se retrouve dans l’application', async () => {
    const APP_URL = 'http://127.0.0.1:4173'
    const workDir = mkdtempSync(join(tmpdir(), 'coffre-e2e-generator-'))
    const extensionPath = join(workDir, 'extension')
    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null =
      null

    try {
      execFileSync('bun', ['run', 'extension:build'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      })
      cpSync(join(process.cwd(), 'dist-extension'), extensionPath, {
        recursive: true,
      })
      const manifestPath = join(extensionPath, 'manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        host_permissions?: string[]
      }
      manifest.host_permissions = [
        ...new Set([...(manifest.host_permissions ?? []), 'http://127.0.0.1/*']),
      ]
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

      context = await chromium.launchPersistentContext(join(workDir, 'profile'), {
        channel: 'chromium',
        headless: true,
        locale: 'fr-FR',
        baseURL: APP_URL,
        args: [
          '--lang=fr-FR',
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      })

      let [worker] = context.serviceWorkers()
      if (!worker) worker = await context.waitForEvent('serviceworker')
      const extensionId = worker.url().split('/')[2]

      const app = await context.newPage()
      await app.goto('/')
      await expect(app.getByRole('heading', { name: 'Créer votre coffre' })).toBeVisible()
      await app.getByLabel('Nom du coffre').fill('Personnel')
      await app.getByLabel('Mot de passe maître').fill('phrase de passe de test solide')
      await app.getByLabel('Confirmer le mot de passe').fill('phrase de passe de test solide')
      await app.getByRole('checkbox').check()
      await app.getByRole('button', { name: 'Créer mon coffre' }).click()
      await expect(
        app.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }),
      ).toBeVisible({ timeout: 45_000 })

      await app.getByRole('button', { name: 'Réglages' }).first().click()
      const settings = app.getByRole('dialog')
      await settings
        .getByRole('checkbox', {
          name: /Verrouiller lorsque l’onglet passe en arrière-plan/,
        })
        .uncheck()
      await app.keyboard.press('Escape')

      const extensionPage = await context.newPage()
      await extensionPage.goto(`chrome-extension://${extensionId}/options.html`)
      await extensionPage.evaluate(
        (url) => chrome.storage.local.set({ appUrl: url }),
        APP_URL,
      )

      const popup = await context.newPage()
      await popup.goto(`chrome-extension://${extensionId}/popup.html`)
      await popup.locator('#generate').click()
      await expect(popup.locator('#generator')).toBeVisible()
      const password = (await popup.locator('#generated-password').textContent()) ?? ''
      expect(password.length).toBeGreaterThan(8)
      await popup.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async () => undefined },
        })
      })
      await popup.locator('#copy-generated').click()
      await expect(
        popup.getByText(/mot de passe copié|password copied/i),
      ).toBeVisible()

      await app.bringToFront()
      await app.getByRole('button', { name: 'Générer un mot de passe' }).click()
      const generator = app.getByRole('dialog')
      await generator.getByRole('button', { name: 'Historique', exact: true }).click()
      await expect(generator.getByText('••••••••')).toBeVisible()
      await generator.getByRole('button', { name: 'Afficher' }).click()
      await expect(generator.getByText(password)).toBeVisible()
    } finally {
      await context?.close()
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})
