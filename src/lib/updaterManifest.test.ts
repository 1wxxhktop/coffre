import { describe, expect, it } from 'vitest'
import {
  buildManifest,
  compareVersions,
  MACOS_UNIVERSAL_PLATFORMS,
  shouldReplaceChannel,
} from './updaterManifest'

describe('manifeste de mise à jour', () => {
  it('construit le manifeste du bundle macOS universel', () => {
    const manifest = buildManifest({
      version: '1.2.0',
      notes: '  Corrections  ',
      pubDate: new Date('2026-11-10T12:00:00.000Z'),
      url: 'https://github.com/1wxxhktop/coffre/releases/download/v1.2.0/Coffre.app.tar.gz',
      signature: 'dW50cnVzdGVk\n',
    })
    expect(manifest.version).toBe('1.2.0')
    expect(manifest.notes).toBe('Corrections')
    expect(manifest.pub_date).toBe('2026-11-10T12:00:00.000Z')
    expect(Object.keys(manifest.platforms)).toEqual(MACOS_UNIVERSAL_PLATFORMS)
    expect(manifest.platforms['darwin-aarch64'].signature).toBe('dW50cnVzdGVk')
  })

  it('refuse une URL non HTTPS, une signature vide ou une version invalide', () => {
    const base = {
      version: '1.2.0',
      notes: '',
      pubDate: new Date(),
      url: 'https://exemple.test/Coffre.app.tar.gz',
      signature: 'sig',
    }
    expect(() => buildManifest({ ...base, url: 'http://exemple.test/a.tar.gz' })).toThrow()
    expect(() => buildManifest({ ...base, signature: '  ' })).toThrow()
    expect(() => buildManifest({ ...base, version: 'v1.2' })).toThrow()
  })

  it('ordonne les versions SemVer, préversions comprises', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBeLessThan(0)
    expect(compareVersions('1.2.0-beta.2', '1.2.0-beta.10')).toBeLessThan(0)
    expect(compareVersions('1.2.0-alpha', '1.2.0-beta')).toBeLessThan(0)
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
  })

  it('ne fait jamais reculer le canal bêta', () => {
    expect(shouldReplaceChannel(null, { version: '1.0.0' })).toBe(true)
    expect(shouldReplaceChannel({ version: '1.3.0-beta.1' }, { version: '1.2.1' })).toBe(false)
    expect(shouldReplaceChannel({ version: '1.3.0-beta.1' }, { version: '1.3.0' })).toBe(true)
    expect(shouldReplaceChannel({ version: '1.3.0' }, { version: '1.3.0' })).toBe(false)
  })
})
