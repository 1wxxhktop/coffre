/**
 * Réglages persistants de l’extension.
 *
 * Ils vivent dans `storage.local` et ne contiennent aucun secret : uniquement
 * le mode de connexion, les préférences de remplissage et les exclusions par
 * site (domaines uniquement), documentées dans `docs/SECURITY.md`.
 */

import { normalizeExclusions } from './siteExclusions'

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
  /** Soumettre le formulaire de connexion après remplissage (désactivé par défaut). */
  autoSubmitLogin: boolean
  neverFillSites: string[]
  neverSaveSites: string[]
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
export const AUTO_SUBMIT_KEY = 'autoSubmitLogin'
export const NEVER_FILL_SITES_KEY = 'neverFillSites'
export const NEVER_SAVE_SITES_KEY = 'neverSaveSites'

const KEYS = [
  APP_URL_KEY,
  APP_MODE_KEY,
  ACTIVATION_MODE_KEY,
  INLINE_MENU_KEY,
  SAVE_BANNER_KEY,
  COPY_TOTP_KEY,
  AUTOFILL_ON_LOAD_KEY,
  AUTO_SUBMIT_KEY,
  NEVER_FILL_SITES_KEY,
  NEVER_SAVE_SITES_KEY,
]

export const DEFAULT_SETTINGS: ExtensionSettings = {
  appUrl: DEFAULT_APP_URL,
  appMode: 'auto',
  activationMode: 'site',
  inlineMenu: true,
  saveBanner: true,
  copyTotpAfterFill: false,
  autofillOnLoad: false,
  autoSubmitLogin: false,
  neverFillSites: [],
  neverSaveSites: [],
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
    autoSubmitLogin:
      typeof values[AUTO_SUBMIT_KEY] === 'boolean'
        ? (values[AUTO_SUBMIT_KEY] as boolean)
        : DEFAULT_SETTINGS.autoSubmitLogin,
    neverFillSites: normalizeExclusions(values[NEVER_FILL_SITES_KEY]),
    neverSaveSites: normalizeExclusions(values[NEVER_SAVE_SITES_KEY]),
  }
}

export async function loadSettings(
  storage: LocalStorageArea = localArea(),
): Promise<ExtensionSettings> {
  try {
    const values = await storage.get(KEYS)
    return sanitizeSettings(values)
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      neverFillSites: [],
      neverSaveSites: [],
    }
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
  if (patch.autoSubmitLogin !== undefined) {
    values[AUTO_SUBMIT_KEY] = patch.autoSubmitLogin
  }
  if (patch.neverFillSites !== undefined) {
    values[NEVER_FILL_SITES_KEY] = normalizeExclusions(patch.neverFillSites)
  }
  if (patch.neverSaveSites !== undefined) {
    values[NEVER_SAVE_SITES_KEY] = normalizeExclusions(patch.neverSaveSites)
  }
  await storage.set(values)
}

/** Le mode « web » ignore volontairement le pont natif. */
export function usesNativeBridge(mode: AppMode): boolean {
  return mode !== 'web'
}
