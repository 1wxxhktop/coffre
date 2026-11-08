/**
 * Regroupement des éléments par date.
 *
 * Les dates récentes utilisent des libellés relatifs ; les plus anciennes sont
 * regroupées par mois. Le classement des groupes est indépendant du fuseau
 * horaire et ne dépend que du calendrier local.
 */

export type DateGroupKind =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'month-year'
  | 'unknown'

export interface DateGroupInfo {
  key: string
  kind: DateGroupKind
  /** Rang croissant : 0 = aujourd’hui, puis hier, etc. */
  rank: number
  /** Mois concerné, uniquement pour `month-year`. */
  date: Date | null
}

export interface DateGroup<T> extends DateGroupInfo {
  items: T[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

function monthRank(value: Date, now: Date): number {
  return (
    4 +
    (now.getFullYear() * 12 + now.getMonth()) -
    (value.getFullYear() * 12 + value.getMonth())
  )
}

function parseDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Calcule le groupe d’une date par rapport à `now`. */
export function dateGroupInfo(
  value: string | number | null | undefined,
  now = new Date(),
): DateGroupInfo {
  const date = parseDate(value)
  if (!date) {
    return { key: 'unknown', kind: 'unknown', rank: 1000, date: null }
  }

  const today = startOfDay(now)
  const day = startOfDay(date)
  if (day >= today) {
    return { key: 'today', kind: 'today', rank: 0, date: null }
  }
  if (day === today - DAY_MS) {
    return { key: 'yesterday', kind: 'yesterday', rank: 1, date: null }
  }
  if (day > today - 7 * DAY_MS) {
    return { key: 'week', kind: 'week', rank: 2, date: null }
  }
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  ) {
    return { key: 'month', kind: 'month', rank: 3, date: null }
  }

  const key = `month-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return {
    key,
    kind: 'month-year',
    rank: monthRank(date, now),
    date,
  }
}

/**
 * Regroupe des éléments en conservant leur ordre à l’intérieur de chaque
 * groupe. Les groupes sont classés du plus récent au plus ancien.
 */
export function groupItemsByDate<T>(
  items: T[],
  dateOf: (item: T) => string | number | null | undefined,
  now = new Date(),
): DateGroup<T>[] {
  const groups = new Map<string, DateGroup<T>>()
  for (const item of items) {
    const info = dateGroupInfo(dateOf(item), now)
    const existing = groups.get(info.key)
    if (existing) {
      existing.items.push(item)
    } else {
      groups.set(info.key, { ...info, items: [item] })
    }
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank)
}
