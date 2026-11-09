/**
 * Préférence de thème de l’extension.
 *
 * Le choix est stocké localement (`system`, `light` ou `dark`) et appliqué via
 * `data-theme` sur `documentElement`. Le CSS conserve un thème sombre par
 * défaut, puis surcharge les jetons en clair selon la préférence ou le système.
 */

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

export type ThemePreference = 'system' | 'light' | 'dark'

const THEME_KEY = 'theme'

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement
  if (preference === 'system') delete root.dataset.theme
  else root.dataset.theme = preference
}

export async function loadTheme(): Promise<ThemePreference> {
  let preference: ThemePreference = 'system'
  try {
    const stored = await api.storage.local.get(THEME_KEY)
    if (isPreference(stored[THEME_KEY])) preference = stored[THEME_KEY]
  } catch {
    // Stockage indisponible : suivre le système.
  }
  applyTheme(preference)
  return preference
}

export async function saveTheme(preference: ThemePreference): Promise<void> {
  applyTheme(preference)
  try {
    await api.storage.local.set({ [THEME_KEY]: preference })
  } catch {
    // La préférence reste appliquée pour la session en cours.
  }
}

export function nextTheme(preference: ThemePreference): ThemePreference {
  if (preference === 'system') return 'light'
  if (preference === 'light') return 'dark'
  return 'system'
}
