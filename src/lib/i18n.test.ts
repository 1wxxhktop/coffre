import { describe, expect, it } from 'vitest'
import { intlLocale, pluralKey, translate } from './i18n'

describe('catalogues i18n', () => {
  it('traduit les clés et interpolle les paramètres', () => {
    expect(translate('fr', 'auth.createTitle')).toBe('Créer votre coffre')
    expect(translate('en', 'auth.createTitle')).toBe('Create your vault')
    expect(translate('fr', 'auth.modifiedAt', { date: '8 nov. 2026' })).toBe(
      'modifié le 8 nov. 2026',
    )
    expect(translate('en', 'auth.modifiedAt', { date: 'Nov 8, 2026' })).toBe(
      'modified Nov 8, 2026',
    )
  })

  it('choisit la clé de pluriel et la locale Intl', () => {
    expect(pluralKey(1, 'auth.itemCount.one', 'auth.itemCount.other')).toBe(
      'auth.itemCount.one',
    )
    expect(pluralKey(2, 'auth.itemCount.one', 'auth.itemCount.other')).toBe(
      'auth.itemCount.other',
    )
    expect(intlLocale('fr')).toBe('fr-FR')
    expect(intlLocale('en')).toBe('en-US')
  })

  it('conserve les paramètres absents pour les rendre visibles', () => {
    expect(translate('fr', 'auth.modifiedAt')).toBe('modifié le {date}')
  })
})
