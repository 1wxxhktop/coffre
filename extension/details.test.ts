// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'

let loginLinks: typeof import('./details')['loginLinks']

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string) => key,
      getUILanguage: () => 'fr',
    },
  })
  ;({ loginLinks } = await import('./details'))
})

describe('liens d’une connexion dans l’extension', () => {
  it('rend des liens web absolus, ouverts dans un nouvel onglet', () => {
    const row = loginLinks([
      'https://github.com/login',
      'example.com/account',
      'javascript:alert(1)',
      'ftp://example.com/fichier',
    ])
    expect(row).not.toBeNull()
    const links = Array.from(row!.querySelectorAll('a'))
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://github.com/login',
      'https://example.com/account',
    ])
    expect(links.every((link) => link.target === '_blank')).toBe(true)
    expect(links.every((link) => link.rel.includes('noopener'))).toBe(true)
    expect(links[0].textContent).toContain('github.com/login')
  })

  it('ne rend rien sans lien valide', () => {
    expect(loginLinks([])).toBeNull()
    expect(loginLinks(['javascript:alert(1)'])).toBeNull()
  })
})
