/**
 * Sauvegardes planifiées.
 *
 * La logique de dates et de rétention est pure et testable. Les accès disque
 * sont délégués à des commandes Tauri qui ne reçoivent jamais le contenu du
 * coffre : elles copient le fichier `.coffre` déjà chiffré, de façon atomique.
 */

import { invoke } from '@tauri-apps/api/core'
import { isBackupErrorCode } from './backupErrors'
import { isTauriRuntime } from './external'
import type { AppSettings } from './types'

export type BackupFrequency = AppSettings['backupFrequency']
export type BackupCategory = 'daily' | 'weekly' | 'monthly'
export type BackupPlatform = 'desktop' | 'web'

export interface BackupRetention {
  daily: number
  weekly: number
  monthly: number
}

export interface BackupFileInfo {
  name: string
  category: BackupCategory
  /** Clé de tri lexicographique, la plus récente en premier. */
  sortKey: string
  size: number
  modifiedAt: number
}

export interface BackupStatus {
  exists: boolean
  isDirectory: boolean
}

export interface BackupCopyResult {
  written: string[]
  sha256: string
  sourceSize: number
}

export type BackupAlertCode =
  | 'travel'
  | 'missing-folder'
  | 'no-folder'
  | 'error'
  | 'never'
  | 'stale'
  | 'export-due'

export interface BackupAlert {
  code: BackupAlertCode
  level: 'warning' | 'danger'
}

/** Textes source des alertes, à passer dans `tt()` par l’interface. */
export const BACKUP_ALERT_TEXTS: Record<BackupAlertCode, string> = {
  travel: 'Sauvegardes suspendues par le mode voyage.',
  'missing-folder': 'Le dossier de sauvegarde est introuvable (disque débranché ?).',
  'no-folder': 'Choisissez un dossier de sauvegarde.',
  error: 'La dernière sauvegarde a échoué.',
  never: 'Aucune sauvegarde planifiée n’a encore réussi.',
  stale: 'La dernière sauvegarde date de plus de deux périodes.',
  'export-due': 'Pensez à exporter une sauvegarde manuelle.',
}

