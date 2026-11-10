import { describe, expect, it } from 'vitest'
import {
  saveBannerSubject,
  saveBannerTitleKey,
  saveBannerView,
} from '../../extension/saveBannerState'
import type { StoredPendingSave } from '../../extension/sessionState'

function pending(overrides: Partial<StoredPendingSave> = {}): StoredPendingSave {
  return {
    id: 'offre-1',
    key: '7:0',
    tabId: 7,
    frameId: 0,
    host: 'example.com',
    kind: 'login',
    label: 'ada@example.com',
    detail: '',
    url: 'https://example.com/login',
    username: 'ada@example.com',
    password: 'secret-en-transit',
    createdAt: 1,
    expiresAt: 2,
    ...overrides,
  }
}

describe('vue du bandeau d’enregistrement', () => {
  it('ne transmet ni mot de passe ni identifiant complet', () => {
    const view = saveBannerView(pending())
    expect(view).toEqual({
      offerId: 'offre-1',
      host: 'example.com',
      label: 'ada@example.com',
      detail: '',
      kind: 'login',
      update: false,
    })
    expect(JSON.stringify(view)).not.toContain('secret-en-transit')
    expect(view).not.toHaveProperty('password')
    expect(view).not.toHaveProperty('username')
  })

  it('choisit le texte de mise à jour et garde l’identifiant comme sujet', () => {
    const view = saveBannerView(
      pending({ update: true, label: 'ada@example.com' }),
    )
    expect(view).not.toBeNull()
    if (!view) return
    expect(saveBannerTitleKey(view)).toBe('saveBanner_titleUpdate')
    expect(saveBannerSubject(view)).toBe('ada@example.com')
  })

  it('adapte le titre aux cartes et identités', () => {
    const card = saveBannerView(pending({ kind: 'card', label: 'Visa' }))
    const identity = saveBannerView(
      pending({ kind: 'identity', label: 'Ada Lovelace' }),
    )
    expect(card && saveBannerTitleKey(card)).toBe('saveBanner_titleCard')
    expect(identity && saveBannerTitleKey(identity)).toBe(
      'saveBanner_titleIdentity',
    )
  })
})
