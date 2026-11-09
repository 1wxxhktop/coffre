import { describe, expect, it } from 'vitest'
import {
  BackupError,
  backupAlert,
  backupCategoriesForRun,
  backupFileName,
  backupRetention,
  backupStatus,
  isBackupDue,
  isoWeek,
  parseBackupFileName,
  runScheduledBackup,
  selectBackupsToDelete,
  type BackupFileInfo,
} from './backup'
import { DEFAULT_SETTINGS, type AppSettings } from './types'

const NOW = new Date(2026, 10, 9, 10, 0, 0) // 9 novembre 2026, heure locale.
const STAMP = NOW.toISOString()

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

function info(name: string, category: 'daily' | 'weekly' | 'monthly'): BackupFileInfo {
  return {
    name,
    category,
    sortKey: name,
    size: 1024,
    modifiedAt: NOW.getTime(),
  }
}

function filesForDays(days: number): BackupFileInfo[] {
  const files: BackupFileInfo[] = []
  for (let index = 0; index < days; index += 1) {
    const date = new Date(2026, 9, 1 + index, 10, 0, 0)
    files.push(info(backupFileName('daily', date), 'daily'))
    if (date.getDay() === 1) {
      const weekly = backupFileName('weekly', date)
      if (!files.some((file) => file.name === weekly)) {
        files.push(info(weekly, 'weekly'))
      }
    }
    if (date.getDate() === 1) {
      const monthly = backupFileName('monthly', date)
      if (!files.some((file) => file.name === monthly)) {
        files.push(info(monthly, 'monthly'))
      }
    }
  }
  return files
}

function countByCategory(files: BackupFileInfo[]) {
  return {
    daily: files.filter((file) => file.category === 'daily').length,
    weekly: files.filter((file) => file.category === 'weekly').length,
    monthly: files.filter((file) => file.category === 'monthly').length,
  }
}

function applyRetention(files: BackupFileInfo[], config: AppSettings): BackupFileInfo[] {
  const deleted = new Set(selectBackupsToDelete(files, backupRetention(config)))
  return files.filter((file) => !deleted.has(file.name))
}

describe('noms de sauvegarde', () => {
  it('date les fichiers quotidiens, hebdomadaires et mensuels', () => {
    expect(backupFileName('daily', NOW)).toBe('coffre-daily-2026-11-09T10-00-00.coffre')
    expect(backupFileName('weekly', NOW)).toBe('coffre-weekly-2026-W46.coffre')
    expect(backupFileName('monthly', NOW)).toBe('coffre-monthly-2026-11.coffre')
  })

  it('calcule la semaine ISO 8601 au changement d’année', () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe('2026-W01')
    expect(isoWeek(new Date(2027, 0, 1))).toBe('2026-W53')
    expect(isoWeek(new Date(2026, 10, 9))).toBe('2026-W46')
  })

  it('relit les noms et refuse les noms étrangers', () => {
    expect(parseBackupFileName('coffre-daily-2026-11-09T10-00-00.coffre')).toEqual({
      category: 'daily',
      sortKey: 'coffre-daily-2026-11-09T10-00-00.coffre',
    })
    expect(parseBackupFileName('coffre-weekly-2026-W46.coffre')?.category).toBe('weekly')
    expect(parseBackupFileName('coffre-monthly-2026-11.coffre')?.category).toBe('monthly')
    for (const name of [
      'vault.coffre',
      'coffre-daily-2026-11-09.txt',
      '../coffre-daily-2026-11-09.coffre',
      'coffre-other-2026-11-09.coffre',
      'coffre-daily-2026-13-99.coffre',
    ]) {
      expect(parseBackupFileName(name), name).toBeNull()
    }
  })
})

describe('échéance des sauvegardes', () => {
  it('ne déclenche rien quand la fréquence est désactivée', () => {
    expect(isBackupDue(settings(), NOW)).toBe(false)
    expect(
      backupCategoriesForRun(settings(), NOW, []),
    ).toEqual([])
  })

  it('considère une première sauvegarde comme due', () => {
    expect(isBackupDue(settings({ backupFrequency: 'daily' }), NOW)).toBe(true)
    expect(isBackupDue(settings({ backupFrequency: 'weekly' }), NOW)).toBe(true)
  })

  it('attend le jour ou la semaine suivante', () => {
    const sameDay = new Date(2026, 10, 9, 8, 0, 0).toISOString()
    const yesterday = new Date(2026, 10, 8, 23, 0, 0).toISOString()
    expect(
      isBackupDue(
        settings({ backupFrequency: 'daily', backupLastSuccessAt: sameDay }),
        NOW,
      ),
    ).toBe(false)
    expect(
      isBackupDue(
        settings({ backupFrequency: 'daily', backupLastSuccessAt: yesterday }),
        NOW,
      ),
    ).toBe(true)
    expect(
      isBackupDue(
        settings({
          backupFrequency: 'weekly',
          backupLastSuccessAt: new Date(2026, 10, 9, 8, 0, 0).toISOString(),
        }),
        NOW,
      ),
    ).toBe(false)
    expect(
      isBackupDue(
        settings({
          backupFrequency: 'weekly',
          backupLastSuccessAt: new Date(2026, 9, 26).toISOString(),
        }),
        NOW,
      ),
    ).toBe(true)
  })

  it('ajoute une mensuelle si le mois n’en a pas encore', () => {
    const config = settings({ backupFrequency: 'weekly' })
    expect(backupCategoriesForRun(config, NOW, [])).toEqual(['weekly', 'monthly'])
    expect(
      backupCategoriesForRun(config, NOW, [
        info('coffre-monthly-2026-11.coffre', 'monthly'),
      ]),
    ).toEqual(['weekly'])
  })

  it('permet une sauvegarde manuelle même si la fréquence est désactivée', () => {
    expect(backupCategoriesForRun(settings(), NOW, [])).toEqual([])
    expect(backupCategoriesForRun(settings(), NOW, [], true)).toEqual([
      'daily',
      'monthly',
    ])
  })
})

