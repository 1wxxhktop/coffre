import { expect, test, chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

declare global {
  interface Window {
    __coffreExtension?: {
      assessHost?: (query: unknown) => Promise<unknown>
    }
  }
}

/**
 * Parcours réel de l’extension : un remplissage forcé sur `paypa1.test` doit
 * afficher le bandeau anti-hameçonnage, et « Annuler » ne doit rien remplir.
 *
 * Le menu est ouvert dans un onglet d’extension et le content script est
 * injecté explicitement : c’est le même protocole que le menu dans les champs,
 * sans dépendre du shadow root fermé ni du mode headless de Chromium.
 */
test.describe('extension — protection anti-hameçonnage', () => {
  test.skip(({ browserName }) => browserName !== 'chromium')

  test('affiche le bandeau et annule le remplissage forcé', async () => {
    const APP_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`
    const workDir = mkdtempSync(join(tmpdir(), 'coffre-e2e-phishing-'))
    const profileDir = join(workDir, 'profile')
    const extensionPath = join(workDir, 'extension')
    let server: Server | null = null
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
        ...new Set([
          ...(manifest.host_permissions ?? []),
          'http://127.0.0.1/*',
          'http://paypa1.test/*',
        ]),
      ]
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

      server = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(`<!doctype html>
<html lang="fr">
  <body>
    <form>
      <input id="username" name="username" autocomplete="username" />
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <button type="submit">Connexion</button>
    </form>
    <script>
      document.querySelector('form').addEventListener('submit', (event) => event.preventDefault())
    </script>
  </body>
</html>`)
      })
      await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Serveur de test indisponible')
      const targetUrl = `http://paypa1.test:${address.port}/login`

      context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chromium',
        headless: true,
        locale: 'fr-FR',
        args: [
          '--lang=fr-FR',
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          '--host-resolver-rules=MAP paypa1.test 127.0.0.1',
        ],
      })

      let [worker] = context.serviceWorkers()
      if (!worker) worker = await context.waitForEvent('serviceworker')
      const extensionId = worker.url().split('/')[2]

      const app = await context.newPage()
      await app.goto(APP_URL)
      await expect(app.getByRole('heading', { name: 'Créer votre coffre' })).toBeVisible()
      await app.getByLabel('Nom du coffre').fill('Personnel')
      await app.getByLabel('Mot de passe maître').fill('phrase de passe de test solide')
      await app.getByLabel('Confirmer le mot de passe').fill('phrase de passe de test solide')
      await app.getByRole('checkbox').check()
      await app.getByRole('button', { name: 'Créer mon coffre' }).click()
      await expect(
        app.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }),
      ).toBeVisible({ timeout: 45_000 })

      // L’onglet Coffre passe en arrière-plan pendant le test : on désactive le
      // verrouillage à la perte de visibilité pour que le pont reste ouvert.
      await app.getByRole('button', { name: 'Réglages' }).first().click()
      const settings = app.getByRole('dialog')
      await settings
        .getByRole('checkbox', {
          name: /Verrouiller lorsque l’onglet passe en arrière-plan/,
        })
        .uncheck()
      await app.keyboard.press('Escape')

      await app.getByRole('button', { name: 'Nouvel élément' }).first().click()
      const dialog = app.getByRole('dialog')
      await dialog.getByLabel('Titre', { exact: true }).fill('PayPal')
      await dialog.getByLabel('Identifiant', { exact: true }).fill('ada')
      await dialog.getByLabel('Mot de passe', { exact: true }).fill('s3cret!')
      await dialog.getByPlaceholder('https://exemple.com').fill('https://paypal.com')
      await dialog.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(app.getByRole('dialog')).toHaveCount(0)
      await app.keyboard.press('Escape')

      const target = await context.newPage()
      await target.goto(targetUrl)

      const extensionPage = await context.newPage()
      await extensionPage.goto(`chrome-extension://${extensionId}/options.html`)
      await extensionPage.evaluate(
        (url) => chrome.storage.local.set({ appUrl: url }),
        APP_URL,
      )

      const tabId = await extensionPage.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'http://paypa1.test/*' })
        return tabs[0]?.id ?? null
      })
      if (!tabId) throw new Error('Onglet de test introuvable')

      // La passerelle est recréée après chaque mutation : attendre qu’elle
      // expose bien l’évaluation anti-hameçonnage avant d’ouvrir le menu.
      await expect
        .poll(() => app.evaluate(() => Boolean(window.__coffreExtension?.assessHost)))
        .toBe(true)
      await extensionPage.evaluate(async (id) => {
        await chrome.scripting.executeScript({
          target: { tabId: id },
          files: ['content.js'],
        })
      }, tabId)

      const menu = await context.newPage()
      await menu.goto(
        `chrome-extension://${extensionId}/menu.html?tab=${tabId}&frame=0&host=paypa1.test&top=paypa1.test&kind=login&mode=badge`,
      )
      await menu.locator('#badge-button').click()
      await menu.locator('#search').fill('PayPal')
      await expect(
        menu.getByRole('button', { name: /Remplir|Fill/ }).first(),
      ).toBeVisible()
      await menu.getByRole('button', { name: /Remplir|Fill/ }).first().click()

      await expect(
        menu.getByText(/imite paypal\.com|imitates paypal\.com/i),
      ).toBeVisible()
      if (process.env.COFFRE_UPDATE_SCREENSHOTS === '1') {
        await menu.screenshot({
          path: 'docs/screenshots/phishing-warning.png',
          fullPage: true,
        })
      }
      await menu.locator('#phishing-cancel').click()
      await expect(target.locator('#password')).toHaveValue('')
      await expect(target.locator('#username')).toHaveValue('')

      // Deuxième essai : un hôte différent de celui de l’élément ne peut pas
      // être rempli, même après l’avertissement. Seul l’enregistrement peut
      // être forcé, car il n’expose aucun secret.
      await menu.getByRole('button', { name: /Remplir|Fill/ }).first().click()
      await expect(
        menu.getByText(/imite paypal\.com|imitates paypal\.com/i),
      ).toBeVisible()
      await expect(menu.locator('#phishing-continue')).toBeHidden()
      await menu.locator('#phishing-cancel').click()
      await expect(target.locator('#password')).toHaveValue('')
      await expect(target.locator('#username')).toHaveValue('')
    } finally {
      await context?.close()
      if (server) await new Promise<void>((resolve) => server?.close(() => resolve()))
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})
