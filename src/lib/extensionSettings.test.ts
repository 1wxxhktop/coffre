import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_URL,
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeAppUrl,
  sanitizeSettings,
  saveSettings,
  usesNativeBridge,
  type LocalStorageArea,
} from '../../extension/settings'

class FakeStorage implements LocalStorageArea {
  readonly values: Record<string, unknown> = {}

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null || keys === undefined) return { ...this.values }
    const wanted = Array.isArray(keys) ? keys : [keys]
    return Object.fromEntries(
      wanted
        .filter((key) => Object.hasOwn(this.values, key))
        .map((key) => [key, this.values[key]]),
    )
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items)
  }
}

describe('réglages de l’extension', () => {
  it('applique des valeurs par défaut sûres', async () => {
    const storage = new FakeStorage()
    const settings = await loadSettings(storage)
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(settings.appUrl).toBe(DEFAULT_APP_URL)
    expect(settings.activationMode).toBe('site')
    expect(settings.inlineMenu).toBe(true)
    expect(settings.saveBanner).toBe(true)
    expect(settings.copyTotpAfterFill).toBe(false)
    expect(settings.autofillOnLoad).toBe(false)
    expect(settings.neverFillSites).toEqual([])
    expect(settings.neverSaveSites).toEqual([])
  })

  it('normalise l’adresse et refuse les schémas dangereux', () => {
    expect(normalizeAppUrl('https://Coffre.example/app/')).toBe(
      'https://coffre.example',
    )
    expect(normalizeAppUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeAppUrl('pas une url')).toBeNull()
  })

  it('assainit les valeurs stockées et les exclusions', () => {
    const settings = sanitizeSettings({
      appUrl: 'https://coffre.example/chemin',
      appMode: 'web',
      activationMode: 'all',
      inlineMenu: false,
      saveBanner: false,
      neverFillSites: ['www.Example.com', 'example.com', '  ', 42],
      neverSaveSites: ['login.example.com'],
    })
    expect(settings).toMatchObject({
      appUrl: 'https://coffre.example',
      appMode: 'web',
      activationMode: 'all',
      inlineMenu: false,
      saveBanner: false,
      neverFillSites: ['example.com'],
      neverSaveSites: ['example.com'],
    })
  })

  it('ne persiste que les clés demandées', async () => {
    const storage = new FakeStorage()
    await saveSettings({ appMode: 'desktop', activationMode: 'all' }, storage)
    expect(storage.values).toEqual({
      appMode: 'desktop',
      activationMode: 'all',
    })
    const settings = await loadSettings(storage)
    expect(settings.appMode).toBe('desktop')
    expect(settings.activationMode).toBe('all')
    expect(settings.inlineMenu).toBe(true)
  })

  it('sépare le mode web du pont natif', () => {
    expect(usesNativeBridge('auto')).toBe(true)
    expect(usesNativeBridge('desktop')).toBe(true)
    expect(usesNativeBridge('web')).toBe(false)
  })
})
