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
  await form.getByPlaceholder('https://exemple.com').fill(TARGET_URL)
  await form.getByRole('button', { name: 'Enregistrer' }).click()
  await app
    .locator('.item-panel')
    .getByRole('heading', { name: 'Example' })
    .waitFor()
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

  const details = await extensionPage.evaluate(
    ({ id, host }) => chrome.runtime.sendMessage({ type: 'DETAILS', itemId: id, host }),
    { id: itemId, host },
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
      await prompt.getByRole('button', { name: button }).click()
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

  console.log('Extension : recherche, remplissage et verrouillage validés.')
} finally {
  await context.close()
  rmSync(workDir, { recursive: true, force: true })
}
