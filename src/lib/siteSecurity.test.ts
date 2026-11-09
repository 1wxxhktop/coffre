import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  loadSiteSecurity,
  resetSiteSecurityForTests,
  siteOffersTwoFactor,
  siteSecurityCoverage,
  siteSecurityForHost,
  siteSecurityLoaded,
  siteSupportsPasskeys,
} from './siteSecurity'

beforeAll(async () => {
  resetSiteSecurityForTests()
  await loadSiteSecurity()
})

describe('disponibilité 2FA et passkeys par site', () => {
  it('charge l’instantané embarqué', () => {
    expect(siteSecurityLoaded()).toBe(true)
    expect(siteSecurityCoverage()).toEqual({ twoFactor: 2453, passkeys: 403 })
  })

  it('connaît la 2FA et les passkeys de GitHub', () => {
    const info = siteSecurityForHost('github.com')
    expect(info).not.toBeNull()
    expect(info?.twoFactor).toEqual(expect.arrayContaining(['totp']))
    expect(info?.documentation).toMatch(/^https:\/\//)
    expect(info?.passkeys).toBe(true)
  })

  it('remonte au domaine parent', () => {
    expect(siteSecurityForHost('mail.google.com')?.twoFactor.length).toBeGreaterThan(0)
    expect(siteSecurityForHost('login.github.com')?.passkeys).toBe(true)
  })

  it('ne renvoie rien pour un domaine inconnu ou vide', () => {
    expect(siteSecurityForHost('inconnu.example')).toBeNull()
    expect(siteSecurityForHost('')).toBeNull()
    expect(siteSecurityForHost('192.168.1.10')).toBeNull()
  })

  it('expose les deux prédicats', () => {
    expect(siteOffersTwoFactor('github.com')).toBe(true)
    expect(siteSupportsPasskeys('github.com')).toBe(true)
    expect(siteOffersTwoFactor('inconnu.example')).toBe(false)
    expect(siteSupportsPasskeys('inconnu.example')).toBe(false)
  })

  it('ne fait aucun appel réseau pour charger le jeu de données', async () => {
    resetSiteSecurityForTests()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await loadSiteSecurity()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(siteSecurityLoaded()).toBe(true)
    fetchSpy.mockRestore()
  })
})
