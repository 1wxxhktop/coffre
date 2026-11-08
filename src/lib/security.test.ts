import { describe, expect, it } from 'vitest'
import {
  analyzeSecurity,
  incompleteReason,
  securityLabel,
  securityTone,
  weakPasswordReason,
} from './security'
import type { LoginItem, NoteItem, VaultItem } from './types'

const NOW = '2026-11-08T12:00:00.000Z'
const NOW_MS = Date.parse(NOW)

function login(overrides: Partial<LoginItem> = {}): LoginItem {
  return {
    id: 'i_login',
    vaultId: 'v1',
    type: 'login',
    title: 'Compte',
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    username: 'ada',
    password: 'correct horse battery staple',
    urls: ['https://example.com'],
    totp: 'otpauth://totp/Compte?secret=JBSWY3DPEHPK3PXP',
    ...overrides,
  }
}

function note(overrides: Partial<NoteItem> = {}): NoteItem {
  return {
    id: 'i_note',
    vaultId: 'v1',
    type: 'note',
    title: 'Note',
    favorite: false,
    notes: 'Contenu',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('analyse de sécurité', () => {
  it('détecte les faiblesses, réutilisations, anciennetés, absences de 2FA et doublons', () => {
    const items: VaultItem[] = [
      login({
        id: 'a',
        title: 'Compte A',
        password: 'tR8!wZq4@nB1-réutilisé',
        urls: ['https://example.com/login'],
      }),
      login({
        id: 'b',
        title: 'Compte B',
        password: 'tR8!wZq4@nB1-réutilisé',
        urls: ['example.com/login'],
        totp: '',
      }),
      login({
        id: 'c',
        title: 'Ancien compte',
        password: 'abc123',
        urls: ['https://old.example.com'],
        updatedAt: '2020-01-01T00:00:00.000Z',
        totp: '',
      }),
      login({
        id: 'healthy',
        title: 'Compte sain',
        password: 'Très-long-mot-de-passe-aléatoire-42!',
        urls: ['https://bonjour.example.org'],
        totp: 'otpauth://totp/Bonjour?secret=JBSWY3DPEHPK3PXP',
      }),
      login({
        id: 'trash',
        title: 'Corbeille',
        password: 'abc',
        deletedAt: '2026-11-07T00:00:00.000Z',
      }),
      note(),
    ]

    const report = analyzeSecurity(items, NOW_MS)

    expect(report.total).toBe(4)
    expect(report.weak.map((item) => item.id)).toEqual(['c'])
    expect(report.reused).toHaveLength(1)
    expect(report.reused[0].items.map((item) => item.id).sort()).toEqual(['a', 'b'])
    expect(report.old.map((item) => item.id)).toEqual(['c'])
    expect(report.no2fa.map((item) => item.id).sort()).toEqual(['b', 'c'])
    expect(report.duplicates).toHaveLength(1)
    expect(report.duplicates[0].url).toBe('example.com/login')
    expect(report.affected).toBe(3)
    expect(report.score).toBeGreaterThan(0)
    expect(report.score).toBeLessThan(100)
  })

  it('renvoie un score parfait pour un coffre vide ou sain', () => {
    expect(analyzeSecurity([], NOW_MS)).toMatchObject({
      total: 0,
      score: 100,
      affected: 0,
    })
    expect(
      analyzeSecurity([login({ id: 'ok', password: 'Très-long-mot-de-passe-aléatoire-42!' })], NOW_MS),
    ).toMatchObject({ total: 1, score: 100, affected: 0 })
  })

  it('ne signale pas une connexion sans mot de passe comme absence de 2FA', () => {
    const report = analyzeSecurity([login({ id: 'vide', password: '', totp: '' })], NOW_MS)
    expect(report.no2fa).toHaveLength(0)
  })

  it('explique les faiblesses et les champs manquants', () => {
    const personal = login({
      title: 'Banque',
      username: 'ada',
      password: 'ada2024',
    })
    expect(weakPasswordReason(personal)).toMatch(/identifiant|moins de 12|entropie/)

    const incomplete = login({ password: '', username: '', urls: [''] })
    expect(incompleteReason(incomplete)).toBe(
      'mot de passe absent · identifiant absent · URL absente',
    )
    expect(weakPasswordReason(incomplete)).toBeNull()
  })

  it('détecte les variantes proches sans confondre les doublons exacts', () => {
    const report = analyzeSecurity(
      [
        login({ id: 'v1', password: 'Password123!' }),
        login({ id: 'v2', password: 'Password456!' }),
        login({ id: 'exact1', password: 'identique-123' }),
        login({ id: 'exact2', password: 'identique-123' }),
      ],
      NOW_MS,
    )

    expect(report.similar).toHaveLength(1)
    expect(report.similar[0].items.map((item) => item.id).sort()).toEqual(['v1', 'v2'])
    expect(report.reused).toHaveLength(1)
    expect(report.reused[0].items.map((item) => item.id).sort()).toEqual([
      'exact1',
      'exact2',
    ])
  })

  it('expose la distribution, le libellé du score et les identifiants concernés', () => {
    const report = analyzeSecurity(
      [
        login({ id: 'strong', password: 'Très-long-mot-de-passe-aléatoire-42!' }),
        login({ id: 'medium', password: 'BleuCiel42!!!' }),
        login({ id: 'weak', password: 'abc123' }),
        login({ id: 'empty', password: '' }),
      ],
      NOW_MS,
    )

    expect(report.strongCount).toBe(1)
    expect(report.weak).toHaveLength(1)
    expect(report.mediumCount).toBe(1)
    expect(report.issueIds).toEqual(expect.arrayContaining(['weak', 'empty']))
    expect(report.scoreLabel).toBe(securityLabel(report.score))
    expect(securityLabel(95)).toBe('Excellent')
    expect(securityLabel(70)).toBe('À améliorer')
  })

  it('classe le ton du score', () => {
    expect(securityTone(90)).toBe('good')
    expect(securityTone(65)).toBe('warning')
    expect(securityTone(20)).toBe('danger')
  })
})
