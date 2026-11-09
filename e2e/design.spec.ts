import { expect, test } from '@playwright/test'
import {
  addLogin,
  clickItemMenu,
  closeDialog,
  createVault,
  openSettings,
} from './helpers'

test.describe('système de design', () => {
  test('aucun débordement horizontal ou vertical aux tailles clés', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await createVault(page)
    await addLogin(page)
    await closeDialog(page)

    for (const [width, height] of [
      [1280, 800],
      [1024, 768],
      [768, 900],
      [375, 812],
      [1280, 480],
      [375, 480],
    ] as const) {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(150)

      if (width <= 768) {
        await expect(page.locator('.search__hint')).toBeHidden()
      } else {
        await expect(page.locator('.search__hint')).toBeVisible()
      }

      const listMetrics = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: innerWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight,
        bodyScrollHeight: document.body.scrollHeight,
        panes: [...document.querySelectorAll<HTMLElement>('.topbar, .content__bar, .list-pane')].map(
          (element) => ({
            name: element.className,
            scroll: element.scrollWidth,
            client: element.clientWidth,
          }),
        ),
      }))
      expect(listMetrics.scroll, `document ${width}px`).toBeLessThanOrEqual(listMetrics.inner)
      expect(listMetrics.scrollHeight, `hauteur document ${height}px`).toBeLessThanOrEqual(
        listMetrics.innerHeight,
      )
      expect(listMetrics.bodyScrollHeight, `hauteur body ${height}px`).toBeLessThanOrEqual(
        listMetrics.innerHeight,
      )
      for (const pane of listMetrics.panes) {
        expect(pane.scroll, `${pane.name} ${width}px`).toBeLessThanOrEqual(pane.client + 1)
      }

      await page.locator('.item-row').filter({ hasText: 'GitHub' }).click()
      const detailMetrics = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: innerWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight,
        panel: (() => {
          const element = document.querySelector<HTMLElement>('.item-panel')
          return element
            ? { scroll: element.scrollWidth, client: element.clientWidth }
            : null
        })(),
      }))
      expect(detailMetrics.scroll, `document détail ${width}px`).toBeLessThanOrEqual(
        detailMetrics.inner,
      )
      expect(
        detailMetrics.scrollHeight,
        `hauteur document détail ${height}px`,
      ).toBeLessThanOrEqual(detailMetrics.innerHeight)
      if (detailMetrics.panel) {
        expect(detailMetrics.panel.scroll, `panneau ${width}px`).toBeLessThanOrEqual(
          detailMetrics.panel.client + 1,
        )
      }
      await closeDialog(page)
    }
  })

  test('le menu mobile fermé est inerte et non focusable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await createVault(page)

    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toHaveAttribute('inert', '')
    await expect
      .poll(() => sidebar.evaluate((element) => getComputedStyle(element).visibility))
      .toBe('hidden')

    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest('.sidebar'))),
        `tabulation ${index + 1}`,
      ).toBe(false)
    }

    await page.getByRole('button', { name: 'Ouvrir le menu' }).click()
    await expect(sidebar).not.toHaveAttribute('inert', '')
    expect(await sidebar.evaluate((element) => getComputedStyle(element).visibility)).toBe(
      'visible',
    )
    await page.keyboard.press('Escape')
    await expect(sidebar).toHaveAttribute('inert', '')
  })

  test('la vue détail mobile affiche le retour et la barre d’actions', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await createVault(page)
    const panel = await addLogin(page)

    await expect(panel.getByRole('heading', { name: 'GitHub' })).toBeVisible()
    const actionbar = page.locator('.detail-actionbar')
    await expect(actionbar).toBeVisible()
    await expect(actionbar.getByRole('button', { name: /Identifiant/ })).toBeVisible()
    await expect(actionbar.getByRole('button', { name: /Mot de passe/ })).toBeVisible()
    await expect(actionbar.getByRole('button', { name: 'Modifier' })).toBeVisible()
    await expect(page.locator('.mobile-tabs')).toBeHidden()
    const back = page.locator('.topbar__back')
    await expect(back).toHaveAttribute('aria-label', 'Retour à Tous les éléments')
    await expect(back).toContainText('Tous les éléments')
    await expect(
      page.getByRole('button', { name: 'Retour à Tous les éléments' }),
    ).toBeVisible()
    const topbarHeight = await page
      .locator('.topbar')
      .evaluate((element) => element.getBoundingClientRect().height)
    expect(topbarHeight).toBeLessThan(72)

    await back.click()
    await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible()
    await expect(page.locator('.mobile-tabs')).toBeVisible()
  })

  test('un seul onglet mobile est actif à la fois', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await createVault(page)

    const tabs = page.locator('.mobile-tabs')
    const active = tabs.locator('.mobile-tabs__item.is-active')
    await expect(active).toHaveCount(1)
    await expect(active).toContainText('Accueil')

    await tabs.getByRole('button', { name: 'Tout', exact: true }).click()
    await expect(active).toHaveCount(1)
    await expect(active).toContainText('Tout')

    await tabs.getByRole('button', { name: 'Sécurité', exact: true }).click()
    await expect(active).toHaveCount(1)
    await expect(active).toContainText('Sécurité')
    await closeDialog(page)

    await tabs.getByRole('button', { name: 'Réglages', exact: true }).click()
    await expect(active).toHaveCount(1)
    await expect(active).toContainText('Réglages')
  })

  test('le menu du détail regroupe les actions secondaires', async ({ page }) => {
    await createVault(page)
    const panel = await addLogin(page)

    await panel.getByRole('button', { name: 'Plus d’actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Historique' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Dupliquer' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Supprimer…' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem', { name: 'Historique' })).toHaveCount(0)
  })

  test('le thème clair ne change pas le sens des états', async ({ page }) => {
    await createVault(page)
    await addLogin(page, 'Compte faible', 'ada', 'abc123')
    await closeDialog(page)

    const settings = await openSettings(page)
    await settings.getByLabel('Apparence').selectOption('light')
    await page.waitForTimeout(350)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)

    const colors = await page.evaluate(() => {
      const active = document.querySelector<HTMLElement>('.sidebar__item.is-active')
      const score = document.querySelector<HTMLElement>('.sidebar__security')
      const root = getComputedStyle(document.documentElement)
      return {
        text1: root.getPropertyValue('--text-1').trim(),
        active: active ? getComputedStyle(active).color : null,
        tone: score?.className ?? '',
        overflow: document.documentElement.scrollWidth > innerWidth,
      }
    })
    expect(colors.text1).toBe('#09090b')
    expect(colors.active).toBe('rgb(9, 9, 11)')
    expect(colors.tone).toContain('sidebar__security--danger')
    expect(colors.overflow).toBe(false)

    const gridDisplay = await page.evaluate(
      () => getComputedStyle(document.body, '::before').display,
    )
    expect(gridDisplay).toBe('none')
  })

  test('les flèches parcourent la liste au clavier', async ({ page }) => {
    await createVault(page)
    await addLogin(page, 'Alpha', 'ada', 'mot-de-passe-alpha')
    await closeDialog(page)
    await addLogin(page, 'Beta', 'grace', 'mot-de-passe-beta')
    await closeDialog(page)

    const rows = page.locator('.item-row')
    await rows.first().focus()
    await page.keyboard.press('ArrowDown')
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('Beta')
    await page.keyboard.press('ArrowUp')
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('Alpha')
    await page.keyboard.press('End')
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('Beta')
    await page.keyboard.press('Home')
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('Alpha')
  })
})


