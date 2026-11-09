/**
 * Capture le bandeau d’enregistrement en clair et en sombre.
 *
 * Prérequis : `bun run extension:build` et Playwright Chromium installé.
 * Le script ouvre une extension non empaquetée, injecte une proposition de
 * test dans storage.session et capture `save-banner.html` aux deux thèmes.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const extensionSource = join(process.cwd(), 'dist-extension')
const output = join(process.cwd(), 'docs/extension-captures')
mkdirSync(output, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'coffre-capture-'))
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  locale: 'fr-FR',
  viewport: { width: 400, height: 200 },
  args: [
    `--lang=fr-FR`,
    `--disable-extensions-except=${extensionSource}`,
    `--load-extension=${extensionSource}`,
  ],
})

try {
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const extensionId = worker.url().split('/')[2]
  // `options.html` ne lit pas l’état du coffre : il ne purge donc pas la
  // proposition de test. Le popup appellerait GET_STATUS et la supprimerait.
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  const now = Date.now()
  await page.evaluate(
    ({ now }) => {
      const offer = {
        id: 'abcdef12-3456-7890-abcd-ef1234567890',
        key: '42:0',
        tabId: 42,
        frameId: 0,
        host: 'github.com',
        kind: 'login',
        label: 'ada@example.com',
        detail: '',
        url: 'https://github.com/session',
        username: 'ada@example.com',
        password: 'secret-de-capture',
        createdAt: now,
        expiresAt: now + 600_000,
      }
      return chrome.storage.session.set({
        'coffre.pendingSaves.v1': [offer],
      })
    },
    { now },
  )

  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => chrome.storage.local.set({ theme: value }), theme)
    const banner = await context.newPage()
    await banner.setViewportSize({ width: 400, height: 200 })
    await banner.goto(
      `chrome-extension://${extensionId}/save-banner.html?offer=abcdef12-3456-7890-abcd-ef1234567890`,
    )
    await banner.locator('#banner-title').waitFor()
    await banner.evaluate((value) => {
      document.body.style.background = value === 'dark' ? '#09090b' : '#e4e4e7'
      document.body.style.padding = '16px'
    }, theme)
    await banner.screenshot({
      path: join(output, `save-banner-${theme}.png`),
      fullPage: true,
    })
    await banner.close()
  }

  // Réglages du popup avec la liste des raccourcis.
  const popup = await context.newPage()
  await popup.setViewportSize({ width: 420, height: 720 })
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  for (const theme of ['dark', 'light']) {
    await popup.evaluate((value) => chrome.storage.local.set({ theme: value }), theme)
    await popup.reload()
    await popup.locator('#settings').click()
    await popup.locator('#settings-view').waitFor()
    // La popup est ouverte dans un onglet pour la capture : on remplace
    // l’identifiant d’extension par un site plausible.
    await popup.evaluate(() => {
      const site = document.getElementById('site')
      if (site) site.textContent = 'github.com'
    })
    await popup.screenshot({
      path: join(output, `popup-settings-${theme}.png`),
      fullPage: true,
    })
  }
  await popup.close()

  for (const pageName of ['welcome', 'options']) {
    for (const theme of ['dark', 'light']) {
      const shot = await context.newPage()
      await shot.setViewportSize({ width: 900, height: 1000 })
      await shot.goto(
        `chrome-extension://${extensionId}/${pageName}.html${
          pageName === 'welcome' ? '?mode=install' : ''
        }`,
      )
      await shot.evaluate(
        (value) => chrome.storage.local.set({ theme: value }),
        theme,
      )
      await shot.reload()
      await shot.locator('h1').waitFor()
      if (pageName === 'welcome') {
        await shot.locator('#welcome-shortcuts li').first().waitFor()
      }
      await shot.screenshot({
        path: join(output, `${pageName}-${theme}.png`),
        fullPage: true,
      })
      await shot.close()
    }
  }
  console.log(`Captures du bandeau, des raccourcis et des pages écrites dans ${output}`)
} finally {
  await context.close()
  rmSync(profile, { recursive: true, force: true })
}
