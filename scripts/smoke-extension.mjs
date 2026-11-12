/**
 * Test manuel de l’extension navigateur.
 *
 * Prérequis :
 *   bun run extension:build
 *   bunx vite --host 127.0.0.1 --port 1420 --strictPort
 *   un formulaire de connexion sur http://127.0.0.1:8099/
 *
 * Lance un Chromium visible avec l’extension, crée un coffre, puis vérifie la
 * recherche, la récupération, le remplissage et le cycle passkey complet
 * (attestation et signature vérifiées avec les primitives Node).
 */
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeCbor } from '../src/lib/cbor.ts'

const APP_URL = process.env.COFFRE_APP_URL ?? 'http://127.0.0.1:1420'
const TARGET_URL = process.env.COFFRE_TARGET_URL ?? 'http://127.0.0.1:8099'
const PASSWORD = 'phrase de passe de test solide'

function publicKeyFromCose(value) {
  const cose = decodeCbor(Buffer.from(value, 'base64url'))
  assert.ok(cose instanceof Map, 'COSE ES256 attendu')
  const x = Buffer.from(cose.get(-2)).toString('base64url')
  const y = Buffer.from(cose.get(-3)).toString('base64url')
  return createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x, y },
    format: 'jwk',
  })
}

function authenticatorData(value, host) {
  const data = Buffer.from(value, 'base64url')
  const expected = createHash('sha256').update(host).digest()
  assert.deepEqual(data.subarray(0, 32), expected, 'hash du RP ID')
  return data
}

function verifyRegistration(created, host) {
  const attestation = decodeCbor(
    Buffer.from(created.attestationObject, 'base64url'),
  )
  assert.equal(attestation.get('fmt'), 'none')
  const data = Buffer.from(attestation.get('authData'))
  assert.deepEqual(
    data.subarray(0, 32),
    createHash('sha256').update(host).digest(),
    'hash du RP ID dans l’attestation',
  )
  assert.equal(data[32] & 0x41, 0x41, 'drapeaux UP et AT')
  let offset = 37 + 16
  const length = data.readUInt16BE(offset)
  const credentialId = data
    .subarray(offset + 2, offset + 2 + length)
    .toString('base64url')
  assert.equal(credentialId, created.id)
  assert.deepEqual(
    data.subarray(offset + 2 + length),
    Buffer.from(created.publicKeyCose, 'base64url'),
    'clé publique COSE intégrée',
  )
}

function verifyAssertion(created, assertion, host) {
  const data = authenticatorData(assertion.authData, host)
  const clientHash = createHash('sha256')
    .update(Buffer.from(assertion.clientDataJSON, 'base64url'))
    .digest()
  assert.equal(
    verifySignature(
      'sha256',
      Buffer.concat([data, clientHash]),
      publicKeyFromCose(created.publicKeyCose),
      Buffer.from(assertion.signatureData, 'base64url'),
    ),
    true,
    'signature ECDSA vérifiée par un vérificateur serveur',
  )
}

const extensionSource = join(process.cwd(), 'dist-extension')
const workDir = mkdtempSync(join(tmpdir(), 'coffre-ext-'))
const extensionPath = join(workDir, 'extension')
cpSync(extensionSource, extensionPath, { recursive: true })

