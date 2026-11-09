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
