import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BreachCheckError,
  fetchHibpRange,
  normalizeHibpPrefix,
  parseHibpRange,
  scanBreaches,
} from './breach'
import { emptyDraft, type LoginItem } from './types'

const PASSWORD_HASH = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8'
const PASSWORD_PREFIX = PASSWORD_HASH.slice(0, 5)
const PASSWORD_SUFFIX = PASSWORD_HASH.slice(5)
const PADDING_SUFFIX = '0'.repeat(35)

function login(
  id: string,
  password: string,
  overrides: Partial<LoginItem> = {},
): LoginItem {
  return {
    ...emptyDraft('login', 'v1'),
    id,
    vaultId: 'v1',
    title: id,
    username: `${id}@example.com`,
    password,
    urls: ['https://example.com'],
    totp: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as LoginItem
}

describe('surveillance HIBP', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('valide les préfixes à cinq caractères hexadécimaux', () => {
    expect(normalizeHibpPrefix('5baa6')).toBe('5BAA6')
    expect(() => normalizeHibpPrefix('5BAA')).toThrow(BreachCheckError)
    expect(() => normalizeHibpPrefix('5BAA61')).toThrow(BreachCheckError)
    expect(() => normalizeHibpPrefix('5BAAZ')).toThrow(BreachCheckError)
    expect(() => normalizeHibpPrefix('https://example.com')).toThrow(
      BreachCheckError,
    )
  })

  it('parse les lignes HIBP et ignore les malformées', () => {
    const range = parseHibpRange(
      `${PASSWORD_SUFFIX.toLowerCase()}:42\r\ninvalide\r\n${PADDING_SUFFIX}:0\r\n`,
    )
    expect(range.get(PASSWORD_SUFFIX)).toBe(42)
    expect(range.get(PADDING_SUFFIX)).toBe(0)
    expect(range.size).toBe(2)
  })

  it('n’envoie que des préfixes et retrouve les éléments compromis', async () => {
    const received: string[] = []
    const fetcher = async (prefix: string): Promise<string> => {
      received.push(prefix)
      if (prefix === PASSWORD_PREFIX) {
        return `${PASSWORD_SUFFIX}:42\r\n${PADDING_SUFFIX}:0\r\n`
      }
      return `${PADDING_SUFFIX}:0\r\n`
    }
    const items = [
      login('i1', 'password'),
      login('i2', 'password'),
      login('i3', 'mot-de-passe-unique'),
      login('i4', 'password', { deletedAt: '2026-01-02T00:00:00.000Z' }),
      login('i5', ''),
    ]

    const result = await scanBreaches(items, fetcher)

    expect(result.breachedItemIds.sort()).toEqual(['i1', 'i2'])
    expect(result.checkedPasswords).toBe(2)
    expect(result.checkedPrefixes).toBe(2)
    expect(received).toHaveLength(2)
    for (const prefix of received) {
      expect(prefix).toMatch(/^[0-9A-F]{5}$/)
      expect(prefix).not.toBe('password')
      expect(prefix).not.toBe(PASSWORD_HASH)
    }
  })

  it('ne fait aucun appel sans mot de passe actif', async () => {
    const fetcher = vi.fn(async () => '')
    const result = await scanBreaches(
      [login('i1', '', {}), login('i2', 'abc', { deletedAt: '2026-01-02T00:00:00.000Z' })],
      fetcher,
    )
    expect(result.breachedItemIds).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('construit une requête Web limitée au préfixe et avec Add-Padding', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => `${PASSWORD_SUFFIX}:1\r\n`,
    }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchHibpRange('5baa6')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ]
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PASSWORD_PREFIX}`)
    expect(init.headers['Add-Padding']).toBe('true')
    expect(url).not.toContain(PASSWORD_HASH)
    expect(url).not.toContain(PASSWORD_SUFFIX)
  })

  it('refuse une réponse Web en erreur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, text: async () => '' })),
    )
    await expect(fetchHibpRange('5BAA6')).rejects.toBeInstanceOf(
      BreachCheckError,
    )
  })
})