test('crée, lit, modifie et supprime depuis le panneau de détail', async ({ page }) => {
  await createVault(page)
  const panel = await addLogin(page, 'Cycle', 'ada', 'mot-de-passe-solide-123')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await panel.getByRole('button', { name: 'Modifier' }).click()
  await panel.getByLabel('Mot de passe', { exact: true }).fill('nouveau-mot-de-passe-solide')
  await panel.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(panel.getByRole('heading', { name: 'Cycle' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await clickItemMenu(page, panel, 'Supprimer…')
  const confirm = page.getByRole('dialog')
  await expect(confirm.getByRole('heading', { name: 'Déplacer vers la corbeille ?' })).toBeVisible()
  await confirm.getByRole('button', { name: 'Mettre à la corbeille' }).click()

  await expect(page.locator('.item-panel')).toHaveCount(0)
  await expect(page.locator('.item-row')).toHaveCount(0)
})

test('remplace un mot de passe faible depuis le bandeau du détail', async ({ page }) => {
  await createVault(page)
  const panel = await addLogin(page, 'Faible', 'ada', 'abc123', 'https://github.com')
  const alert = panel.locator('.alert-banner')
  await expect(alert).toContainText('Mot de passe faible')

  await alert.getByRole('button', { name: 'Générer' }).click()
  const generator = page.getByRole('dialog')
  await expect(generator.getByRole('heading', { name: 'Générateur' })).toBeVisible()
  await generator.getByRole('button', { name: 'Utiliser' }).click()

  await expect(page.getByText('Mot de passe remplacé')).toBeVisible()
  await expect(alert).toContainText('Sans 2FA')
})

test('glisse vers la droite pour revenir à la liste sur mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await createVault(page)
  await addLogin(page)

  const pane = page.locator('.detail-pane')
  await pane.dispatchEvent('touchstart', {
    touches: [{ identifier: 1, clientX: 30, clientY: 300 }],
    changedTouches: [{ identifier: 1, clientX: 30, clientY: 300 }],
  })
  await pane.dispatchEvent('touchend', {
    touches: [],
    changedTouches: [{ identifier: 1, clientX: 200, clientY: 305 }],
  })

  await expect(page.locator('.item-row').filter({ hasText: 'GitHub' })).toBeVisible()
  await expect(page.locator('.mobile-tabs')).toBeVisible()
})

test('navigue entre les pages de réglages et revient à la liste sur mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await createVault(page)
  const settings = await openSettings(page)

  await expect(settings.getByRole('button', { name: 'Général', exact: true })).toBeVisible()
  await expect(
    settings.getByRole('button', { name: 'Verrouiller maintenant' }),
  ).toHaveCount(0)

  await settings.getByRole('button', { name: 'Sauvegarde et import', exact: true }).click()
  await expect(settings.getByRole('heading', { name: 'Sauvegarde et import' })).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Exporter le coffre' })).toBeVisible()

  await settings.getByRole('button', { name: 'Toutes les sections' }).click()
  await expect(settings.getByRole('button', { name: 'Zone dangereuse', exact: true })).toBeVisible()
})

test('le menu des réglages reste sticky pendant le défilement', async ({ page }) => {
  await createVault(page)
  const settings = await openSettings(page, 'Sauvegarde et import')
  const nav = settings.locator('.settings__nav')
  const content = settings.locator('.settings__content')
  await expect(nav).toBeVisible()

  const before = await nav.boundingBox()
  const scrollable = await content.evaluate(
    (element) => element.scrollHeight > element.clientHeight + 4,
  )
  expect(scrollable).toBe(true)

  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await page.waitForTimeout(150)
  const after = await nav.boundingBox()
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0)
  await expect(nav).toBeVisible()
})
