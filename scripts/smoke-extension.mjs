/**
 * Test manuel de l’extension navigateur.
 *
 * Prérequis :
 *   bun run extension:build
 *   bunx vite --host 127.0.0.1 --port 1420 --strictPort
 *   un formulaire de connexion sur http://127.0.0.1:8099/
 *
 * Lance un Chromium visible avec l’extension, crée un coffre, puis vérifie la
 * recherche, la récupération et le remplissage.
 */
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_URL = process.env.COFFRE_APP_URL ?? 'http://127.0.0.1:1420'
const TARGET_URL = process.env.COFFRE_TARGET_URL ?? 'http://127.0.0.1:8099'
const PASSWORD = 'phrase de passe de test solide'

const extensionSource = join(process.cwd(), 'dist-extension')
const workDir = mkdtempSync(join(tmpdir(), 'coffre-ext-'))
const extensionPath = join(workDir, 'extension')
cpSync(extensionSource, extensionPath, { recursive: true })

const targetOrigin = new URL(TARGET_URL).origin
const manifestPath = join(extensionPath, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (!manifest.host_permissions.includes(`${targetOrigin}/*`)) {
  manifest.host_permissions.push(`${targetOrigin}/*`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
}

const context = await chromium.launchPersistentContext(join(workDir, 'profile'), {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
  viewport: { width: 1280, height: 900 },
})

try {
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const extensionId = worker.url().split('/')[2]

  const app = await context.newPage()
  await app.goto(APP_URL)
  await app.getByLabel('Nom du coffre').fill('Personnel')
  await app.getByLabel('Mot de passe maître').fill(PASSWORD)
  await app.getByLabel('Confirmer le mot de passe').fill(PASSWORD)
  await app.getByRole('checkbox').check()
  await app.getByRole('button', { name: 'Créer mon coffre' }).click()
  await app
    .getByRole('button', { name: 'Nouvel élément' })
    .waitFor({ timeout: 45_000 })

  await app.getByRole('button', { name: 'Nouvel élément' }).click()
  const dialog = app.getByRole('dialog')
  await dialog.getByLabel('Titre', { exact: true }).fill('Example')
  await dialog.getByLabel('Identifiant', { exact: true }).fill('ada')
  await dialog.getByLabel('Mot de passe', { exact: true }).fill('s3cret!')
  await dialog.getByPlaceholder('https://exemple.com').fill(TARGET_URL)
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await dialog.getByRole('heading', { name: 'Example' }).waitFor()
  await app.keyboard.press('Escape')

  const target = await context.newPage()
  await target.goto(TARGET_URL)

  const extensionPage = await context.newPage()
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`)
  await extensionPage.evaluate(
    (appUrl) => chrome.storage.local.set({ appUrl }),
    APP_URL,
  )

  const status = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }),
  )
  assert.equal(status.appOpen, true)
  assert.equal(status.unlocked, true)

  const host = new URL(TARGET_URL).hostname
  const search = await extensionPage.evaluate(
    (query) => chrome.runtime.sendMessage({ type: 'SEARCH', query }),
    host,
  )
  assert.equal(search.items?.length, 1)
  const itemId = search.items[0].id

  const tabs = await extensionPage.evaluate(() => chrome.tabs.query({}))
  const targetTab = tabs.find((tab) => tab.url?.startsWith(TARGET_URL))
  assert.ok(targetTab?.id)

  const fill = await extensionPage.evaluate(
    ({ id, tabId }) => chrome.runtime.sendMessage({ type: 'FILL', itemId: id, tabId }),
    { id: itemId, tabId: targetTab.id },
  )
  assert.equal(fill.ok, true)

  const values = await target.evaluate(() => ({
    username: document.querySelector('#username').value,
    password: document.querySelector('#password').value,
  }))
  assert.equal(values.username, 'ada')
  assert.equal(values.password, 's3cret!')

  await app.getByRole('button', { name: 'Verrouiller' }).first().click()
  const locked = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }),
  )
  assert.equal(locked.unlocked, false)

  console.log('Extension : recherche, remplissage et verrouillage validés.')
} finally {
  await context.close()
  rmSync(workDir, { recursive: true, force: true })
}
