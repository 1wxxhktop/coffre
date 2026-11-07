import { describe, expect, it } from 'vitest'
import { hostFromUrl, hostMatches, searchLogins } from './extensionProtocol'
import type { VaultItem } from './types'

function login(
  id: string,
  title: string,
  username: string,
  urls: string[],
  extra: Partial<VaultItem> = {},
): VaultItem {
  return {
    id,
    vaultId: 'v1',
    type: 'login',
    title,
    favorite: false,
    notes: '',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    username,
    password: 'secret',
    urls,
    totp: '',
    ...extra,
  } as VaultItem
}

const items: VaultItem[] = [
  login('1', 'GitHub', 'studio26', ['https://github.com']),
  login('2', 'Gist', 'studio26', ['https://gist.github.com']),
  login('3', 'Proton Mail', 'ada@proton.me', [], { totp: 'otpauth://totp/x?secret=ABC' }),
  login('4', 'Supprimé', 'ada', ['https://github.com'], {
    deletedAt: '2026-02-01T00:00:00.000Z',
  }),
  {
    id: '5',
    vaultId: 'v1',
    type: 'note',
    title: 'Note GitHub',
    favorite: false,
    notes: 'github',
    tags: [],
    customFields: [],
    attachments: [],
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

describe('passerelle extension', () => {
  it('normalise les URL et compare les domaines', () => {
    expect(hostFromUrl('https://www.Example.com/login')).toBe('example.com')
    expect(hostFromUrl('example.com')).toBe('example.com')
    expect(hostFromUrl('pas une url')).toBe('')
    expect(hostMatches('example.com', 'login.example.com')).toBe(true)
    expect(hostMatches('example.com', 'example.org')).toBe(false)
  })

  it('retrouve les connexions par domaine', () => {
    const results = searchLogins(items, 'github.com')
    expect(results.map((entry) => entry.id).sort()).toEqual(['1', '2'])
    expect(results[0]).toMatchObject({ title: expect.any(String), host: expect.any(String) })
  })

  it('retrouve une connexion par texte', () => {
    const results = searchLogins(items, 'proton')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: '3',
      title: 'Proton Mail',
      username: 'ada@proton.me',
      hasTotp: true,
    })
  })

  it('liste les connexions actives sans requête', () => {
    const results = searchLogins(items, '')
    expect(results.map((entry) => entry.id).sort()).toEqual(['1', '2', '3'])
  })

  it('ne renvoie rien pour un domaine inconnu', () => {
    expect(searchLogins(items, 'inconnu.example')).toEqual([])
  })
})
