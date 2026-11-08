/**
 * Localisation de l’extension via l’API i18n du navigateur.
 *
 * Les fichiers HTML portent des attributs `data-i18n*` ; le service worker et
 * les scripts utilisent `t()`. La langue suit celle du navigateur, pas le
 * réglage de l’application.
 */

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

export function t(key: string, substitutions?: string | string[]): string {
  try {
    return api.i18n.getMessage(key, substitutions) || key
  } catch {
    return key
  }
}

export function localizeDocument(): void {
  const language = api.i18n.getUILanguage?.() ?? 'fr'
  document.documentElement.lang = language.toLowerCase().startsWith('fr') ? 'fr' : 'en'

  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n
    if (key) element.textContent = t(key)
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    const key = element.dataset.i18nPlaceholder
    if (key) element.setAttribute('placeholder', t(key))
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    const key = element.dataset.i18nAriaLabel
    if (key) element.setAttribute('aria-label', t(key))
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = element.dataset.i18nTitle
    if (key) element.setAttribute('title', t(key))
  }

  const pageTitle = document.documentElement.dataset.pageTitle
  if (pageTitle) document.title = t(pageTitle)
}
