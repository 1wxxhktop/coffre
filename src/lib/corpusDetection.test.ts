// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import {
  detectAutofillFields,
  isVisible,
  type DetectedAutofill,
} from '../../extension/detect'

/**
 * Corpus de pages réelles reconstruites (E12).
 *
 * Les pages et leurs attentes sont des fichiers statiques : elles décrivent le
 * comportement visé, jamais le résultat courant du détecteur. Le taux mesuré
 * est comparé à `baseline.json`, mis à jour après revue d’une amélioration.
 */

interface CorpusCase {
  schema: number
  case: string
  category: 'login' | 'signup' | 'change' | 'card' | 'identity' | 'negative'
  environments: string[]
  expected: {
    kind: 'login' | 'signup' | 'card' | 'identity' | null
    fields: Record<string, string | null>
    visible: string[]
    hidden: string[]
  }
}

interface Baseline {
  schema: number
  cases: number
  overall: number
  byCategory: Record<string, number>
}

const PAGES = import.meta.glob('../../e2e/corpus/pages/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const EXPECTED = import.meta.glob('../../e2e/corpus/expected/*.expected.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const BASELINE_RAW = import.meta.glob('../../e2e/corpus/baseline.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const BASELINE = JSON.parse(
  Object.values(BASELINE_RAW)[0] ?? '{}',
) as Baseline

const CASES = Object.values(EXPECTED)
  .map((raw) => JSON.parse(raw) as CorpusCase)
  .sort((left, right) => left.case.localeCompare(right.case))

const PAGES_BY_CASE = new Map(
  Object.entries(PAGES).map(([path, html]) => [
    path.split('/').pop()!.replace(/\.html$/, ''),
    html,
  ]),
)

beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 120,
      height: 24,
      top: 0,
      left: 0,
      right: 120,
      bottom: 24,
      toJSON: () => ({}),
    }) as DOMRect
})

function mount(html: string): Document {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.head.innerHTML = parsed.head.innerHTML
  document.body.innerHTML = parsed.body.innerHTML
  return document
}

function byRef(ref: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-corpus-ref="${ref}"]`)
}

function fieldRefs(
  result: DetectedAutofill | null,
): Record<string, string | null> {
  if (!result) return {}
  const fields = (
    result.kind === 'login'
      ? result.login
      : result.kind === 'signup'
        ? result.signup
        : result.kind === 'card'
          ? result.card
          : result.identity
  ) as unknown as Record<string, HTMLInputElement | HTMLFormElement | null>
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([key]) => key !== 'form')
      .map(([key, value]) => [
        key,
        (value as HTMLInputElement | null)?.getAttribute('data-corpus-ref') ?? null,
      ]),
  )
}

interface Outcome {
  name: string
  category: CorpusCase['category']
  problems: string[]
}

function evaluate(entry: CorpusCase): Outcome {
  const html = PAGES_BY_CASE.get(entry.case)
  if (!html) {
    return {
      name: entry.case,
      category: entry.category,
      problems: ['page HTML introuvable'],
    }
  }
  mount(html)
  const result = detectAutofillFields(document)
  const actualKind = result?.kind ?? null
  const problems: string[] = []

  if (actualKind !== entry.expected.kind) {
    problems.push(
      `type : attendu ${entry.expected.kind ?? 'aucun'}, obtenu ${actualKind ?? 'aucun'}`,
    )
  }

  if (entry.expected.kind !== null) {
    const actual = fieldRefs(result)
    for (const [key, expected] of Object.entries(entry.expected.fields)) {
      const obtained = actual[key] ?? null
      if (obtained !== expected) {
        problems.push(
          `${key} : attendu ${expected ?? 'aucun'}, obtenu ${obtained ?? 'aucun'}`,
        )
      }
    }
  }

  for (const ref of entry.expected.visible) {
    const element = byRef(ref)
    if (!element) problems.push(`champ visible introuvable : ${ref}`)
    else if (!isVisible(element)) problems.push(`champ attendu visible : ${ref}`)
  }
  for (const ref of entry.expected.hidden) {
    const element = byRef(ref)
    if (!element) problems.push(`champ masqué introuvable : ${ref}`)
    else if (isVisible(element)) problems.push(`champ attendu masqué : ${ref}`)
  }

  return { name: entry.case, category: entry.category, problems }
}

function validateReference(entry: CorpusCase, ref: string, field: string): void {
  const elements = document.querySelectorAll(
    `[data-corpus-ref="${ref}"]`,
  )
  expect(
    elements.length,
    `${entry.case} · ${field} · référence « ${ref} » absente ou ambiguë`,
  ).toBe(1)
}

describe('corpus de détection de formulaires (E12)', () => {
  it('contient des paires page/attente complètes et valides', () => {
    expect(CASES).toHaveLength(50)
    expect(Object.keys(PAGES)).toHaveLength(50)
    expect(BASELINE.cases).toBe(CASES.length)

    const categories = new Set([
      'login',
      'signup',
      'change',
      'card',
      'identity',
      'negative',
    ])
    const kinds = new Set(['login', 'signup', 'card', 'identity', null])

    for (const entry of CASES) {
      expect(PAGES_BY_CASE.has(entry.case), `page manquante : ${entry.case}`).toBe(
        true,
      )
      expect(entry.schema).toBe(1)
      expect(entry.environments).toContain('jsdom')
      expect(categories.has(entry.category)).toBe(true)
      expect(kinds.has(entry.expected.kind)).toBe(true)
      if (entry.expected.kind === null) {
        expect(Object.keys(entry.expected.fields)).toHaveLength(0)
      } else {
        expect(Object.keys(entry.expected.fields).length).toBeGreaterThan(0)
      }

      mount(PAGES_BY_CASE.get(entry.case)!)
      for (const [field, ref] of Object.entries(entry.expected.fields)) {
        if (ref) validateReference(entry, ref, field)
      }
      for (const ref of entry.expected.visible) {
        validateReference(entry, ref, 'visible')
      }
      for (const ref of entry.expected.hidden) {
        validateReference(entry, ref, 'hidden')
      }
    }
  })

  describe('cas', () => {
    for (const entry of CASES) {
      it(`${entry.category} · ${entry.case}`, () => {
        const outcome = evaluate(entry)
        expect(outcome.problems, outcome.problems.join(' ; ')).toEqual([])
      })
    }
  })

  it('maintient le taux de détection de référence', () => {
    const outcomes = CASES.map(evaluate)
    const failed = outcomes.filter((outcome) => outcome.problems.length > 0)
    const rate = (outcomes.length - failed.length) / outcomes.length
    expect(
      rate,
      `${failed.length} cas en échec :\n${failed
        .map((outcome) => `- ${outcome.name} : ${outcome.problems.join(' ; ')}`)
        .join('\n')}`,
    ).toBeGreaterThanOrEqual(BASELINE.overall - 1e-9)

    for (const [category, baseline] of Object.entries(BASELINE.byCategory)) {
      const scoped = outcomes.filter((outcome) => outcome.category === category)
      if (scoped.length === 0) continue
      const categoryRate =
        (scoped.length -
          scoped.filter((outcome) => outcome.problems.length > 0).length) /
        scoped.length
      expect(
        categoryRate,
        `catégorie ${category} : ${categoryRate * 100} % < ${baseline * 100} %`,
      ).toBeGreaterThanOrEqual(baseline - 1e-9)
    }
  })
})
