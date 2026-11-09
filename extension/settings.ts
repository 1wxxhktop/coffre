/**
 * Réglages persistants de l’extension.
 *
 * Ils vivent dans `storage.local` et ne contiennent aucun secret : uniquement
 * le mode de connexion, les préférences de remplissage et, plus tard, la liste
 * d’exclusions par site (E7), documentée dans `docs/SECURITY.md`.
 */

export type AppMode = 'auto' | 'desktop' | 'web'
export type ActivationMode = 'site' | 'all'

export interface ExtensionSettings {
  appUrl: string
  appMode: AppMode
  activationMode: ActivationMode
  inlineMenu: boolean
  saveBanner: boolean
  copyTotpAfterFill: boolean
  autofillOnLoad: boolean
  excludedSites: string[]
}

export interface LocalStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export const DEFAULT_APP_URL = 'http://localhost:1420'
export const APP_URL_KEY = 'appUrl'
export const APP_MODE_KEY = 'appMode'
export const ACTIVATION_MODE_KEY = 'activationMode'
export const INLINE_MENU_KEY = 'inlineMenu'
export const SAVE_BANNER_KEY = 'saveBanner'
export const COPY_TOTP_KEY = 'copyTotpAfterFill'
export const AUTOFILL_ON_LOAD_KEY = 'autofillOnLoad'
export const EXCLUDED_SITES_KEY = 'excludedSites'

const KEYS = [
  APP_URL_KEY,
  APP_MODE_KEY,
  ACTIVATION_MODE_KEY,
  INLINE_MENU_KEY,
  SAVE_BANNER_KEY,
  COPY_TOTP_KEY,
  AUTOFILL_ON_LOAD_KEY,
  EXCLUDED_SITES_KEY,
]

export const DEFAULT_SETTINGS: ExtensionSettings = {
  appUrl: DEFAULT_APP_URL,
  appMode: 'auto',
  activationMode: 'site',
  inlineMenu: true,
  saveBanner: true,
  copyTotpAfterFill: false,
  autofillOnLoad: false,
  excludedSites: [],
}

interface StorageGlobal {
  browser?: { storage?: { local?: LocalStorageArea } }
  chrome?: { storage?: { local?: LocalStorageArea } }
}

function localArea(): LocalStorageArea {
  const global = globalThis as unknown as StorageGlobal
  const storage = global.browser?.storage?.local ?? global.chrome?.storage?.local
  if (!storage) throw new Error('Stockage local indisponible')
  return storage
}

function isAppMode(value: unknown): value is AppMode {
  return value === 'auto' || value === 'desktop' || value === 'web'
}

function isActivationMode(value: unknown): value is ActivationMode {
  return value === 'site' || value === 'all'
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '')
}

export function normalizeAppUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

export function sanitizeSettings(
  values: Record<string, unknown>,
): ExtensionSettings {
  const rawUrl =
    typeof values[APP_URL_KEY] === 'string'
      ? normalizeAppUrl(values[APP_URL_KEY] as string)
      : null
  const excluded = Array.isArray(values[EXCLUDED_SITES_KEY])
    ? (values[EXCLUDED_SITES_KEY] as unknown[])
        .filter((entry): entry is string => typeof entry === 'string')
        .map(normalizeHost)
        .filter(Boolean)
        .slice(0, 500)
    : []
  return {
    appUrl: rawUrl ?? DEFAULT_APP_URL,
    appMode: isAppMode(values[APP_MODE_KEY])
      ? values[APP_MODE_KEY]
      : DEFAULT_SETTINGS.appMode,
    activationMode: isActivationMode(values[ACTIVATION_MODE_KEY])
      ? values[ACTIVATION_MODE_KEY]
      : DEFAULT_SETTINGS.activationMode,
    inlineMenu:
      typeof values[INLINE_MENU_KEY] === 'boolean'
        ? (values[INLINE_MENU_KEY] as boolean)
        : DEFAULT_SETTINGS.inlineMenu,
    saveBanner:
      typeof values[SAVE_BANNER_KEY] === 'boolean'
        ? (values[SAVE_BANNER_KEY] as boolean)
        : DEFAULT_SETTINGS.saveBanner,
    copyTotpAfterFill:
      typeof values[COPY_TOTP_KEY] === 'boolean'
        ? (values[COPY_TOTP_KEY] as boolean)
        : DEFAULT_SETTINGS.copyTotpAfterFill,
    autofillOnLoad:
      typeof values[AUTOFILL_ON_LOAD_KEY] === 'boolean'
        ? (values[AUTOFILL_ON_LOAD_KEY] as boolean)
        : DEFAULT_SETTINGS.autofillOnLoad,
    excludedSites: [...new Set(excluded)],
  }
}

export async function loadSettings(
  storage: LocalStorageArea = localArea(),
): Promise<ExtensionSettings> {
  try {
    const values = await storage.get(KEYS)
    return sanitizeSettings(values)
  } catch {
    return { ...DEFAULT_SETTINGS, excludedSites: [] }
  }
}

export async function saveSettings(
  patch: Partial<ExtensionSettings>,
  storage: LocalStorageArea = localArea(),
): Promise<void> {
  const values: Record<string, unknown> = {}
  if (patch.appUrl !== undefined) {
    const appUrl = normalizeAppUrl(patch.appUrl)
    if (appUrl) values[APP_URL_KEY] = appUrl
  }
  if (patch.appMode !== undefined) values[APP_MODE_KEY] = patch.appMode
  if (patch.activationMode !== undefined) {
    values[ACTIVATION_MODE_KEY] = patch.activationMode
  }
  if (patch.inlineMenu !== undefined) values[INLINE_MENU_KEY] = patch.inlineMenu
  if (patch.saveBanner !== undefined) values[SAVE_BANNER_KEY] = patch.saveBanner
  if (patch.copyTotpAfterFill !== undefined) {
    values[COPY_TOTP_KEY] = patch.copyTotpAfterFill
  }
  if (patch.autofillOnLoad !== undefined) {
    values[AUTOFILL_ON_LOAD_KEY] = patch.autofillOnLoad
  }
  if (patch.excludedSites !== undefined) {
    values[EXCLUDED_SITES_KEY] = sanitizeSettings({
      [EXCLUDED_SITES_KEY]: patch.excludedSites,
    }).excludedSites
  }
  await storage.set(values)
}

/** Le mode « web » ignore volontairement le pont natif. */
export function usesNativeBridge(mode: AppMode): boolean {
  return mode !== 'web'
}
