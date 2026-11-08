import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault, openSettings } from './helpers'

const NEW_PASSWORD = 'nouvelle phrase de passe solide'

test('génère un kit d’urgence et restaure le coffre avec trois parts sur cinq', async ({
  page,
}) => {
  await createVault(page)
  await addLogin(page)
  await closeDialog(page)

  const settings = await openSettings(page, 'Sécurité')
  await settings.getByRole('button', { name: 'Configurer une phrase' }).click()

  const recovery = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Phrase de récupération', level: 2 }),
  })
  await recovery.getByRole('button', { name: 'Générer une phrase' }).click()
  await recovery.getByRole('checkbox').check()
  await recovery.getByRole('button', { name: 'Activer la récupération' }).click()
  await expect(recovery).toHaveCount(0)

  const kitButton = settings.getByRole('button', { name: 'Créer le kit d’urgence' })
  await expect(kitButton).toBeEnabled()
  await kitButton.click()

  const kit = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Kit d’urgence', level: 2 }),
  })
  await kit.getByRole('button', { name: 'Générer les parts' }).click()

  const shareCards = kit.locator('.emergency-kit__share')
  await expect(shareCards).toHaveCount(5)
  await expect(kit.locator('.emergency-kit__qr img')).toHaveCount(5)
  await expect(kit.getByRole('button', { name: 'Imprimer / Enregistrer en PDF' })).toBeEnabled()

  const shares = await shareCards.evaluateAll((nodes) =>
    nodes.map((node) =>
      Array.from(node.querySelectorAll('.emergency-kit__word-groups code'))
        .map((code) => code.textContent ?? '')
        .join(' ')
        .trim(),
    ),
  )
  expect(shares).toHaveLength(5)
  for (const share of shares) {
    expect(share.split(/\s+/).length).toBeGreaterThan(20)
  }

  // Le rendu imprimable masque les actions et conserve les QR codes.
  await page.emulateMedia({ media: 'print' })
  await expect(kit.locator('.emergency-kit__sheet')).toBeVisible()
  await expect(kit.locator('.modal__footer')).toBeHidden()
  await expect(kit.locator('.emergency-kit__qr img').first()).toBeVisible()
  // La modale de réglages, ouverte derrière, ne doit pas être imprimée.
  await expect(page.getByRole('heading', { name: 'Réglages', level: 2 })).toBeHidden()
  await page.emulateMedia({ media: 'screen' })

  await kit.locator('.modal__footer').getByRole('button', { name: 'Fermer' }).click()
  await closeDialog(page)

  await page.getByRole('button', { name: 'Verrouiller' }).first().click()
  await expect(page.getByRole('heading', { name: 'Déverrouiller' })).toBeVisible()

  await page
    .getByRole('button', { name: 'Déverrouiller avec une phrase de récupération' })
    .click()
  const unlock = page.getByRole('dialog')
  await unlock.getByRole('tab', { name: 'Parts de secours' }).click()

  // Trois parts quelconques parmi les cinq suffisent.
  await unlock.getByLabel('Part 1').fill(shares[0])
  await unlock.getByLabel('Part 2').fill(shares[2])
  await unlock.getByLabel('Part 3').fill(shares[4])
  await unlock.getByLabel('Nouveau mot de passe maître').fill(NEW_PASSWORD)
  await unlock.getByLabel('Confirmer le mot de passe').fill(NEW_PASSWORD)
  await unlock.getByRole('button', { name: 'Récupérer le coffre' }).click()

  await expect(page.getByRole('button', { name: 'Nouvel élément' })).toBeVisible({
    timeout: 45_000,
  })
  await expect(page.getByText('GitHub')).toBeVisible()
})
