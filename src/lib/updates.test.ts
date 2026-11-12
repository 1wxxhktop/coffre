import { describe, expect, it } from 'vitest'
import {
  isPrerelease,
  isSkippedVersion,
  isUpdateCheckDue,
  progressPercent,
  UPDATE_ERROR_TEXTS,
  updateErrorCode,
} from './updates'

const NOW = new Date('2026-11-10T12:00:00.000Z')

describe('planification des mises à jour', () => {
  it('ne vérifie jamais quand la recherche est désactivée', () => {
    expect(
      isUpdateCheckDue({ updateCheck: 'off', updateLastCheckAt: null }, NOW, false),
    ).toBe(false)
  })

  it('vérifie une seule fois par lancement en mode « au démarrage »', () => {
    const settings = { updateCheck: 'launch' as const, updateLastCheckAt: null }
    expect(isUpdateCheckDue(settings, NOW, false)).toBe(true)
    expect(isUpdateCheckDue(settings, NOW, true)).toBe(false)
  })

  it('respecte l’intervalle quotidien et hebdomadaire', () => {
    const hourAgo = '2026-11-10T11:00:00.000Z'
    const dayAgo = '2026-11-09T11:00:00.000Z'
    const sixDays = '2026-11-04T13:00:00.000Z'
    const eightDays = '2026-11-02T12:00:00.000Z'
    expect(isUpdateCheckDue({ updateCheck: 'daily', updateLastCheckAt: null }, NOW, true)).toBe(true)
    expect(isUpdateCheckDue({ updateCheck: 'daily', updateLastCheckAt: hourAgo }, NOW, true)).toBe(false)
    expect(isUpdateCheckDue({ updateCheck: 'daily', updateLastCheckAt: dayAgo }, NOW, true)).toBe(true)
    expect(isUpdateCheckDue({ updateCheck: 'weekly', updateLastCheckAt: sixDays }, NOW, true)).toBe(false)
    expect(isUpdateCheckDue({ updateCheck: 'weekly', updateLastCheckAt: eightDays }, NOW, true)).toBe(true)
  })

  it('vérifie au lancement puis au plus une fois par minute en continu', () => {
    const continuous = { updateCheck: 'continuous' as const, updateLastCheckAt: null }
    expect(isUpdateCheckDue(continuous, NOW, false)).toBe(true)
    expect(
      isUpdateCheckDue(
        { updateCheck: 'continuous', updateLastCheckAt: '2026-11-10T11:59:30.000Z' },
        NOW,
        true,
      ),
    ).toBe(false)
    expect(
      isUpdateCheckDue(
        { updateCheck: 'continuous', updateLastCheckAt: '2026-11-10T11:58:50.000Z' },
        NOW,
        true,
      ),
    ).toBe(true)
    // Un lancement force une vérification même si la dernière est récente.
    expect(
      isUpdateCheckDue(
        { updateCheck: 'continuous', updateLastCheckAt: '2026-11-10T11:59:59.000Z' },
        NOW,
        false,
      ),
    ).toBe(true)
  })

  it('ne reste pas bloqué si la dernière date est dans le futur', () => {
    expect(
      isUpdateCheckDue(
        { updateCheck: 'weekly', updateLastCheckAt: '2027-01-01T00:00:00.000Z' },
        NOW,
        true,
      ),
    ).toBe(true)
  })
})

describe('versions et progression', () => {
  it('reconnaît une version ignorée et une préversion', () => {
    expect(isSkippedVersion({ updateSkippedVersion: '1.0.0' }, '1.0.0')).toBe(true)
    expect(isSkippedVersion({ updateSkippedVersion: '1.0.0' }, '1.0.1')).toBe(false)
    expect(isSkippedVersion({ updateSkippedVersion: null }, '1.0.0')).toBe(false)
    expect(isPrerelease('1.2.0-beta.1')).toBe(true)
    expect(isPrerelease('1.2.0')).toBe(false)
  })

  it('calcule un pourcentage borné, ou null si la taille est inconnue', () => {
    expect(progressPercent(null)).toBeNull()
    expect(progressPercent({ downloaded: 10, total: null })).toBeNull()
    expect(progressPercent({ downloaded: 50, total: 200 })).toBe(25)
    expect(progressPercent({ downloaded: 300, total: 200 })).toBe(100)
  })

  it('réduit les erreurs Rust à des codes stables, tous traduits', () => {
    expect(updateErrorCode('not-configured')).toBe('not-configured')
    expect(updateErrorCode(new Error('download-failed: signature invalide'))).toBe(
      'download-failed',
    )
    expect(updateErrorCode('message inattendu')).toBe('check-failed')
    for (const code of [
      'not-configured',
      'check-failed',
      'download-failed',
      'install-failed',
      'no-update',
      'not-downloaded',
      'busy',
    ]) {
      expect(UPDATE_ERROR_TEXTS[code]).toBeTruthy()
    }
  })
})
