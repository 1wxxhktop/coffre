import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSettings } from './settings'

function stubSettings(value: unknown): void {
  vi.stubGlobal('localStorage', {
    getItem: () => JSON.stringify(value),
    setItem: () => undefined,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('préférences de sauvegarde', () => {
  it('reprend une configuration valide', () => {
    stubSettings({
      backupFrequency: 'weekly',
      backupFolder: '/Volumes/Sauvegardes',
      backupRetentionDaily: 10,
      backupRetentionWeekly: 5,
      backupRetentionMonthly: 24,
      backupLastRunAt: '2026-11-09T10:00:00.000Z',
      backupLastSuccessAt: '2026-11-09T10:00:00.000Z',
      backupLastError: 'missing-folder',
    })
    const settings = loadSettings()
    expect(settings.backupFrequency).toBe('weekly')
    expect(settings.backupFolder).toBe('/Volumes/Sauvegardes')
    expect(settings.backupRetentionDaily).toBe(10)
    expect(settings.backupRetentionWeekly).toBe(5)
    expect(settings.backupRetentionMonthly).toBe(24)
    expect(settings.backupLastSuccessAt).toBe('2026-11-09T10:00:00.000Z')
    expect(settings.backupLastError).toBe('missing-folder')
  })

  it('borne les valeurs incohérentes et refuse les erreurs non stables', () => {
    stubSettings({
      backupFrequency: 'hourly',
      backupFolder: 42,
      backupRetentionDaily: 999,
      backupRetentionWeekly: 0,
      backupRetentionMonthly: -3,
      backupLastRunAt: 'pas une date',
      backupLastSuccessAt: '',
      backupLastError: '/Users/alice/Disque secret/erreur',
    })
    const settings = loadSettings()
    expect(settings.backupFrequency).toBe('off')
    expect(settings.backupFolder).toBe('')
    expect(settings.backupRetentionDaily).toBe(7)
    expect(settings.backupRetentionWeekly).toBe(4)
    expect(settings.backupRetentionMonthly).toBe(12)
    expect(settings.backupLastRunAt).toBeNull()
    expect(settings.backupLastSuccessAt).toBeNull()
    expect(settings.backupLastError).toBeNull()
  })
})

describe('préférences de mise à jour', () => {
  it('désactive la recherche par défaut, comme toute fonction réseau', () => {
    stubSettings({})
    const settings = loadSettings()
    expect(settings.updateCheck).toBe('off')
    expect(settings.updateChannel).toBe('stable')
    expect(settings.updateAutoDownload).toBe(false)
    expect(settings.updateInstallMode).toBe('ask')
    expect(settings.updateSkippedVersion).toBeNull()
    expect(settings.updateLastCheckAt).toBeNull()
  })

  it('reprend une configuration valide', () => {
    stubSettings({
      updateCheck: 'weekly',
      updateChannel: 'beta',
      updateAutoDownload: true,
      updateInstallMode: 'on-quit',
      updateSkippedVersion: '1.2.0-beta.1',
      updateLastCheckAt: '2026-11-09T10:00:00.000Z',
    })
    const settings = loadSettings()
    expect(settings.updateCheck).toBe('weekly')
    expect(settings.updateChannel).toBe('beta')
    expect(settings.updateAutoDownload).toBe(true)
    expect(settings.updateInstallMode).toBe('on-quit')
    expect(settings.updateSkippedVersion).toBe('1.2.0-beta.1')
    expect(settings.updateLastCheckAt).toBe('2026-11-09T10:00:00.000Z')
  })

  it('refuse les valeurs inconnues', () => {
    stubSettings({
      updateCheck: 'hourly',
      updateChannel: 'nightly',
      updateAutoDownload: 'oui',
      updateInstallMode: 'now',
      updateSkippedVersion: '<script>',
      updateLastCheckAt: 'hier',
    })
    const settings = loadSettings()
    expect(settings.updateCheck).toBe('off')
    expect(settings.updateChannel).toBe('stable')
    expect(settings.updateAutoDownload).toBe(false)
    expect(settings.updateInstallMode).toBe('ask')
    expect(settings.updateSkippedVersion).toBeNull()
    expect(settings.updateLastCheckAt).toBeNull()
  })
})