describe('rétention', () => {
  it('conserve exactement les nombres configurés après 40 jours', () => {
    const config = settings()
    const files = filesForDays(40)
    expect(countByCategory(files).daily).toBe(40)
    // 40 jours couvrent 6 semaines (4 conservées) et 2 mois.
    expect(countByCategory(files).weekly).toBe(6)
    expect(countByCategory(files).monthly).toBe(2)
    const kept = countByCategory(applyRetention(files, config))
    expect(kept).toEqual({ daily: 7, weekly: 4, monthly: 2 })
  })

  it('garde les plus récents et supprime les plus anciens', () => {
    const files = filesForDays(40)
    const deleted = new Set(selectBackupsToDelete(files, backupRetention(settings())))
    expect(deleted.has('coffre-daily-2026-10-01T10-00-00.coffre')).toBe(true)
    expect(deleted.has('coffre-daily-2026-11-09T10-00-00.coffre')).toBe(false)
    expect(
      deleted.has('coffre-weekly-2026-W41.coffre'),
    ).toBe(true)
    expect(deleted.has('coffre-weekly-2026-W46.coffre')).toBe(false)
  })

  it('conserve 7 quotidiennes même après 400 jours', () => {
    const config = settings()
    const files = filesForDays(400)
    expect(countByCategory(files).daily).toBe(400)
    expect(countByCategory(applyRetention(files, config)).daily).toBe(7)
  })
})

describe('alerte du tableau de bord', () => {
  it('reste silencieuse quand les sauvegardes sont désactivées', () => {
    expect(backupAlert(settings(), 'desktop', {}, NOW)).toBeNull()
  })

  it('signale les cas d’attention', () => {
    const daily = settings({ backupFrequency: 'daily', backupFolder: '/tmp/backups' })
    expect(backupAlert(daily, 'desktop', { travel: true }, NOW)?.code).toBe('travel')
    expect(
      backupAlert(daily, 'desktop', { folderMissing: true }, NOW)?.code,
    ).toBe('missing-folder')
    expect(
      backupAlert(
        settings({ backupFrequency: 'daily', backupLastError: 'missing-folder' }),
        'desktop',
        {},
        NOW,
      )?.code,
    ).toBe('missing-folder')
    expect(backupAlert(settings({ backupFrequency: 'daily' }), 'desktop', {}, NOW)?.code).toBe(
      'no-folder',
    )
    expect(
      backupAlert(
        settings({
          backupFrequency: 'daily',
          backupFolder: '/tmp/backups',
          backupLastError: 'backup-failed',
        }),
        'desktop',
        {},
        NOW,
      )?.code,
    ).toBe('error')
    expect(backupAlert(daily, 'desktop', {}, NOW)?.code).toBe('never')
  })

  it('signale une sauvegarde trop ancienne selon la plateforme', () => {
    const old = new Date(2026, 9, 1).toISOString()
    const stale = settings({
      backupFrequency: 'weekly',
      backupFolder: '/tmp/backups',
      backupLastSuccessAt: old,
    })
    expect(backupAlert(stale, 'desktop', {}, NOW)?.code).toBe('stale')
    expect(backupAlert(stale, 'web', {}, NOW)?.code).toBe('export-due')
    expect(
      backupAlert(
        settings({
          backupFrequency: 'daily',
          backupFolder: '/tmp/backups',
          backupLastSuccessAt: STAMP,
        }),
        'desktop',
        {},
        NOW,
      ),
    ).toBeNull()
  })

  it('rappelle l’export web dès une période, mais attend deux périodes sur desktop', () => {
    const eightDays = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const config = settings({
      backupFrequency: 'weekly',
      backupFolder: '/tmp/backups',
      backupLastSuccessAt: eightDays,
    })
    expect(backupAlert(config, 'web', {}, NOW)?.code).toBe('export-due')
    expect(backupAlert(config, 'desktop', {}, NOW)).toBeNull()
  })
})

describe('exécution sur le Web', () => {
  it('refuse le dossier absent avant tout accès natif', async () => {
    await expect(
      runScheduledBackup(settings({ backupFrequency: 'daily' }), NOW),
    ).rejects.toMatchObject({ code: 'no-folder' })
  })

  it('reste réservée au bureau', async () => {
    const config = settings({
      backupFrequency: 'daily',
      backupFolder: '/tmp/backups',
    })
    await expect(backupStatus('/tmp/backups')).rejects.toBeInstanceOf(BackupError)
    await expect(runScheduledBackup(config, NOW)).rejects.toMatchObject({
      code: 'desktop-only',
    })
  })
})
