import { describe, expect, it } from 'vitest'
import { changePasswordUrl, safeExternalUrl } from './url'

describe('adresses externes', () => {
  it('accepte http et https', () => {
    expect(safeExternalUrl('https://github.com/login')).toBe('https://github.com/login')
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com/')
  })

  it('ajoute https à un domaine nu', () => {
    expect(safeExternalUrl('github.com')).toBe('https://github.com/')
    expect(safeExternalUrl('  example.com/path  ')).toBe('https://example.com/path')
  })

  it('refuse les schémas dangereux', () => {
    for (const value of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'blob:https://example.com/uuid',
      'mailto:contact@example.com',
    ]) {
      expect(safeExternalUrl(value), value).toBeNull()
    }
  })

  it('refuse les valeurs vides ou invalides', () => {
    expect(safeExternalUrl('')).toBeNull()
    expect(safeExternalUrl('   ')).toBeNull()
    expect(safeExternalUrl('https://')).toBeNull()
    expect(safeExternalUrl('http://exa mple.com')).toBeNull()
  })

  it('conserve le schéma existant sans le préfixer', () => {
    expect(safeExternalUrl('HTTPS://EXAMPLE.COM')).toBe('https://example.com/')
  })

  it('dérive l’URL de changement de mot de passe', () => {
    expect(changePasswordUrl(['https://github.com/login'])).toBe(
      'https://github.com/.well-known/change-password',
    )
    expect(changePasswordUrl(['github.com', 'https://gist.github.com'])).toBe(
      'https://github.com/.well-known/change-password',
    )
    expect(changePasswordUrl(['http://example.com'])).toBeNull()
    expect(changePasswordUrl(['javascript:alert(1)'])).toBeNull()
    expect(changePasswordUrl([])).toBeNull()
  })
})
