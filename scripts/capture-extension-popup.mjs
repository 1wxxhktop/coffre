/**
 * Capture la vue principale de la popup, en clair et en sombre.
 *
 * Prérequis : `bun run extension:build`, l’application sur `COFFRE_APP_URL`
 * (défaut `http://127.0.0.1:1420`) et un formulaire sur `COFFRE_TARGET_URL`
 * (défaut `http://127.0.0.1:8099`). Le script crée un coffre de démonstration,
 * trois connexions, puis ouvre la popup avec l’onglet cible simulé.
 *
 * `COFFRE_CAPTURE_PREFIX` choisit le préfixe des fichiers (par exemple
 * `popup-before` pour documenter l’état antérieur).
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const APP_URL = process.env.COFFRE_APP_URL ?? 'http://127.0.0.1:1420'
const TARGET_URL = process.env.COFFRE_TARGET_URL ?? 'http://127.0.0.1:8099'
const PREFIX = process.env.COFFRE_CAPTURE_PREFIX ?? 'popup-after'
const PASSWORD = 'phrase de passe de test solide'
const OUTPUT = join(process.cwd(), 'docs/extension-captures')
mkdirSync(OUTPUT, { recursive: true })

const workDir = mkdtempSync(join(tmpdir(), 'coffre-popup-'))
const extensionPath = join(workDir, 'extension')
cpSync(join(process.cwd(), 'dist-extension'), extensionPath, {
  recursive: true,
})
const manifestPath = join(extensionPath, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
for (const origin of [
  new URL(TARGET_URL).origin,
  'http://localhost:8099',
  'http://127.0.0.1:8099',
]) {
  const pattern = `${origin}/*`
  if (!manifest.host_permissions.includes(pattern)) {
    manifest.host_permissions.push(pattern)
  }
}
manifest.permissions = manifest.permissions.filter(
  (permission) => permission !== 'nativeMessaging',
)
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

const context = await chromium.launchPersistentContext(
  join(workDir, 'profile'),
  {
    headless: false,
    locale: 'fr-FR',
    viewport: { width: 1280, height: 900 },
    args: [
      '--lang=fr',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  },
)

async function addLogin(app, fields) {
  await app.getByRole('button', { name: 'Nouvel élément' }).first().click()
  const dialog = app.getByRole('dialog')
  await dialog.getByLabel('Titre', { exact: true }).fill(fields.title)
  await dialog
    .getByLabel('Identifiant', { exact: true })
    .fill(fields.username)
  await dialog
    .getByLabel('Mot de passe', { exact: true })
    .fill(fields.password)
  if (fields.url) {
    await dialog.getByPlaceholder('https://exemple.com').fill(fields.url)
  }
  if (fields.totp) {
    await dialog.getByLabel(/Code TOTP/).fill(fields.totp)
  }
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await app
    .locator('.item-panel')
    .getByRole('heading', { name: fields.title })
    .waitFor()
}

try {
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const extensionId = worker.url().split('/')[2]
  await worker.evaluate(
    (appUrl) => chrome.storage.local.set({ appUrl }),
    APP_URL,
  )

  const app = await context.newPage()
  await app.goto(APP_URL)
  await app.getByLabel('Nom du coffre').fill('Personnel')
  await app.getByLabel('Mot de passe maître').fill(PASSWORD)
  await app.getByLabel('Confirmer le mot de passe').fill(PASSWORD)
  await app.getByRole('checkbox').check()
  await app.getByRole('button', { name: 'Créer mon coffre' }).click()
  await app
    .getByRole('button', { name: 'Nouvel élément' })
    .first()
    .waitFor({ timeout: 45_000 })
  await app.getByRole('button', { name: 'Tous les éléments' }).first().click()

  await addLogin(app, {
    title: 'Example',
    username: 'ada',
    password: 's3cret!',
    url: TARGET_URL,
    totp: 'otpauth://totp/Coffre:ada?secret=JBSWY3DPEHPK3PXP&issuer=Coffre',
  })
  await app.keyboard.press('Escape')

  await addLogin(app, {
    title: 'Favori',
    username: 'favori@example.com',
    password: 'secret-favori',
  })
  await app
    .getByRole('button', { name: /Ajouter aux favoris|Add to favorites/ })
    .click()
  await app.keyboard.press('Escape')

  await addLogin(app, {
    title: 'Récent',
    username: 'recent@example.com',
    password: 'secret-recent',
  })
  await app.keyboard.press('Escape')

  const target = await context.newPage()
  await target.goto(TARGET_URL)
  await target.bringToFront()
  await new Promise((resolve) => setTimeout(resolve, 500))
  const targetTab = await worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({})
    return tabs.find((tab) => tab.url?.startsWith(url))
  }, TARGET_URL)
  if (!targetTab?.id) throw new Error('Onglet cible introuvable')

  const popup = await context.newPage()
  await popup.setViewportSize({ width: 420, height: 760 })
  await popup.addInitScript(({ tab, appUrl }) => {
    const originalQuery = chrome.tabs.query.bind(chrome.tabs)
    chrome.tabs.query = (queryInfo, callback) => {
      if (queryInfo?.active && queryInfo?.currentWindow) {
        if (typeof callback === 'function') {
          callback([tab])
          return undefined
        }
        return Promise.resolve([tab])
      }
      return originalQuery(queryInfo, callback)
    }
    // La popup de capture vit dans un onglet : l’onglet actif réel est
    // elle-même. On simule le statut que le service worker renverrait pour
    // l’onglet cible, sans modifier le comportement de production.
    const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = (message, ...rest) => {
      if (message?.type === 'GET_STATUS') {
        return Promise.resolve({
          appOpen: true,
          unlocked: true,
          paired: true,
          hostAccess: true,
          siteAccess: true,
          mode: 'tab',
          tabId: tab.id,
          appUrl,
        })
      }
      return originalSend(message, ...rest)
    }
  }, { tab: targetTab, appUrl: APP_URL })

  for (const theme of ['dark', 'light']) {
    if (popup.url() === 'about:blank') {
      await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    }
    await popup.evaluate(
      (value) => chrome.storage.local.set({ theme: value }),
      theme,
    )
    await popup.reload()
    await popup.locator('#main-view').waitFor()
    await popup
      .locator('.result-group__title, #results .result')
      .first()
      .waitFor({ timeout: 10_000 })
    // Laisse la recherche du site et le rendu des sections se stabiliser.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await popup.screenshot({
      path: join(OUTPUT, `${PREFIX}-${theme}.png`),
      fullPage: true,
    })
  }

  console.log(`Captures de la popup écrites dans ${OUTPUT} (${PREFIX})`)
} finally {
  await context.close()
  rmSync(workDir, { recursive: true, force: true })
}
