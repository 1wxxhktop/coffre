import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { addLogin, closeDialog, createVault, openSettings } from './helpers'

async function violations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze()
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 4).map((node) => ({
      target: node.target.join(' '),
      summary: node.failureSummary,
      html: node.html.slice(0, 200),
    })),
  }))
}

test.describe('accessibilité', () => {
  test('chaque contrôle visible possède un nom accessible', async ({ page }) => {
    await createVault(page)
    await addLogin(page)
    await closeDialog(page)

    const problems = await page.evaluate(() => {
      const labelOf = (element: Element) => {
        const aria =
          element.getAttribute('aria-label') ??
          (element.getAttribute('aria-labelledby')
            ? element
                .getAttribute('aria-labelledby')
                ?.split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? '')
                .join(' ')
            : null)
        const text = element.textContent?.trim() ?? ''
        const title = element.getAttribute('title') ?? ''
        return aria || text || title
      }

      const controls = Array.from(
        document.querySelectorAll('button, a[href], input, select, textarea'),
      )
      return controls
        .filter((element) => {
          if (element.closest('[inert]')) return false
          const style = getComputedStyle(element)
          if (style.display === 'none' || style.visibility === 'hidden') return false
          return true
        })
        .filter((element) => {
          const tag = element.tagName.toLowerCase()
          if (tag === 'input') {
            const type = element.getAttribute('type') ?? 'text'
            if (type === 'hidden') return false
            return !(
              (element as HTMLInputElement).labels?.length ||
              element.getAttribute('aria-label') ||
              element.getAttribute('title')
            )
          }
          return !labelOf(element)
        })
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute('type'),
          html: element.outerHTML.slice(0, 160),
        }))
    })

    expect(problems).toEqual([])
  })

  test('le focus reste dans la modale et reste visible', async ({ page, browserName }) => {
    await createVault(page)
    await page.keyboard.press('Tab')
    // Safari/WebKit ne tabule pas vers les liens sans l’option système
    // « Press Tab to highlight each item » ; la vérification VoiceOver couvre
    // ce cas manuellement.
    if (browserName !== 'webkit') {
      await expect(
        page.getByRole('link', { name: 'Aller au contenu' }),
      ).toBeFocused()
    }
    const focusVisible = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      if (!active) return false
      return active.matches(':focus-visible')
    })
    expect(focusVisible).toBe(true)

    const settings = await openSettings(page)
    for (let index = 0; index < 25; index += 1) {
      await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest('.modal'))),
        `tabulation ${index + 1} hors de la modale`,
      ).toBe(true)
    }
    await expect(settings).toBeVisible()
  })

  test('respecte prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await createVault(page)
    const settings = await openSettings(page)
    const duration = await settings.evaluate(
      (element) => getComputedStyle(element).animationDuration,
    )
    const seconds = duration.endsWith('ms')
      ? Number.parseFloat(duration) / 1000
      : Number.parseFloat(duration)
    expect(seconds).toBeLessThanOrEqual(0.001)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

test('le générateur et la palette sont accessibles', async ({ page }) => {
  await createVault(page)
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Palette de commandes' })
  await expect(palette).toBeVisible()
  await expect(
    palette.getByRole('combobox', { name: 'Rechercher un élément ou une action' }),
  ).toBeFocused()
  await page.waitForTimeout(300)
  expect(await violations(page), 'palette').toEqual([])

  await palette.getByRole('combobox').fill('Générer un mot de passe')
  await page.keyboard.press('Enter')
  const generator = page.getByRole('dialog', { name: 'Générateur' })
  await expect(generator).toBeVisible()
  // Laisser l’animation d’ouverture se terminer : axe composite les couleurs
  // avec l’opacité en cours et signalerait un faux contraste.
  await page.waitForTimeout(350)
  expect(await violations(page), 'générateur').toEqual([])

  const passwordTab = generator.getByRole('tab', { name: 'Mot de passe' })
  const passphrase = generator.getByRole('tab', { name: 'Phrase de passe' })
  await passwordTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(passphrase).toBeFocused()
  await expect(passphrase).toHaveAttribute('aria-selected', 'true')
  await page.waitForTimeout(200)
  expect(await violations(page), 'générateur phrase de passe').toEqual([])

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('le sélecteur de type se pilote aux flèches', async ({ page }) => {
  await createVault(page)
  await page.locator('.topbar').getByRole('button', { name: 'Nouvel élément' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Nouvel élément' })).toBeVisible()
  await page.waitForTimeout(350)
  expect(await violations(page), 'nouvel élément').toEqual([])

  const login = dialog.getByRole('radio', { name: 'Connexion' })
  const note = dialog.getByRole('radio', { name: 'Note' })
  await login.focus()
  await page.keyboard.press('ArrowRight')
  await expect(note).toBeFocused()
  await expect(note).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('End')
  await expect(
    dialog.getByRole('radio', { name: 'Codes de secours' }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Home')
  await expect(login).toHaveAttribute('aria-checked', 'true')
  await page.waitForTimeout(200)
  expect(await violations(page), 'sélecteur de type').toEqual([])
})

test('la palette ouvre un élément au clavier', async ({ page }) => {
  await createVault(page)
  await addLogin(page)
  await closeDialog(page)

  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Palette de commandes' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('GitHub')
  const option = palette.getByRole('option', { name: /GitHub/ }).first()
  await expect(option).toBeVisible()
  for (let index = 0; index < 3; index += 1) {
    await page.keyboard.press('Tab')
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('.palette'))),
      `tabulation ${index + 1} hors de la palette`,
    ).toBe(true)
  }
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.locator('.item-panel').getByRole('heading', { name: 'GitHub' }),
  ).toBeVisible()
})

test('l’assistant d’installation de l’extension est accessible', async ({ page }) => {
  await createVault(page)
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('coffre:extension-onboarding')),
  )
  const dialog = page.getByRole('dialog', { name: 'Installez l’extension Coffre' })
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(350)
  expect(await violations(page), 'assistant extension').toEqual([])
})

test('aucune violation axe A/AA sur les écrans principaux', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Créer votre coffre' })).toBeVisible()
  expect(await violations(page), 'authentification').toEqual([])

  await createVault(page)
  await addLogin(page, 'Compte faible', 'ada', 'abc123')
  expect(await violations(page), 'détail').toEqual([])
  await closeDialog(page)
  expect(await violations(page), 'liste').toEqual([])

  const dashboardButton = page.getByRole('button', { name: 'Tableau de bord' }).first()
  if (await dashboardButton.isVisible()) {
    await dashboardButton.click()
  } else {
    await page.getByRole('button', { name: 'Accueil' }).click()
  }
  await expect(page.locator('.dashboard')).toBeVisible()
  expect(await violations(page), 'tableau de bord').toEqual([])

  const settings = await openSettings(page)
  expect(await violations(page), 'réglages').toEqual([])
  await settings.getByLabel('Apparence').selectOption('light')
  await page.waitForTimeout(350)
  expect(await violations(page), 'réglages clairs').toEqual([])
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  await page.getByRole('button', { name: /^Sécurité/ }).click()
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Sécurité du coffre' }),
  ).toBeVisible()
  await page.waitForTimeout(200)
  expect(await violations(page), 'tableau de bord sécurité').toEqual([])
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Tous les éléments' }).first().click()
  await expect(
    page.locator('.item-row').filter({ hasText: 'Compte faible' }),
  ).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await violations(page), 'liste mobile').toEqual([])
  await page.locator('.item-row').filter({ hasText: 'Compte faible' }).click()
  expect(await violations(page), 'détail mobile').toEqual([])
})