const targetOrigin = new URL(TARGET_URL).origin
const manifestPath = join(extensionPath, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
for (const origin of [targetOrigin, 'http://localhost:8099', 'http://127.0.0.1:8099']) {
  const pattern = `${origin}/*`
  if (!manifest.host_permissions.includes(pattern)) {
    manifest.host_permissions.push(pattern)
  }
}
// Le smoke vérifie les scripts dynamiques de bout en bout : on accorde les
// hôtes comme le ferait le bouton d’activation du popup.
for (const pattern of ['http://*/*', 'https://*/*']) {
  if (!manifest.host_permissions.includes(pattern)) {
    manifest.host_permissions.push(pattern)
  }
}
// Le smoke tourne sur le profil du développeur : retirer `nativeMessaging`
// évite de démarrer une vraie application desktop installée. Le relais natif a
// son propre smoke (`bridge:smoke`).
manifest.permissions = manifest.permissions.filter(
  (permission) => permission !== 'nativeMessaging',
)
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

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
    .first()
    .waitFor({ timeout: 45_000 })
  await app.getByRole('button', { name: 'Tous les éléments' }).first().click()

  await app.getByRole('button', { name: 'Nouvel élément' }).first().click()
  const form = app.getByRole('dialog')
  await form.getByLabel('Titre', { exact: true }).fill('Example')
  await form.getByLabel('Identifiant', { exact: true }).fill('ada')
  await form.getByLabel('Mot de passe', { exact: true }).fill('s3cret!')
  await form
    .getByLabel(/Clé TOTP/)
    .fill('otpauth://totp/Coffre:ada?secret=JBSWY3DPEHPK3PXP&issuer=Coffre')
  await form.getByPlaceholder('https://exemple.com').fill(TARGET_URL)
  await form.getByRole('button', { name: 'Enregistrer' }).click()
  await app
    .locator('.item-panel')
    .getByRole('heading', { name: 'Example' })
    .waitFor()
  await app.keyboard.press('Escape')

  const target = await context.newPage()
  await target.goto(TARGET_URL)
  await target.evaluate(() => {
    window.__coffreSubmitCount = 0
    document.querySelector('form')?.addEventListener(
      'submit',
      (event) => {
        window.__coffreSubmitCount += 1
        event.preventDefault()
      },
      { once: true },
    )
  })

  const extensionPage = await context.newPage()
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`)
  await extensionPage.evaluate(
    (appUrl) => chrome.storage.local.set({ appUrl }),
    APP_URL,
  )
  await target.bringToFront()

  const status = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }),
  )
  assert.equal(status.appOpen, true)
  assert.equal(status.unlocked, true)
  assert.equal(status.siteAccess, true)
  const unlockRequest = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'UNLOCK_REQUEST' }),
  )
  assert.equal(unlockRequest.ok, true)
  assert.equal(unlockRequest.mode, 'tab')

  const host = new URL(TARGET_URL).hostname

  assert.ok(Number.isInteger(status.tabId))
  const loginState = async (username, password) =>
    extensionPage.evaluate(
      async ({ tabId, host, username, password }) => {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (values) => {
            const bridge = window.__coffreExtension
            return bridge?.checkLogin ? bridge.checkLogin(values) : null
          },
          args: [{ host, username, password }],
        })
        return result?.result
      },
      // Comme l’extension, la vérification transmet l’origine de la page
      // (schéma et port compris) : l’élément de test est enregistré avec son port.
      { tabId: status.tabId, host: new URL(TARGET_URL).origin, username, password },
    )

  assert.equal(await loginState('ada', 's3cret!'), 'same')
  assert.equal(await loginState('ada', 'autre-mot-de-passe'), 'different')
  assert.equal(await loginState('inconnu', 's3cret!'), 'missing')

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
  await new Promise((resolve) => setTimeout(resolve, 600))
  // Par défaut, le formulaire n’est pas soumis : l’utilisateur vérifie le compte.
  assert.equal(await target.evaluate(() => window.__coffreSubmitCount), 0)

  await extensionPage.evaluate(() =>
    chrome.storage.local.set({ autoSubmitLogin: true }),
  )
  const fillAndSubmit = await extensionPage.evaluate(
    ({ id, tabId }) => chrome.runtime.sendMessage({ type: 'FILL', itemId: id, tabId }),
    { id: itemId, tabId: targetTab.id },
  )
  assert.equal(fillAndSubmit.ok, true)
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal(await target.evaluate(() => window.__coffreSubmitCount), 1)
  await extensionPage.evaluate(() =>
    chrome.storage.local.set({ autoSubmitLogin: false }),
  )

  const values = await target.evaluate(() => ({
    username: document.querySelector('#username').value,
    password: document.querySelector('#password').value,
  }))
  assert.equal(values.username, 'ada')
  assert.equal(values.password, 's3cret!')

  // Comme la popup et le menu, la demande de détails transmet l’URL de la page.
  const details = await extensionPage.evaluate(
    ({ id, host, url }) =>
      chrome.runtime.sendMessage({ type: 'DETAILS', itemId: id, host, url }),
    { id: itemId, host, url: TARGET_URL },
  )
  assert.equal(details.details?.username, 'ada')
  assert.equal(details.details?.password, 's3cret!')

  const deniedDetails = await extensionPage.evaluate(
    ({ id }) =>
      chrome.runtime.sendMessage({
        type: 'DETAILS',
        itemId: id,
        host: 'evil.example',
      }),
    { id: itemId },
  )
  assert.equal(deniedDetails.details, undefined)
  assert.ok(deniedDetails.error)

  // Une soumission avec les mêmes identifiants ne doit pas demander de les
  // enregistrer à nouveau ; un mot de passe différent doit proposer une mise à jour.
  await extensionPage.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    })
  }, targetTab.id)
  await target.evaluate(() => {
    document
      .querySelector('form')
      ?.addEventListener('submit', (event) => event.preventDefault(), {
        once: true,
      })
  })
  await target.getByRole('button', { name: 'Connexion' }).click()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const samePending = await extensionPage.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({ type: 'GET_PENDING_SAVE', tabId }),
    targetTab.id,
  )
  assert.equal(samePending.pending, null)

  await target.locator('#password').fill('nouveau-secret!')
  await target.evaluate(() => {
    document
      .querySelector('form')
      ?.addEventListener('submit', (event) => event.preventDefault(), {
        once: true,
      })
  })
  await target.getByRole('button', { name: 'Connexion' }).click()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const updatePending = await extensionPage.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({ type: 'GET_PENDING_SAVE', tabId }),
    targetTab.id,
  )
  assert.equal(updatePending.pending?.update, true)
  assert.equal(updatePending.pending?.username, 'ada')

  // E0 : la proposition vit dans storage.session, pas dans storage.local.
  const storedPending = await extensionPage.evaluate(async () => {
    const key = 'coffre.pendingSaves.v1'
    const values = await chrome.storage.session.get(key)
    return values[key]
  })
  assert.equal(storedPending?.[0]?.password, 'nouveau-secret!')
  const localStorageDump = await extensionPage.evaluate(() =>
    chrome.storage.local.get(null),
  )
  assert.equal(JSON.stringify(localStorageDump).includes('nouveau-secret!'), false)
  assert.equal(
    Object.keys(localStorageDump).some((key) => key.includes('pending')),
    false,
  )

  const contentSessionAccess = await extensionPage.evaluate(async (tabId) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          await chrome.storage.session.get(null)
          return 'readable'
        } catch {
          return 'blocked'
        }
      },
    })
    return result?.result
  }, targetTab.id)
  assert.equal(contentSessionAccess, 'blocked')

  // Simule l’arrêt du service worker par le navigateur, puis vérifie que la
  // proposition est toujours disponible au réveil.
  const cdp = await context.newCDPSession(extensionPage)
  const versions = new Map()
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: entries }) => {
    for (const entry of entries) versions.set(entry.versionId, entry)
  })
  await cdp.send('ServiceWorker.enable')
  await new Promise((resolve) => setTimeout(resolve, 500))
  const running = [...versions.values()].find(
    (entry) => entry.runningStatus === 'running',
  )
  assert.ok(running, 'service worker de l’extension introuvable')
  await cdp.send('ServiceWorker.stopWorker', { versionId: running.versionId })
  await cdp.detach()
  await new Promise((resolve) => setTimeout(resolve, 500))

  const afterRestart = await extensionPage.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({ type: 'GET_PENDING_SAVE', tabId }),
    targetTab.id,
  )
  assert.equal(afterRestart.pending?.username, 'ada')
  assert.equal(afterRestart.pending?.update, true)

  // Simulation de l’expiration à dix minutes : la lecture purge la proposition.
  const expiredPending = await extensionPage.evaluate(async (tabId) => {
    const key = 'coffre.pendingSaves.v1'
    const values = await chrome.storage.session.get(key)
    const entries = Array.isArray(values[key]) ? values[key] : []
    for (const entry of entries) entry.expiresAt = Date.now() - 1
    await chrome.storage.session.set({ [key]: entries })
    return chrome.runtime.sendMessage({ type: 'GET_PENDING_SAVE', tabId })
  }, targetTab.id)
  assert.equal(expiredPending.pending, null)

  // E3 : le gestionnaire de commande remplit sans ouvrir la popup. Playwright
  // ne peut pas déclencher un raccourci de navigateur ; le canal RUN_COMMAND
  // appelle exactement le même gestionnaire que `commands.onCommand`.
  const commands = await extensionPage.evaluate(() => chrome.commands.getAll())
  assert.ok(
    commands.find((command) => command.name === '_execute_action')?.shortcut,
    'raccourci popup non enregistré',
  )
  assert.ok(
    commands.find((command) => command.name === 'fill-login')?.shortcut,
    'raccourci fill-login non enregistré',
  )
  const shortcutPage = await context.newPage()
  await shortcutPage.goto(new URL('/shortcut', TARGET_URL).toString())
  await shortcutPage.bringToFront()
  const commandResult = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'RUN_COMMAND', command: 'fill-login' }),
  )
  assert.equal(commandResult.ok, true)
  await shortcutPage.waitForFunction(
    () =>
      document.querySelector('#username')?.value === 'ada' &&
      document.querySelector('#password')?.value === 's3cret!',
    null,
    { timeout: 10_000 },
  )

  await shortcutPage.locator('#password').fill('')
  const generated = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'RUN_COMMAND',
      command: 'generate-password',
    }),
  )
  assert.equal(generated.ok, true)
  await shortcutPage.waitForFunction(
    () => (document.querySelector('#password')?.value.length ?? 0) >= 8,
    null,
    { timeout: 10_000 },
  )
  assert.notEqual(
    await shortcutPage.locator('#password').inputValue(),
    's3cret!',
  )

  const totp = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'RUN_COMMAND', command: 'fill-totp' }),
  )
  assert.equal(totp.ok, true)
  await shortcutPage.waitForFunction(
    () => /^\d{6}$/.test(document.querySelector('#otp')?.value ?? ''),
    null,
    { timeout: 10_000 },
  )

  // E4 : le menu contextuel ne contient que les connexions de ce domaine, et
  // son gestionnaire de remplissage utilise bien l’onglet actif.
  const menuSnapshot = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'CONTEXT_MENU_SNAPSHOT' }),
  )
  assert.ok(menuSnapshot.model.some((entry) => entry.id === `fill-login:${itemId}`))
  assert.ok(menuSnapshot.model.some((entry) => entry.id === 'fill-card'))
  assert.ok(menuSnapshot.model.some((entry) => entry.id === 'fill-identity'))
  await shortcutPage.evaluate(() => {
    const username = document.querySelector('#username')
    const password = document.querySelector('#password')
    if (username) username.value = ''
    if (password) password.value = ''
  })
  const shortcutTab = await extensionPage.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab
  })
  const menuFill = await extensionPage.evaluate(
    ({ tabId, itemId }) =>
      chrome.runtime.sendMessage({
        type: 'RUN_CONTEXT_MENU',
        menuItemId: `fill-login:${itemId}`,
        tabId,
        frameId: 0,
      }),
    { tabId: shortcutTab.id, itemId },
  )
  assert.equal(menuFill.ok, true)
  await shortcutPage.waitForFunction(
    () =>
      document.querySelector('#username')?.value === 'ada' &&
      document.querySelector('#password')?.value === 's3cret!',
    null,
    { timeout: 10_000 },
  )
  await shortcutPage.close()
  await extensionPage.bringToFront()

  // E6 : mot de passe fort sur un formulaire d’inscription à deux champs.
  await target.goto(new URL('/register', TARGET_URL).toString())
  await target.locator('#new-password').waitFor()
  const registerTab = await extensionPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({})
    return tabs.find((tab) => tab.url?.includes('/register'))
  })
  assert.ok(registerTab?.id)
  const signupToken = 'a'.repeat(32)
  await extensionPage.evaluate(
    async ({ token, tabId, host }) => {
      await chrome.runtime.sendMessage({
        type: 'MENU_REGISTER',
        token,
        tabId,
        frameId: 0,
        host,
        topHost: host,
        url: `http://${host}/register`,
        kind: 'login',
        mode: 'open',
      })
    },
    { token: signupToken, tabId: registerTab.id, host },
  )
  const signupMenu = await context.newPage()
  await signupMenu.goto(
    `chrome-extension://${extensionId}/menu.html?tab=${registerTab.id}&frame=0&host=${host}&top=${host}&kind=login&mode=open&signup=1&token=${signupToken}`,
  )
  await signupMenu.locator('#signup').waitFor()
  await signupMenu
    .locator('#signup-preview')
    .filter({ hasText: '…' })
    .waitFor({ timeout: 10_000 })
  const preview = await signupMenu.locator('#signup-preview').innerText()
  await signupMenu.locator('#signup-use').click()
  await target.waitForFunction(
    () => {
      const password = document.querySelector('#new-password')
      const confirm = document.querySelector('#confirm-password')
      return (
        password instanceof HTMLInputElement &&
        confirm instanceof HTMLInputElement &&
        password.value.length >= 8 &&
        password.value === confirm.value
      )
    },
    null,
    { timeout: 10_000 },
  )
  const signupPassword = await target.locator('#new-password').inputValue()
  assert.notEqual(preview, signupPassword)
  assert.equal(preview.includes(signupPassword), false)
  await signupMenu.close().catch(() => undefined)

  await target.bringToFront()
  await target.locator('#email').fill('signup@example.com')
  await target.getByRole('button', { name: 'Créer mon compte' }).click()
  await target.waitForURL('**/welcome*')
  // La proposition est créée après la vérification dans l’application et
  // l’évaluation anti-hameçonnage : elle peut arriver après la redirection.
  let signupPending = { pending: null }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    signupPending = await extensionPage.evaluate(
      (tabId) =>
        chrome.runtime.sendMessage({ type: 'GET_PENDING_SAVE', tabId }),
      registerTab.id,
    )
    if (signupPending.pending) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.equal(signupPending.pending?.username, 'signup@example.com')
  await extensionPage.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({ type: 'SAVE_DISMISS_PENDING', tabId }),
    registerTab.id,
  )

  // E7 : exclusions par site, retirées à chaud.
  const excludedPage = await context.newPage()
  await excludedPage.goto(new URL('/shortcut', TARGET_URL).toString())
  await excludedPage.bringToFront()
  const setExclusion = (kind, excluded) =>
    extensionPage.evaluate(
      ({ host, kind, excluded }) =>
        chrome.runtime.sendMessage({
          type: 'SET_SITE_EXCLUSION',
          host,
          kind,
          excluded,
        }),
      { host, kind, excluded },
    )
  assert.equal((await setExclusion('fill', true)).ok, true)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const excludedMenu = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'CONTEXT_MENU_SNAPSHOT' }),
  )
  assert.deepEqual(
    excludedMenu.model.map((entry) => entry.id),
    ['open-app', 'add-site'],
  )
  const blockedFill = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'RUN_COMMAND', command: 'fill-login' }),
  )
  assert.equal(blockedFill.ok, false)

  assert.equal((await setExclusion('save', true)).ok, true)
  await new Promise((resolve) => setTimeout(resolve, 250))
  await excludedPage.locator('#username').fill('excluded@example.com')
  await excludedPage.locator('#password').fill('mot-de-passe-exclu!')
  await excludedPage.getByRole('button', { name: 'Connexion' }).click()
  await new Promise((resolve) => setTimeout(resolve, 500))
  const excludedTab = await extensionPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({})
    return tabs.find((tab) => tab.url?.includes('/shortcut'))
  })
  assert.ok(excludedTab?.id)
  const excludedPending = await extensionPage.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({ type: 'GET_PENDING_SAVE', tabId }),
    excludedTab.id,
  )
  assert.equal(excludedPending.pending, null)

  assert.equal((await setExclusion('fill', false)).ok, true)
  assert.equal((await setExclusion('save', false)).ok, true)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const restoredMenu = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'CONTEXT_MENU_SNAPSHOT' }),
  )
  assert.ok(restoredMenu.model.some((entry) => entry.id === 'fill-login'))
  await excludedPage.locator('#username').fill('restored@example.com')
  await excludedPage.locator('#password').fill('mot-de-passe-retabli!')
  await excludedPage.getByRole('button', { name: 'Connexion' }).click()
  await new Promise((resolve) => setTimeout(resolve, 500))
  const restoredPending = await extensionPage.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({ type: 'GET_PENDING_SAVE', tabId }),
    excludedTab.id,
  )
  assert.equal(restoredPending.pending?.username, 'restored@example.com')
  await extensionPage.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({ type: 'SAVE_DISMISS_PENDING', tabId }),
    excludedTab.id,
  )
  await excludedPage.close()
  await extensionPage.bringToFront()

  // E8 : sections de la popup et remplissage au clavier, sans souris.
  const keyboardPage = await context.newPage()
  await keyboardPage.goto(new URL('/shortcut', TARGET_URL).toString())
  await keyboardPage.locator('#username').fill('')
  await keyboardPage.locator('#password').fill('')
  await keyboardPage.bringToFront()
  const keyboardTab = await extensionPage.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab
  })
  const popupPage = await context.newPage()
  await popupPage.addInitScript((tab) => {
    const original = chrome.tabs.query.bind(chrome.tabs)
    chrome.tabs.query = (queryInfo, callback) => {
      if (queryInfo?.active && queryInfo?.currentWindow) {
        if (typeof callback === 'function') {
          callback([tab])
          return undefined
        }
        return Promise.resolve([tab])
      }
      return original(queryInfo, callback)
    }
  }, keyboardTab)
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`)
  // La popup d’action Chrome dimensionne la fenêtre d’après le contenu. Une
  // hauteur en 100vh peut se résoudre à zéro et laisser une fenêtre vide : on
  // garde une hauteur fixe, vérifiée ici dans une fenêtre plus haute.
  const popupBox = await popupPage.locator('.popup').boundingBox()
  assert.ok(popupBox, 'popup introuvable')
  assert.ok(
    popupBox.height >= 500 && popupBox.height <= 620,
    `hauteur de popup inattendue : ${popupBox.height}px`,
  )

  // La largeur de la popup d’action est elle aussi calculée d’après son
  // contenu : un max-width en 100vw peut la réduire à quelques pixels. On
  // simule une fenêtre étroite et on vérifie que le contenu garde sa largeur.
  const popupCdp = await context.newCDPSession(popupPage)
  await popupCdp.send('Emulation.setDeviceMetricsOverride', {
    width: 300,
    height: 580,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await popupPage.waitForTimeout(100)
  const narrowPopup = await popupPage.locator('.popup').boundingBox()
  assert.ok(narrowPopup, 'popup introuvable en fenêtre étroite')
  assert.ok(
    narrowPopup.width >= 340,
    `largeur de popup inattendue : ${narrowPopup.width}px`,
  )
  await popupCdp.send('Emulation.clearDeviceMetricsOverride')
  await popupCdp.detach()
  await popupPage.reload()

  await popupPage.locator('.result-group__title').first().waitFor()
  const popupHeadings = await popupPage
    .locator('.result-group__title')
    .allTextContents()
  assert.ok(
    popupHeadings.some((title) => /Pour ce site|For this site/.test(title)),
  )

  await popupPage.locator('#search').fill('introuvable-xyz')
  await popupPage
    .locator('#state-title')
    .filter({ hasText: /Aucun résultat|No results/ })
    .waitFor({ timeout: 10_000 })
  await popupPage.locator('#search').fill(host)
  await popupPage
    .locator('[role="option"]')
    .first()
    .waitFor({ timeout: 10_000 })

  await popupPage.locator('body').click({ position: { x: 4, y: 4 } })
  await popupPage.keyboard.press('/')
  assert.equal(
    await popupPage.evaluate(() => document.activeElement?.id),
    'search',
  )
  await popupPage.keyboard.press('ArrowDown')
  const selectedOption = popupPage.locator(
    '[role="option"][aria-selected="true"]',
  )
  assert.equal(await selectedOption.count(), 1)
  assert.match(
    (await selectedOption.getAttribute('aria-label')) ?? '',
    /Example/,
  )
  await popupPage.keyboard.press('Enter')
  await keyboardPage.waitForFunction(
    () =>
      document.querySelector('#username')?.value === 'ada' &&
      document.querySelector('#password')?.value === 's3cret!',
    null,
    { timeout: 10_000 },
  )
  await popupPage.close().catch(() => undefined)
  await keyboardPage.close()
  await extensionPage.bringToFront()

  // E10 : badge du nombre de connexions, priorité au point d’enregistrement,
  // puis copie TOTP et effacement conditionnel.
  const badgePage = await context.newPage()
  await badgePage.goto(new URL('/shortcut', TARGET_URL).toString())
  await badgePage.bringToFront()
  const readBadge = () =>
    extensionPage.evaluate(() => chrome.action.getBadgeText({}))
  const waitBadge = async (expected) => {
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      if ((await readBadge()) === expected) return
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    assert.equal(await readBadge(), expected)
  }
  await waitBadge('1')

  await badgePage.locator('#password').fill('mot-de-passe-badge!')
  await badgePage.getByRole('button', { name: 'Connexion' }).click()
  await new Promise((resolve) => setTimeout(resolve, 600))
  await waitBadge('●')
  await extensionPage.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return chrome.runtime.sendMessage({
      type: 'SAVE_DISMISS_PENDING',
      tabId: tab.id,
    })
  })
  await waitBadge('1')

  await extensionPage.evaluate(() =>
    chrome.storage.local.set({ copyTotpAfterFill: true }),
  )
  await badgePage.bringToFront()
  await badgePage.locator('#username').fill('')
  await badgePage.locator('#password').fill('')
  await badgePage.locator('#otp').fill('')
  const clipFill = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'RUN_COMMAND', command: 'fill-login' }),
  )
  assert.equal(clipFill.ok, true)
  await badgePage.waitForFunction(
    () => /^\d{6}$/.test(document.querySelector('#otp')?.value ?? ''),
    null,
    { timeout: 10_000 },
  )
  const otp = await badgePage.locator('#otp').inputValue()
  await extensionPage.bringToFront()
  const clipboard = await extensionPage.evaluate(async () => {
    try {
      return await navigator.clipboard.readText()
    } catch (error) {
      return `error:${error.name}`
    }
  })
  if (clipboard.startsWith('error:')) {
    // Xvfb et certains profils Linux refusent la lecture du presse-papiers.
    console.log(`E10 : presse-papiers indisponible (${clipboard}), effacement non vérifié.`)
  } else {
    assert.equal(clipboard, otp)
    await badgePage.bringToFront()
    await new Promise((resolve) => setTimeout(resolve, 31_000))
    await extensionPage.bringToFront()
    const cleared = await extensionPage.evaluate(async () => {
      try {
        return await navigator.clipboard.readText()
      } catch (error) {
        return `error:${error.name}`
      }
    })
    assert.equal(cleared, '')
  }
  await extensionPage.evaluate(() =>
    chrome.storage.local.set({ copyTotpAfterFill: false }),
  )
  await badgePage.close()
  await extensionPage.bringToFront()

  // E2 : bandeau après une inscription avec redirection.
  await target.goto(new URL('/register', TARGET_URL).toString())
  await target.locator('#email').fill('banner@example.com')
  await target.locator('#new-password').fill('mot-de-passe-bandeau!')
  await target.locator('#confirm-password').fill('mot-de-passe-bandeau!')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await target.getByRole('button', { name: 'Créer mon compte' }).click()
  await target.waitForURL('**/welcome*')
  await target
    .locator('[data-coffre-save-banner]')
    .waitFor({ timeout: 10_000 })

  const bannerSecurity = await target.evaluate(() => {
    const host = document.querySelector('[data-coffre-save-banner]')
    host?.click()
    return {
      exists: Boolean(document.querySelector('[data-coffre-save-banner]')),
      shadow: host?.shadowRoot ?? null,
      text: host?.textContent ?? '',
      visibleIframes: document.querySelectorAll('iframe[src*="save-banner"]').length,
    }
  })
  assert.equal(bannerSecurity.exists, true)
  assert.equal(bannerSecurity.shadow, null)
  assert.equal(bannerSecurity.text, '')
  assert.equal(bannerSecurity.visibleIframes, 0)

  const bannerPending = await extensionPage.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({ type: 'GET_PENDING_SAVE', tabId }),
    targetTab.id,
  )
  assert.ok(bannerPending.pending?.id)
  const laterBanner = await context.newPage()
  await laterBanner.goto(
    `chrome-extension://${extensionId}/save-banner.html?offer=${encodeURIComponent(
      bannerPending.pending.id,
    )}`,
  )
  await laterBanner.locator('#banner-later').click()
  await laterBanner.close()
  const afterLater = await extensionPage.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({ type: 'GET_PENDING_SAVE', tabId }),
    targetTab.id,
  )
  assert.equal(afterLater.pending?.id, bannerPending.pending.id)

  const bannerPage = await context.newPage()
  await bannerPage.goto(
    `chrome-extension://${extensionId}/save-banner.html?offer=${encodeURIComponent(
      bannerPending.pending.id,
    )}`,
  )
  await bannerPage.locator('#banner-username').fill('banner+modifie@example.com')
  await bannerPage.locator('#banner-save').click()
  await bannerPage
    .locator('#banner-message')
    .filter({ hasText: /Enregistré|Saved/ })
    .waitFor({ timeout: 10_000 })
  await bannerPage.close()

  const bannerSearch = await extensionPage.evaluate(
    ({ query }) => chrome.runtime.sendMessage({ type: 'SEARCH', query }),
    { query: 'banner+modifie@example.com' },
  )
  const savedBannerItem = bannerSearch.items?.find(
    (entry) => entry.username === 'banner+modifie@example.com',
  )
  assert.ok(savedBannerItem, 'la connexion enregistrée par le bandeau est absente')
  const savedBannerDetails = await extensionPage.evaluate(
    ({ id, host, url }) =>
      chrome.runtime.sendMessage({ type: 'DETAILS', itemId: id, host, url }),
    { id: savedBannerItem.id, host: new URL(TARGET_URL).hostname, url: TARGET_URL },
  )
  assert.equal(savedBannerDetails.details?.password, 'mot-de-passe-bandeau!')
  const bannerCleared = await extensionPage.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({ type: 'GET_PENDING_SAVE', tabId }),
    targetTab.id,
  )
  assert.equal(bannerCleared.pending, null)

  const passkeyURL = new URL('/passkey', TARGET_URL)
  if (passkeyURL.hostname === '127.0.0.1') passkeyURL.hostname = 'localhost'
  if (passkeyURL.protocol === 'https:' || passkeyURL.hostname === 'localhost') {
    const passkeyPage = await context.newPage()
    await passkeyPage.goto(passkeyURL.toString())

    const runPasskey = async (action, button, kind) => {
      await passkeyPage.evaluate(() => {
        const element = document.querySelector('#passkey-result')
        if (element) {
          delete element.dataset.kind
          element.textContent = ''
        }
      })
      const windowPromise = context.waitForEvent('page', { timeout: 30_000 })
      await passkeyPage.getByRole('button', { name: action }).click()
      const prompt = await windowPromise
      // La fenêtre de confirmation se ferme dès que la décision est envoyée :
      // déclencher le clic sans attendre la fermeture évite une course Playwright.
      await prompt
        .getByRole('button', { name: button })
        .evaluate((element) => element.click())
      await passkeyPage.waitForFunction(
        () => Boolean(document.querySelector('#passkey-result')?.dataset.kind),
        null,
        { timeout: 30_000 },
      )
      const text = await passkeyPage.locator('#passkey-result').textContent()
      if (!text || !text.trim().startsWith('{')) {
        throw new Error(`Passkey ${kind} : ${text}`)
      }
      const result = JSON.parse(text)
      assert.equal(result.kind, kind, text)
      return result
    }

    const createdPasskey = await runPasskey(
      'Créer une passkey',
      'Créer avec Coffre',
      'create',
    )
    assert.equal(createdPasskey.attachment, 'platform')
    assert.equal(createdPasskey.attestation, true)
    assert.equal(createdPasskey.publicKey, true)
    assert.deepEqual(createdPasskey.client, {
      typeOk: true,
      challengeOk: true,
      originOk: true,
      rpOk: true,
    })
    verifyRegistration(createdPasskey, passkeyURL.hostname)

    const usedPasskey = await runPasskey(
      'Se connecter',
      'Se connecter avec Coffre',
      'get',
    )
    assert.equal(usedPasskey.id, createdPasskey.id)
    assert.equal(usedPasskey.signature, true)
    assert.deepEqual(usedPasskey.client, {
      typeOk: true,
      challengeOk: true,
      originOk: true,
      rpOk: true,
    })
    verifyAssertion(createdPasskey, usedPasskey, passkeyURL.hostname)
    await app.getByRole('button', { name: /Passkeys/ }).click()
    await app
      .getByText(`Passkey · ${passkeyURL.hostname}`)
      .first()
      .waitFor({ timeout: 10_000 })

    console.log(
      'Extension : passkey créée, attestation vérifiée et assertion signée validée.',
    )
  }

  await app.getByRole('button', { name: 'Verrouiller' }).first().click()
  const locked = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }),
  )
  assert.equal(locked.unlocked, false)
  await extensionPage.bringToFront()
  const lockedMenu = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'CONTEXT_MENU_SNAPSHOT' }),
  )
  assert.deepEqual(
    lockedMenu.model.map((entry) => entry.id),
    ['unlock'],
  )

  // Sans application desktop, le déverrouillage ouvre/active l’onglet Coffre.
  const tabUnlock = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'UNLOCK_REQUEST' }),
  )
  assert.equal(tabUnlock.ok, true)
  assert.equal(tabUnlock.pending, true)
  assert.equal(tabUnlock.mode, 'tab')

  // E5 : l’accueil s’ouvre à l’installation et les réglages complets
  // persistent bien les choix.
  const installedTabs = await extensionPage.evaluate(() => chrome.tabs.query({}))
  assert.ok(
    installedTabs.some((tab) => tab.url?.includes('/welcome.html')),
    'welcome.html n’a pas été ouvert à l’installation',
  )
  const welcome = await context.newPage()
  await welcome.goto(
    `chrome-extension://${extensionId}/welcome.html?mode=install`,
  )
  await welcome
    .locator('h1')
    .filter({ hasText: /Bienvenue|Welcome/ })
    .waitFor()
  assert.ok((await welcome.locator('#welcome-shortcuts li').count()) >= 4)
  await welcome.locator('input[name="app-mode"][value="web"]').check()
  await welcome.locator('input[name="activation"][value="all"]').check()
  const welcomeClosed = welcome.waitForEvent('close', { timeout: 5000 }).catch(
    () => null,
  )
  await welcome.locator('#finish').click()
  await welcomeClosed
  const welcomeSettings = await extensionPage.evaluate(() =>
    chrome.storage.local.get(['appMode', 'activationMode']),
  )
  assert.equal(welcomeSettings.appMode, 'web')
  assert.equal(welcomeSettings.activationMode, 'all')

  const updatePage = await context.newPage()
  await updatePage.goto(
    `chrome-extension://${extensionId}/welcome.html?mode=update`,
  )
  await updatePage.locator('#update-note').waitFor()
  assert.equal(await updatePage.locator('#install-flow').isVisible(), false)
  await updatePage.close()

  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html`)
  await options.locator('h1').waitFor()
  await options.locator('#inline-menu').uncheck()
  await options.locator('#save-banner').uncheck()
  await new Promise((resolve) => setTimeout(resolve, 300))
  const optionSettings = await extensionPage.evaluate(() =>
    chrome.storage.local.get(['inlineMenu', 'saveBanner']),
  )
  assert.equal(optionSettings.inlineMenu, false)
  assert.equal(optionSettings.saveBanner, false)
  await options.close()

  console.log('Extension : recherche, remplissage et verrouillage validés.')
} catch (error) {
  // Afficher l’erreur explicitement : sous xvfb-run, un échec pouvait
  // terminer le job sans aucun message.
  console.error('Extension : échec du parcours.', error)
  process.exitCode = 1
} finally {
  // Le nettoyage ne doit jamais faire échouer un parcours réussi : Chrome
  // peut encore écrire dans le profil (crashpad, cache) juste après close().
  await context.close().catch((error) => {
    console.warn('Extension : fermeture du navigateur incomplète.', error)
  })
  try {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (error) {
    console.warn('Extension : profil temporaire non supprimé.', error)
  }
}
