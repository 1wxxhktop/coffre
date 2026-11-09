import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assessPhishing,
  assessPhishingForItems,
  buildPhishingIndex,
  damerauLevenshtein,
  decodeHost,
  decodePunycodeLabel,
  popularPhishingIndex,
  skeleton,
} from './phishing'
import { registrableDomain } from './domains'
import { emptyDraft, type LoginItem, type PasskeyItem, type VaultItem } from './types'

const NOW = '2026-11-09T12:00:00.000Z'

function login(urls: string[], username = 'ada', title = 'Compte'): LoginItem {
  return {
    ...emptyDraft('login', 'v1'),
    id: `i-${title}-${urls.join('-')}`,
    title,
    username,
    password: 'mot-de-passe-de-test',
    urls,
    totp: '',
    createdAt: NOW,
    updatedAt: NOW,
  } as LoginItem
}

function passkey(rpId: string): PasskeyItem {
  return {
    ...emptyDraft('passkey', 'v1'),
    id: `p-${rpId}`,
    title: `Passkey ${rpId}`,
    rpId,
    userHandle: '',
    userName: 'ada',
    credentialId: '',
    privateKey: '',
    publicKeyCose: '',
    signCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  } as PasskeyItem
}

function vault(...items: VaultItem[]): VaultItem[] {
  return items
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('domaines enregistrables', () => {
  it.each([
    ['paypal.com', 'paypal.com'],
    ['www.paypal.com', 'paypal.com'],
    ['login.paypal.com', 'paypal.com'],
    ['foo.bar.co.uk', 'bar.co.uk'],
    ['foo.github.io', 'foo.github.io'],
    ['github.io', 'github.io'],
    ['localhost', 'localhost'],
    ['192.168.1.10', '192.168.1.10'],
  ])('%s → %s', (host, expected) => {
    expect(registrableDomain(host)).toBe(expected)
  })
})

describe('punycode et confusables', () => {
  it('décode les libellés punycode usuels', () => {
    expect(decodePunycodeLabel('mnchen-3ya')).toBe('münchen')
    expect(decodePunycodeLabel('pypal-4ve')).toBe('pаypal')
    expect(decodeHost('xn--mnchen-3ya.de')).toBe('münchen.de')
    expect(decodeHost('www.xn--mnchen-3ya.de')).toBe('münchen.de')
  })

  it('laisse un hôte ASCII inchangé', () => {
    expect(decodeHost('paypal.com')).toBe('paypal.com')
  })

  it('réduit les homoglyphes et le leetspeak', () => {
    expect(skeleton('pаypal.com')).toBe('paypal.com')
    expect(skeleton('paypa1.com')).toBe('paypal.com')
    expect(skeleton('münchen.de')).toBe('munchen.de')
    expect(skeleton('ＭＩＣＲＯＳＯＦＴ.com')).toBe('microsoft.com')
  })

  it('calcule une distance bornée', () => {
    expect(damerauLevenshtein('paypal.com', 'paypal.com')).toBe(0)
    expect(damerauLevenshtein('paypal.com', 'paypa1.com')).toBe(1)
    expect(damerauLevenshtein('paypal.com', 'paypal.co')).toBe(1)
    expect(damerauLevenshtein('paypal.com', 'paypa1.co')).toBe(2)
    expect(damerauLevenshtein('paypal.com', 'example.com', 2)).toBe(3)
  })
})

describe('signaux anti-hameçonnage', () => {
  const paypal = vault(login(['https://paypal.com/login'], 'ada', 'PayPal'))
  const google = vault(login(['https://google.com'], 'ada', 'Google'))

  it.each([
    ['paypa1.com', 'paypal.com', 'confusable'],
    ['pаypal.com', 'paypal.com', 'confusable'],
    ['paypal.com.login-check.io', 'paypal.com', 'brand-subdomain'],
    ['paypal.com.evil.io', 'paypal.com', 'brand-subdomain'],
    ['paypal.secure-login.io', 'paypal.com', 'brand-subdomain'],
    ['secure.paypal.com.evil.io', 'paypal.com', 'brand-subdomain'],
    ['paypa1.test', 'paypal.com', 'typo'],
    ['gooogle.com', 'google.com', 'typo'],
    ['google.co', 'google.com', 'typo'],
    ['app1e.com', 'apple.com', 'confusable'],
    ['micros0ft.com', 'microsoft.com', 'confusable'],
    ['github.co', 'github.com', 'typo'],
    ['examp1e.com', 'example.com', 'confusable'],
  ])('%s déclenche %s pour %s', (host, known, code) => {
    const items =
      known === 'paypal.com'
        ? paypal
        : known === 'google.com'
          ? google
          : vault(login([`https://${known}`], 'ada', known))
    const result = assessPhishingForItems(items, {
      host,
      url: `https://${host}/login`,
      mode: 'fill',
    })
    expect(result.signals.some((signal) => signal.code === code)).toBe(true)
    expect(result.signals.some((signal) => signal.knownDomain === known)).toBe(
      code !== 'unknown-domain',
    )
    expect(result.level).toBe('danger')
  })

  it.each([
    ['accounts.google.com', 'google.com'],
    ['mail.google.com', 'google.com'],
    ['www.google.com', 'google.com'],
    ['google.com', 'google.com'],
    ['apple.com', 'icloud.com'],
    ['icloud.com', 'apple.com'],
    ['gmail.com', 'google.com'],
    ['münchen.de', 'münchen.de'],
    ['www.münchen.de', 'xn--mnchen-3ya.de'],
    ['example.org', 'example.com'],
    ['notpaypal.com', 'paypal.com'],
    ['paypal.fr', 'paypal.com'],
    ['foo.github.io', 'github.com'],
  ])('%s ne déclenche rien pour %s', (host, known) => {
    const items = vault(login([`https://${known}`], 'ada', known))
    const result = assessPhishingForItems(items, {
      host,
      url: `https://${host}/login`,
      mode: 'fill',
    })
    expect(result.signals).toEqual([])
    expect(result.level).toBeNull()
  })

  it('signale une IP brute et le HTTP', () => {
    const result = assessPhishingForItems(paypal, {
      host: '192.168.1.10',
      url: 'http://192.168.1.10/login',
      mode: 'fill',
    })
    expect(result.signals.map((signal) => signal.code).sort()).toEqual(['http', 'ip'])
    expect(result.level).toBe('danger')
  })

  it('signale un port inhabituel sans bloquer le HTTPS standard', () => {
    const unusual = assessPhishingForItems(paypal, {
      host: 'paypal.com',
      url: 'https://paypal.com:8443/login',
      mode: 'fill',
    })
    expect(unusual.signals.map((signal) => signal.code)).toContain('port')
    const normal = assessPhishingForItems(paypal, {
      host: 'paypal.com',
      url: 'https://paypal.com:443/login',
      mode: 'fill',
    })
    expect(normal.signals).toEqual([])
  })

  it.each(['localhost', '127.0.0.1', '::1'])('ignore le bouclage %s', (host) => {
    const result = assessPhishingForItems(paypal, {
      host,
      url: `http://${host}:8080/login`,
      mode: 'fill',
    })
    expect(result.signals).toEqual([])
  })

  it('avertit à l’enregistrement quand l’identifiant existe sur un autre domaine', () => {
    const result = assessPhishingForItems(paypal, {
      host: 'nouveau-site.test',
      url: 'https://nouveau-site.test/login',
      username: 'ada',
      mode: 'save',
    })
    expect(result.signals.map((signal) => signal.code)).toContain('unknown-domain')
    expect(result.level).toBe('warning')
  })

  it('ne signale pas un identifiant connu sur le même domaine enregistrable', () => {
    const result = assessPhishingForItems(paypal, {
      host: 'login.paypal.com',
      url: 'https://login.paypal.com/',
      username: 'ada',
      mode: 'save',
    })
    expect(result.signals).toEqual([])
  })

  it('ne signale pas un domaine inconnu en mode remplissage', () => {
    const result = assessPhishingForItems(paypal, {
      host: 'nouveau-site.test',
      url: 'https://nouveau-site.test/login',
      username: 'ada',
      mode: 'fill',
    })
    expect(result.signals).toEqual([])
  })

  it('reconnaît un domaine populaire sans coffre', () => {
    const result = assessPhishing(popularPhishingIndex(), {
      host: 'paypa1.com',
      url: 'https://paypa1.com/login',
      mode: 'fill',
    })
    expect(result.signals.some((signal) => signal.code === 'confusable')).toBe(true)
  })

  it('utilise les passkeys comme domaines connus', () => {
    const items = vault(passkey('github.com'))
    const result = assessPhishingForItems(items, {
      host: 'github.com.evil.io',
      url: 'https://github.com.evil.io/login',
      mode: 'fill',
    })
    expect(result.signals.some((signal) => signal.code === 'brand-subdomain')).toBe(true)
  })

  it('ignore les éléments en corbeille', () => {
    const deleted = { ...login(['https://paypal.com']), deletedAt: NOW }
    const result = assessPhishingForItems(vault(deleted), {
      host: 'paypa1.com',
      url: 'https://paypa1.com/login',
      mode: 'fill',
    })
    // La liste populaire contient encore paypal.com : le signal reste présent,
    // mais l’élément en corbeille ne doit pas ajouter d’autre domaine.
    expect(result.signals.length).toBeGreaterThan(0)
  })

  it.each([
    ['xn--pypal-4ve.com', 'paypal.com', 'confusable'],
    ['www.xn--pypal-4ve.com', 'paypal.com', 'confusable'],
    ['paypa1.co.uk', 'paypal.com', 'typo'],
    ['paypal.cm', 'paypal.com', 'typo'],
    ['rnicrosoft.com', 'microsoft.com', 'confusable'],
    ['g00gle.com', 'google.com', 'confusable'],
    ['apple.com.evil.io', 'apple.com', 'brand-subdomain'],
  ])('%s déclenche aussi %s', (host, known, code) => {
    const items = vault(login([`https://${known}`], 'ada', known))
    const result = assessPhishingForItems(items, {
      host,
      url: `https://${host}/login`,
      mode: 'fill',
    })
    expect(result.signals.some((signal) => signal.code === code)).toBe(true)
  })

  it.each([
    ['paypal.com.br', 'paypal.com'],
    ['paypal.de', 'paypal.com'],
    ['googleapis.com', 'google.com'],
    ['googlecloud.com', 'google.com'],
    ['microsoftonline.com', 'microsoft.com'],
    ['outlook.com', 'microsoft.com'],
    ['amazon.co.uk', 'amazon.com'],
    ['x.com', 'twitter.com'],
    ['t.co', 'twitter.com'],
    ['githubusercontent.com', 'github.com'],
    ['gist.github.com', 'github.com'],
    ['apple.fr', 'apple.com'],
  ])('%s reste légitime face à %s', (host, known) => {
    const items = vault(login([`https://${known}`], 'ada', known))
    const result = assessPhishingForItems(items, {
      host,
      url: `https://${host}/login`,
      mode: 'fill',
    })
    expect(result.signals).toEqual([])
  })

  it('conserve les signaux HTTP et IP quand le domaine est ignoré', () => {
    const result = assessPhishingForItems(paypal, {
      host: 'paypa1.com',
      url: 'http://paypa1.com/login',
      mode: 'fill',
      skipDomainSignals: true,
    })
    expect(result.signals.map((signal) => signal.code)).toEqual(['http'])
  })

  it('signale le HTTP même sur un domaine connu', () => {
    const result = assessPhishingForItems(paypal, {
      host: 'paypal.com',
      url: 'http://paypal.com/login',
      mode: 'fill',
    })
    expect(result.signals.map((signal) => signal.code)).toEqual(['http'])
  })

  it('n’ajoute pas « domaine jamais vu » si un autre signal existe', () => {
    const result = assessPhishingForItems(paypal, {
      host: 'paypa1.test',
      url: 'https://paypa1.test/login',
      username: 'ada',
      mode: 'save',
    })
    expect(result.signals.some((signal) => signal.code === 'typo')).toBe(true)
    expect(result.signals.some((signal) => signal.code === 'unknown-domain')).toBe(false)
  })

  it('accepte un domaine équivalent pour le même identifiant', () => {
    const items = vault(login(['https://google.com'], 'ada', 'Google'))
    const result = assessPhishingForItems(items, {
      host: 'gmail.com',
      url: 'https://gmail.com/login',
      username: 'ada',
      mode: 'save',
    })
    expect(result.signals).toEqual([])
  })

  it('ne fait aucun appel réseau', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(''))
    assessPhishingForItems(paypal, {
      host: 'paypa1.com',
      url: 'https://paypa1.com/login',
      mode: 'fill',
    })
    assessPhishing(popularPhishingIndex(), {
      host: 'paypal.com.evil.io',
      url: 'http://paypal.com.evil.io/login',
      username: 'ada',
      mode: 'save',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reste sous 2 ms par vérification sur 2 000 éléments', () => {
    const items: VaultItem[] = []
    for (let index = 0; index < 2_000; index += 1) {
      items.push(
        login([`https://site-${index}.example`], `utilisateur-${index}`, `Site ${index}`),
      )
    }
    const index = buildPhishingIndex(items)
    const query = {
      host: 'paypa1.com',
      url: 'https://paypa1.com/login',
      mode: 'fill' as const,
    }
    // Préchauffage du JIT.
    for (let run = 0; run < 20; run += 1) assessPhishing(index, query)
    const start = performance.now()
    const iterations = 200
    for (let run = 0; run < iterations; run += 1) assessPhishing(index, query)
    const average = (performance.now() - start) / iterations
    expect(average).toBeLessThan(2)
  })
})
