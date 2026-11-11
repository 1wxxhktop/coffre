import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalJson, computeManifest, parseVaultFile } from './vault'

function vector(name: string): string {
  return readFileSync(new URL(`../../test-vectors/${name}`, import.meta.url), 'utf8')
}

describe('vecteur croisé du manifeste 2', () => {
  it('sérialise les sidecars exactement comme coffre-core', async () => {
    const file = parseVaultFile(JSON.parse(vector('manifest-v2-sidecars.file.json')))
    const manifest = await computeManifest(file, 2)
    expect(canonicalJson(manifest)).toBe(
      vector('manifest-v2-sidecars.manifest.json').trim(),
    )
    const legacy = await computeManifest(file, 1)
    expect(canonicalJson(legacy)).toBe(
      vector('manifest-v1-sidecars.manifest.json').trim(),
    )
    const current = await computeManifest(file, 3)
    expect(canonicalJson(current)).toBe(
      vector('manifest-v3-sidecars.manifest.json').trim(),
    )
  })
})