const DAY_MS = 24 * 60 * 60 * 1000

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function datePart(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function timePart(date: Date): string {
  return `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

/** Semaine ISO 8601, par exemple `2026-W45`. */
export function isoWeek(date: Date): string {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7)
  return `${target.getUTCFullYear()}-W${pad(week)}`
}

export function backupFileName(category: BackupCategory, date: Date): string {
  if (category === 'daily') {
    return `coffre-daily-${datePart(date)}T${timePart(date)}.coffre`
  }
  if (category === 'weekly') {
    return `coffre-weekly-${isoWeek(date)}.coffre`
  }
  return `coffre-monthly-${datePart(date).slice(0, 7)}.coffre`
}

const BACKUP_PATTERN =
  /^coffre-(daily|weekly|monthly)-(\d{4}-\d{2}-\d{2}(?:T\d{2}-\d{2}-\d{2})?|\d{4}-W\d{2}|\d{4}-\d{2})\.coffre$/

function validDateToken(category: BackupCategory, token: string): boolean {
  if (category === 'monthly') {
    const match = /^(\d{4})-(\d{2})$/.exec(token)
    if (!match) return false
    const month = Number(match[2])
    return month >= 1 && month <= 12
  }
  if (category === 'weekly') {
    const match = /^(\d{4})-W(\d{2})$/.exec(token)
    if (!match) return false
    const week = Number(match[2])
    return week >= 1 && week <= 53
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})-(\d{2})-(\d{2}))?$/.exec(token)
  if (!match) return false
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
  )
  return (
    date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day) &&
    date.getHours() === Number(hour ?? 0) &&
    date.getMinutes() === Number(minute ?? 0) &&
    date.getSeconds() === Number(second ?? 0)
  )
}

export function parseBackupFileName(
  name: string,
): { category: BackupCategory; sortKey: string } | null {
  const match = BACKUP_PATTERN.exec(name)
  if (!match) return null
  const category = match[1] as BackupCategory
  if (!validDateToken(category, match[2])) return null
  return {
    category,
    sortKey: name,
  }
}

export function backupRetention(settings: AppSettings): BackupRetention {
  return {
    daily: settings.backupRetentionDaily,
    weekly: settings.backupRetentionWeekly,
    monthly: settings.backupRetentionMonthly,
  }
}

/**
 * Vrai si une sauvegarde planifiée est due. Le calcul reste local et ne
 * dépend que de la dernière réussite et de la fréquence.
 */
export function isBackupDue(settings: AppSettings, now = new Date()): boolean {
  if (settings.backupFrequency === 'off') return false
  if (!settings.backupLastSuccessAt) return true
  const last = new Date(settings.backupLastSuccessAt)
  if (!Number.isFinite(last.getTime()) || last.getTime() > now.getTime()) {
    return false
  }
  if (settings.backupFrequency === 'daily') {
    return datePart(last) !== datePart(now)
  }
  return isoWeek(last) !== isoWeek(now)
}

/**
 * Catégories à écrire lors d’une exécution : la catégorie principale de la
 * fréquence, plus une mensuelle si le mois courant n’en a pas encore.
 */
export function backupCategoriesForRun(
  settings: AppSettings,
  now: Date,
  existing: BackupFileInfo[],
  force = false,
): BackupCategory[] {
  if (settings.backupFrequency === 'off' && !force) return []
  const primary: BackupCategory =
    settings.backupFrequency === 'weekly' ? 'weekly' : 'daily'
  const monthlyName = backupFileName('monthly', now)
  const categories: BackupCategory[] = [primary]
  if (!existing.some((file) => file.name === monthlyName)) {
    categories.push('monthly')
  }
  return categories
}

/**
 * Noms à supprimer pour respecter la rétention : on garde les N plus récents
 * de chaque catégorie, triés par nom (les noms sont datés).
 */
export function selectBackupsToDelete(
  files: BackupFileInfo[],
  retention: BackupRetention,
): string[] {
  const keep: Record<BackupCategory, number> = {
    daily: retention.daily,
    weekly: retention.weekly,
    monthly: retention.monthly,
  }
  const groups = new Map<BackupCategory, BackupFileInfo[]>()
  for (const file of files) {
    const list = groups.get(file.category) ?? []
    list.push(file)
    groups.set(file.category, list)
  }
  const deleted: string[] = []
  for (const [category, list] of groups) {
    list
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
      .slice(Math.max(0, keep[category]))
      .forEach((file) => deleted.push(file.name))
  }
  return deleted.sort()
}

function periodMs(frequency: Exclude<BackupFrequency, 'off'>): number {
  return frequency === 'daily' ? DAY_MS : 7 * DAY_MS
}

/** Alerte à afficher au tableau de bord, ou `null` si tout va bien. */
export function backupAlert(
  settings: AppSettings,
  platform: BackupPlatform,
  options: { folderMissing?: boolean; travel?: boolean } = {},
  now = new Date(),
): BackupAlert | null {
  if (settings.backupFrequency === 'off') return null
  if (options.travel || settings.backupLastError === 'travel') {
    return { code: 'travel', level: 'warning' }
  }
  if (
    options.folderMissing ||
    settings.backupLastError === 'missing-folder'
  ) {
    return { code: 'missing-folder', level: 'danger' }
  }
  if (platform === 'desktop' && !settings.backupFolder) {
    return { code: 'no-folder', level: 'warning' }
  }
  if (settings.backupLastError) return { code: 'error', level: 'danger' }
  if (!settings.backupLastSuccessAt) return { code: 'never', level: 'warning' }
  const last = new Date(settings.backupLastSuccessAt)
  if (!Number.isFinite(last.getTime())) return { code: 'never', level: 'warning' }
  // Sur le Web, le rappel d’export suit la fréquence choisie. Sur desktop,
  // l’alerte attend deux périodes pour ne pas signaler un simple retard.
  const dueAfter =
    periodMs(settings.backupFrequency) * (platform === 'web' ? 1 : 2)
  if (now.getTime() - last.getTime() > dueAfter) {
    return {
      code: platform === 'web' ? 'export-due' : 'stale',
      level: 'warning',
    }
  }
  return null
}

export class BackupError extends Error {
  readonly code: string

  constructor(code: string, message = code) {
    super(message)
    this.name = 'BackupError'
    this.code = code
  }
}

function stableErrorCode(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'backup-failed'
  const code = raw.slice(0, 80)
  return isBackupErrorCode(code) ? code : 'backup-failed'
}

async function nativeInvoke<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime()) throw new BackupError('desktop-only')
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw new BackupError(stableErrorCode(error))
  }
}

function toFileInfo(name: string, size: number, modifiedAt: number): BackupFileInfo | null {
  const parsed = parseBackupFileName(name)
  if (!parsed) return null
  return {
    name,
    category: parsed.category,
    sortKey: parsed.sortKey,
    size,
    modifiedAt,
  }
}

export async function backupStatus(folder: string): Promise<BackupStatus> {
  return nativeInvoke<BackupStatus>('backup_status', { dir: folder })
}

export async function backupList(folder: string): Promise<BackupFileInfo[]> {
  const raw = await nativeInvoke<Array<{ name: string; size: number; modifiedAt: number }>>(
    'backup_list',
    { dir: folder },
  )
  return raw
    .map((entry) => toFileInfo(entry.name, entry.size, entry.modifiedAt))
    .filter((entry): entry is BackupFileInfo => entry !== null)
    .sort((first, second) => second.modifiedAt - first.modifiedAt)
}

export async function backupDelete(folder: string, names: string[]): Promise<number> {
  return nativeInvoke<number>('backup_delete', { dir: folder, names })
}

export async function backupCopyCurrent(
  folder: string,
  names: string[],
): Promise<BackupCopyResult> {
  return nativeInvoke<BackupCopyResult>('backup_copy_current', {
    dir: folder,
    names,
  })
}

export async function backupRead(folder: string, name: string): Promise<string> {
  return nativeInvoke<string>('backup_read', { dir: folder, name })
}

export async function backupCurrentFileId(): Promise<string | null> {
  return nativeInvoke<string | null>('backup_current_file_id', {})
}

export interface RunBackupOptions {
  force?: boolean
  /**
   * Contrôle exécuté sur le premier fichier écrit, avant la rétention. Il
   * permet de vérifier le MAC sans supprimer d’anciennes copies si la nouvelle
   * s’avère illisible.
   */
  verify?: (name: string) => Promise<void>
}

/** Exécute une sauvegarde planifiée (ou forcée) et applique la rétention. */
export async function runScheduledBackup(
  settings: AppSettings,
  now = new Date(),
  options: RunBackupOptions = {},
): Promise<{ written: string[]; removed: string[] }> {
  if (settings.backupFrequency === 'off' && !options.force) {
    return { written: [], removed: [] }
  }
  if (!settings.backupFolder) throw new BackupError('no-folder')
  const status = await backupStatus(settings.backupFolder)
  if (!status.exists || !status.isDirectory) {
    throw new BackupError('missing-folder')
  }
  const before = await backupList(settings.backupFolder)
  const categories = backupCategoriesForRun(
    settings,
    now,
    before,
    options.force === true,
  )
  const names = categories.map((category) => backupFileName(category, now))
  await backupCopyCurrent(settings.backupFolder, names)
  if (options.verify && names.length > 0) {
    await options.verify(names[0])
  }
  const after = await backupList(settings.backupFolder)
  const removed = selectBackupsToDelete(after, backupRetention(settings))
  if (removed.length > 0) {
    await backupDelete(settings.backupFolder, removed)
  }
  return { written: names, removed }
}
