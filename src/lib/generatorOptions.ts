/**
 * Préférences du générateur, conservées localement.
 *
 * Les options ne contiennent aucun secret : uniquement la longueur, les
 * classes de caractères et les réglages de phrase de passe. Aucune donnée
 * n’est incluse dans le coffre ni dans un export.
 */

import {
  DEFAULT_PASSPHRASE_OPTIONS,
  type PassphraseOptions,
} from './generator'
import { DEFAULT_PASSWORD_OPTIONS, type PasswordOptions } from './password'

const STORAGE_KEY = 'coffre:generator-options:v1'

export type GeneratorMode = 'password' | 'passphrase'

export interface GeneratorPreferences {
  mode: GeneratorMode
  password: PasswordOptions
  passphrase: PassphraseOptions
}

const SEPARATORS = new Set(['-', '.', '_', ' '])

export const DEFAULT_GENERATOR_PREFERENCES: GeneratorPreferences = {
  mode: 'password',
  password: { ...DEFAULT_PASSWORD_OPTIONS },
  passphrase: { ...DEFAULT_PASSPHRASE_OPTIONS },
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Valide les options de mot de passe et garantit au moins une classe active. */
export function sanitizePasswordOptions(value: unknown): PasswordOptions {
  const source =
    value && typeof value === 'object' ? (value as Partial<PasswordOptions>) : {}
  const options: PasswordOptions = {
    length: boundedInteger(
      source.length,
      DEFAULT_PASSWORD_OPTIONS.length,
      8,
      64,
    ),
    lowercase: source.lowercase !== false,
    uppercase: source.uppercase !== false,
    digits: source.digits !== false,
    symbols: source.symbols !== false,
    excludeAmbiguous: source.excludeAmbiguous !== false,
  }
  if (
    !options.lowercase &&
    !options.uppercase &&
    !options.digits &&
    !options.symbols
  ) {
    options.lowercase = true
  }
  return options
}

/** Valide les options de phrase de passe et borne le nombre de mots. */
export function sanitizePassphraseOptions(value: unknown): PassphraseOptions {
  const source =
    value && typeof value === 'object' ? (value as Partial<PassphraseOptions>) : {}
  return {
    words: boundedInteger(
      source.words,
      DEFAULT_PASSPHRASE_OPTIONS.words,
      3,
      10,
    ),
    separator:
      typeof source.separator === 'string' && SEPARATORS.has(source.separator)
        ? source.separator
        : DEFAULT_PASSPHRASE_OPTIONS.separator,
    capitalize: source.capitalize !== false,
    includeNumber: source.includeNumber !== false,
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Relit les préférences, en retombant sur les valeurs par défaut si besoin. */
export function loadGeneratorPreferences(): GeneratorPreferences {
  const store = storage()
  if (!store) return { ...DEFAULT_GENERATOR_PREFERENCES }
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_GENERATOR_PREFERENCES }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_GENERATOR_PREFERENCES }
    }
    const source = parsed as Record<string, unknown>
    return {
      mode: source.mode === 'passphrase' ? 'passphrase' : 'password',
      password: sanitizePasswordOptions(source.password),
      passphrase: sanitizePassphraseOptions(source.passphrase),
    }
  } catch {
    return { ...DEFAULT_GENERATOR_PREFERENCES }
  }
}

/** Enregistre les préférences sans jamais faire échouer le générateur. */
export function saveGeneratorPreferences(preferences: GeneratorPreferences): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: preferences.mode,
        password: preferences.password,
        passphrase: preferences.passphrase,
      }),
    )
  } catch {
    // Stockage indisponible ou quota atteint : les options restent en mémoire.
  }
}
