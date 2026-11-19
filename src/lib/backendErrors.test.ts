import { describe, expect, it } from 'vitest'
import { translateBackendError } from './backendErrors'

describe('traduction des erreurs natives', () => {
  it('laisse le français intact', () => {
    expect(
      translateBackendError('fr', 'Coffre trop volumineux'),
    ).toBe('Coffre trop volumineux')
  })

  it('traduit les messages connus en anglais', () => {
    expect(translateBackendError('en', 'Coffre trop volumineux')).toBe(
      'Vault too large',
    )
    expect(
      translateBackendError('en', 'La biométrie n’est pas disponible sur cette plateforme.'),
    ).toBe('Biometrics are not available on this platform.')
  })

  it('traduit les préfixes dynamiques en conservant le détail', () => {
    expect(
      translateBackendError('en', 'Saisie impossible : permission refusée'),
    ).toBe('Typing failed: permission refusée')
    expect(
      translateBackendError('en', 'Jeton de saisie inconnu : {password}'),
    ).toBe('Unknown input token: {password}')
  })

  it('traduit le message macOS de saisie automatique', () => {
    expect(
      translateBackendError(
        'en',
        'Saisie automatique indisponible : autorisez Coffre dans Accessibilité (macOS) ou vérifiez les permissions du système. refus',
      ),
    ).toBe(
      'Auto-type unavailable: allow Coffre in Accessibility (macOS) or check the system permissions. refus',
    )
  })

  it('laisse les détails inconnus et les codes techniques intacts', () => {
    expect(translateBackendError('en', 'Erreur inattendue')).toBe(
      'Erreur inattendue',
    )
    expect(translateBackendError('en', 'invalid-channel')).toBe(
      'invalid-channel',
    )
    expect(translateBackendError('en', 'HIBP HTTP 503')).toBe(
      'HIBP HTTP 503',
    )
  })
})
