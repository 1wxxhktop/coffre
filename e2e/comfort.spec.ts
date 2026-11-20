import { expect, test } from '@playwright/test'
import { addLogin, createVault, selectItemType } from './helpers'

test.describe('confort de la fiche et accès rapides', () => {
  test('la palette ouvre un élément ou lance une action', async ({ page }) => {
    await createVault(page)
    await addLogin(page, 'Banque Postale', 'ada@exemple.fr')
    await addLogin(page, 'Intranet')

    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Palette de commandes' })
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('option', { name: /Nouvel élément/ })).toBeVisible()

    await palette.getByRole('combobox').fill('banq')
    await expect(palette.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(palette).toHaveCount(0)
    const itemModal = page.getByRole('dialog', { name: 'Banque Postale' })
    await expect(itemModal).toBeVisible()
    // La fiche s’ouvre en modale : le panneau latéral reste inchangé.
    await expect(itemModal.getByRole('heading', { name: 'Banque Postale' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(itemModal).toHaveCount(0)

    // Un clic sur un résultat ouvre lui aussi la fiche en modale.
    await page.keyboard.press('ControlOrMeta+k')
    await palette.getByRole('combobox').fill('intra')
    await palette.getByRole('option', { name: /Intranet/ }).click()
    const intranetModal = page.getByRole('dialog', { name: 'Intranet' })
    await expect(intranetModal).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(intranetModal).toHaveCount(0)

    await page.keyboard.press('ControlOrMeta+k')
    await palette.getByRole('combobox').fill('reglages')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Réglages' })).toBeVisible()
  })

  test('Échap ferme la palette sans rien changer', async ({ page }) => {
    await createVault(page)
    const panel = await addLogin(page, 'Intranet')
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Palette de commandes' })
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
    await expect(panel.getByRole('heading', { name: 'Intranet' })).toBeVisible()
  })

  test('⌘, ouvre directement les réglages', async ({ page }) => {
    await createVault(page)
    await page.keyboard.press('ControlOrMeta+,')
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Réglages' }),
    ).toBeVisible()
  })

  test('l’accès rapide liste les éléments utilisés et les rouvre', async ({ page }) => {
    await createVault(page)
    await addLogin(page, 'Banque Postale')
    await addLogin(page, 'Intranet')
    await page.locator('.item-row', { hasText: 'Banque Postale' }).click()
    await page.locator('.item-row', { hasText: 'Intranet' }).click()

    const quick = page.getByRole('group', { name: 'Accès rapide' })
    await expect(quick.getByRole('button')).toHaveCount(2)
    // « Accès rapide » classe par nombre d’utilisations, pas seulement par date.
    for (let click = 0; click < 3; click += 1) {
      await page.locator('.item-row', { hasText: 'Banque Postale' }).click()
    }
    await expect(quick.getByRole('button').first()).toHaveAccessibleName('Banque Postale')
    await quick.getByRole('button', { name: 'Banque Postale' }).click()
    await expect(
      page.locator('.item-panel').getByRole('heading', { name: 'Banque Postale' }),
    ).toBeVisible()

    // Masqué pendant une recherche.
    await page.getByRole('searchbox').fill('intra')
    await expect(quick).toHaveCount(0)
  })

  test('un compte sans site reçoit une pastille à initiale teintée', async ({ page }) => {
    await createVault(page)
    await addLogin(page, 'Élan Coopérative')
    const monogram = page.locator('.item-row .item-icon__monogram')
    await expect(monogram).toHaveText('E')
    await expect(monogram).toHaveAttribute('data-tint', /^[1-6]$/)
  })

  test('la fiche résume la sécurité et place l’alerte sous le mot de passe', async ({
    page,
  }) => {
    await createVault(page)
    const panel = await addLogin(page, 'Faible', 'ada', 'abc123')

    const health = panel.locator('.detail-health')
    await expect(health.locator('.alert-banner--inline')).toContainText('Mot de passe faible')
    await expect(health.getByRole('button', { name: 'Générer' })).toBeVisible()

    const facts = panel.getByRole('region', { name: 'Sécurité' })
    await expect(facts).toContainText('Robustesse')
    await expect(facts).toContainText('Mot de passe unique')
    await expect(facts).toContainText('Aujourd’hui')
  })

  test('les flèches réordonnent les champs personnalisés', async ({ page }) => {
    await createVault(page)
    const panel = await addLogin(page, 'Ordre')
    await panel.getByRole('button', { name: 'Modifier' }).click()
    for (const name of ['Premier', 'Second']) {
      await panel.getByRole('button', { name: 'Ajouter un champ' }).click()
      await panel.getByLabel('Nom du champ personnalisé').last().fill(name)
      await panel.locator('.custom-field').last().getByLabel(/^Valeur de/).fill(`v-${name}`)
    }

    await panel.getByRole('button', { name: 'Déplacer le champ Premier' }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(panel.getByLabel('Nom du champ personnalisé').first()).toHaveValue('Second')

    await panel.getByRole('button', { name: 'Enregistrer' }).click()
    const labels = panel.locator('.detail-list--custom .detail-row__label')
    await expect(labels).toHaveText(['Second', 'Premier'])
  })

  test('affiche les notes en Markdown sans interpréter de HTML', async ({ page }) => {
    await createVault(page)
    const panel = await addLogin(page, 'GitHub')
    await panel.getByRole('button', { name: 'Modifier' }).click()
    await panel.getByLabel('Notes', { exact: true }).fill(
      [
        '# Serveur',
        '',
        '- [x] **Clé** changée',
        '- [ ] Vérifier',
        '',
        '[Documentation](https://example.com/docs)',
        '',
        '<script>alert(1)</script>',
      ].join('\n'),
    )
    await panel.getByRole('button', { name: 'Enregistrer' }).click()

    const markdown = panel.locator('.markdown-notes')
    await expect(markdown.getByRole('heading', { name: 'Serveur' })).toBeVisible()
    await expect(markdown.locator('strong').filter({ hasText: 'Clé' })).toBeVisible()
    await expect(markdown.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
      'href',
      'https://example.com/docs',
    )
    await expect(markdown.locator('input[type="checkbox"]')).toHaveCount(2)
    await expect(markdown).toContainText('<script>alert(1)</script>')
  })

  test('un compte bancaire peut stocker ses identifiants de connexion', async ({
    page,
  }) => {
    await createVault(page)
    await page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }).click()
    await selectItemType(page, 'Compte et carte')
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Titre', { exact: true }).fill('Compte bancaire')
    await dialog.getByLabel('Identifiant', { exact: true }).fill('ada@example.com')
    await dialog
      .getByLabel('Mot de passe', { exact: true })
      .fill('mot-de-passe-du-site')
    await dialog
      .getByPlaceholder('https://exemple.com')
      .fill('https://banque.example.com')
    await dialog.getByLabel('Banque').fill('Banque de test')
    await dialog.getByRole('button', { name: 'Enregistrer' }).click()

    const panel = page.locator('.item-panel')
    await expect(panel.getByRole('heading', { name: 'Compte bancaire' })).toBeVisible()
    await expect(panel.getByText('ada@example.com')).toBeVisible()
    await expect(
      panel.getByRole('link', { name: /banque\.example\.com/ }),
    ).toBeVisible()
    await panel.getByRole('button', { name: 'Afficher Mot de passe' }).click()
    await expect(panel.getByText('mot-de-passe-du-site')).toBeVisible()
  })

  test('associe un compte mail à un compte bancaire', async ({ page }) => {
    await createVault(page)
    await addLogin(page, 'Gmail', 'ada@gmail.com', 'mot-de-passe-gmail')

    await page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }).click()
    await selectItemType(page, 'Compte et carte')
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Titre', { exact: true }).fill('Compte bancaire')
    await dialog.getByLabel('Banque').fill('Banque de test')
    await dialog.getByRole('button', { name: 'Enregistrer' }).click()

    const panel = page.locator('.item-panel')
    await panel.getByRole('button', { name: 'Associer', exact: true }).click()
    const picker = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Associer un élément' }) })
    await picker.getByRole('searchbox').fill('Gmail')
    await picker.getByRole('button', { name: /Gmail/ }).click()
    await picker.getByRole('button', { name: 'Terminer' }).click()

    const related = panel.locator('.related-list__item').filter({ hasText: 'Gmail' })
    await expect(related).toBeVisible()
    await related.click()
    await expect(
      page.locator('.item-panel').getByRole('heading', { name: 'Gmail' }),
    ).toBeVisible()
    await expect(
      page
        .locator('.item-panel')
        .locator('.related-list__item')
        .filter({ hasText: 'Compte bancaire' }),
    ).toBeVisible()
  })

  test('génère un mot de passe pour un champ personnalisé', async ({ page }) => {
    await createVault(page)
    const panel = await addLogin(page, 'GitHub')
    await panel.getByRole('button', { name: 'Modifier' }).click()
    await panel.getByRole('button', { name: 'Ajouter un champ' }).click()
    await panel
      .getByLabel('Nom du champ personnalisé')
      .last()
      .fill('Clé secondaire')
    await panel
      .getByLabel('Type du champ personnalisé')
      .last()
      .selectOption('password')

    const row = panel.locator('.custom-field').last()
    await row.getByRole('button', { name: 'Générer un mot de passe' }).click()
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Générateur' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Utiliser' }).click()
    await expect(row.locator('.custom-field__value')).not.toHaveValue('')
  })

  test('le générateur est accessible depuis la barre latérale', async ({ page }) => {
    await createVault(page)
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'Générateur', exact: true })
      .click()
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Générateur' }),
    ).toBeVisible()
  })

  test('édite et valide la séquence de saisie automatique', async ({ page }) => {
    await createVault(page)
    const panel = await addLogin(page, 'GitHub')
    await panel.getByRole('button', { name: 'Modifier' }).click()

    const sequence = panel.getByLabel('Séquence de saisie automatique')
    await sequence.fill('{USERNAME}{TAB}{PASSWORD}{ENTER}{DELAY 250}')
    await panel.getByRole('button', { name: 'Enregistrer' }).click()

    await panel.getByRole('button', { name: 'Modifier' }).click()
    await expect(panel.getByLabel('Séquence de saisie automatique')).toHaveValue(
      '{USERNAME}{TAB}{PASSWORD}{ENTER}{DELAY 250}',
    )

    await panel.getByLabel('Séquence de saisie automatique').fill('{SECRET}')
    await expect(
      panel.locator('.field__hint--error').filter({
        hasText: 'Jeton de saisie inconnu : SECRET',
      }),
    ).toBeVisible()
    await panel.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(
      panel.getByRole('alert').filter({
        hasText: 'Jeton de saisie inconnu : SECRET',
      }),
    ).toBeVisible()
  })
})
