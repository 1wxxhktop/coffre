import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(
    new URL('../../extension/public/manifest.json', import.meta.url),
    'utf8',
  ),
) as {
  key?: string
  permissions?: string[]
  browser_specific_settings?: { gecko?: { id?: string } }
}

function chromeExtensionId(key: string): string {
  const digest = createHash('sha256')
    .update(Buffer.from(key, 'base64'))
    .digest('hex')
    .slice(0, 32)
  return [...digest]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join('')
}

describe('manifeste de l’extension et pont natif', () => {
  it('pinned une clé qui donne l’identifiant autorisé par l’hôte natif', () => {
    expect(manifest.key).toBeTruthy()
    // Doit rester identique à CHROME_EXTENSION_ID dans src-tauri/src/bridge.rs.
    expect(chromeExtensionId(manifest.key as string)).toBe(
      'dmajddgmehhebmpcdooifjdakjjngdla',
    )
  })

  it('demande la permission de messagerie native', () => {
    expect(manifest.permissions).toContain('nativeMessaging')
  })

  it('conserve l’identifiant Firefox autorisé par l’hôte natif', () => {
    expect(manifest.browser_specific_settings?.gecko?.id).toBe(
      'coffre@1wxxhktop.github.io',
    )
  })
})
