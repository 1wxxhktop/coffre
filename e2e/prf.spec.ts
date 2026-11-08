import { expect, test } from '@playwright/test'

const PASSWORD = 'phrase de passe de test solide'

test('enrôle puis utilise une clé FIDO2/PRF', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebAuthn virtuel via CDP/Chromium')
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'usb',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  })

  await page.goto('http://localhost:4173')
  await page.getByLabel('Nom du coffre').fill('Personnel')
  await page.getByLabel('Mot de passe maître').fill(PASSWORD)
  await page.getByLabel('Confirmer le mot de passe').fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Créer mon coffre' }).click()
  await page.getByRole('button', { name: 'Nouvel élément' }).first().waitFor({
    timeout: 45_000,
  })

  await page.getByRole('button', { name: 'Réglages' }).first().click()
  const settings = page.getByRole('dialog')
  await settings.getByRole('button', { name: 'Sécurité', exact: true }).click()
  await settings.getByRole('button', { name: 'Configurer une clé' }).click()
  await expect(page.getByText('Clé de sécurité configurée')).toBeVisible({
    timeout: 30_000,
  })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: 'Verrouiller' }).first().click()
  await expect(
    page.getByRole('button', { name: 'Déverrouiller avec une clé de sécurité' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Déverrouiller avec une clé de sécurité' })
    .click()
  await expect(page.getByRole('button', { name: 'Nouvel élément' }).first()).toBeVisible({
    timeout: 45_000,
  })
})
