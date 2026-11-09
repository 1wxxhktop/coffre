import { DEFAULT_SETTINGS, type AppSettings } from './types'

const SETTINGS_KEY = 'coffre:settings:v1'
const AUTO_LOCK_VALUES = [0, 1, 5, 15, 30, 60]
const CLIPBOARD_VALUES = [0, 15, 30, 60, 120]
const TRASH_RETENTION_VALUES = [0, 7, 30, 90, 365]

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const autoLockMinutes = Number(parsed.autoLockMinutes)
    const clipboardClearSeconds = Number(parsed.clipboardClearSeconds)
    const trashRetentionDays = Number(parsed.trashRetentionDays)

    return {
      language:
        parsed.language === 'en' || parsed.language === 'fr'
          ? parsed.language
          : DEFAULT_SETTINGS.language,
      theme:
        parsed.theme === 'light' || parsed.theme === 'system' || parsed.theme === 'dark'
          ? parsed.theme
          : DEFAULT_SETTINGS.theme,
      autoLockMinutes: AUTO_LOCK_VALUES.includes(autoLockMinutes)
        ? autoLockMinutes
        : DEFAULT_SETTINGS.autoLockMinutes,
      clipboardClearSeconds: CLIPBOARD_VALUES.includes(clipboardClearSeconds)
        ? clipboardClearSeconds
        : DEFAULT_SETTINGS.clipboardClearSeconds,
      lockOnHide:
        typeof parsed.lockOnHide === 'boolean'
          ? parsed.lockOnHide
          : DEFAULT_SETTINGS.lockOnHide,
      lockOnFocusLoss:
        typeof parsed.lockOnFocusLoss === 'boolean'
          ? parsed.lockOnFocusLoss
          : DEFAULT_SETTINGS.lockOnFocusLoss,
      trashRetentionDays: TRASH_RETENTION_VALUES.includes(trashRetentionDays)
        ? trashRetentionDays
        : DEFAULT_SETTINGS.trashRetentionDays,
      keychainUnlock:
        typeof parsed.keychainUnlock === 'boolean'
          ? parsed.keychainUnlock
          : DEFAULT_SETTINGS.keychainUnlock,
      biometricUnlock:
        typeof parsed.biometricUnlock === 'boolean'
          ? parsed.biometricUnlock
          : DEFAULT_SETTINGS.biometricUnlock,
      expiryNotifications:
        typeof parsed.expiryNotifications === 'boolean'
          ? parsed.expiryNotifications
          : DEFAULT_SETTINGS.expiryNotifications,
      breachCheck:
        typeof parsed.breachCheck === 'boolean'
          ? parsed.breachCheck
          : DEFAULT_SETTINGS.breachCheck,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Le stockage des préférences peut être indisponible (mode privé).
  }
}

export function formatDate(iso: string, locale = 'fr-FR'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function formatDateTime(iso: string, locale = 'fr-FR'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** Libellé de mois pour les groupes de dates anciennes. */
export function formatMonthYear(iso: string, locale = 'fr-FR'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const label = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(date)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o'
  const units = ['o', 'Ko', 'Mio', 'Gio']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  const precision = exponent === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(precision).replace('.', ',')} ${units[exponent]}`
}

export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  downloadBlob(blob, filename)
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([new Uint8Array(bytes)], {
    type: mime || 'application/octet-stream',
  })
  downloadBlob(blob, filename)
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
