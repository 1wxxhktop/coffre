import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseCxf } from './cxf'
import { detectImportFormat, ImportError, parseImport } from './import'
import { KdbxError, readKdbx } from './kdbx'
import { parseShareInput } from './shamir'
import { parseTotpUri } from './totp'

/**
 * Tests de robustesse des parseurs exposés à des fichiers ou à des liens
 * externes. Le but n’est pas de valider le format, mais de vérifier qu’aucune
 * entrée arbitraire ne provoque de crash non contrôlé ni de boucle infinie.
 */

const RUNS = 80
const TEXT_LIMIT = 240

async function readCxf(value: unknown) {
  const text =
    typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
  try {
    await parseCxf(text, 'v_fuzz')
  } catch (error) {
    expect(error, 'CXF doit échouer avec ImportError').toBeInstanceOf(ImportError)
  }
}

describe('fuzzing des parseurs', () => {
  it('detectImportFormat accepte tout texte sans lever', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: TEXT_LIMIT }), (text) => {
        const format = detectImportFormat(text)
        expect(
          format === null ||
            [
              'bitwarden-json',
              'protonpass-json',
              'enpass-json',
              'dashlane-json',
              'cxf',
              '1pux',
              'keepass-xml',
              'csv',
            ].includes(format),
        ).toBe(true)
      }),
      { numRuns: RUNS },
    )
  })

  it('parseImport ne lève que des erreurs de format', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: TEXT_LIMIT }), (text) => {
        try {
          const parsed = parseImport(text, 'v_fuzz')
          expect(Array.isArray(parsed.items)).toBe(true)
        } catch (error) {
          expect(error).toBeInstanceOf(ImportError)
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('parseCxf ne lève que des erreurs de format', async () => {
    await fc.assert(
      fc.asyncProperty(fc.anything(), readCxf),
      { numRuns: RUNS },
    )
  })

  it('parseCxf résiste aux structures JSON profondes ou atypiques', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.string({ maxLength: 20 }),
          fc.oneof(
            fc.string({ maxLength: 40 }),
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.array(fc.string({ maxLength: 20 }), { maxLength: 4 }),
          ),
          { maxKeys: 8 },
        ),
        readCxf,
      ),
      { numRuns: RUNS },
    )
  })

  it('parseTotpUri ne plante pas sur des URI arbitraires', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: TEXT_LIMIT }), (uri) => {
        try {
          const config = parseTotpUri(uri)
          expect(config.period).toBeGreaterThanOrEqual(1)
          expect(config.period).toBeLessThanOrEqual(300)
          expect(config.digits).toBeGreaterThanOrEqual(6)
          expect(config.digits).toBeLessThanOrEqual(8)
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
          expect(String((error as Error).message).length).toBeGreaterThan(0)
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('parseShareInput ne plante pas sur des parts arbitraires', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: TEXT_LIMIT }), (part) => {
        try {
          expect(parseShareInput(part)).toBeInstanceOf(Uint8Array)
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
          expect(String((error as Error).message).length).toBeGreaterThan(0)
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('readKdbx refuse les octets arbitraires avec KdbxError', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ maxLength: 512 }),
        async (bytes) => {
          try {
            await readKdbx(bytes, 'mot de passe', 'v_fuzz')
          } catch (error) {
            expect(error).toBeInstanceOf(KdbxError)
          }
        },
      ),
      { numRuns: 30 },
    )
  })
})
