import { useMemo } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { useI18n } from '../state/I18nProvider'
import { pluralKey, type MessageKey } from '../lib/i18n'
import {
  SECURITY_SCORE_VERSION,
  summarizeSecurityHistory,
  type SecuritySnapshot,
} from '../lib/securityHistory'

interface SecurityHistoryChartProps {
  history: SecuritySnapshot[]
}

const WIDTH = 320
const HEIGHT = 92
const PADDING_X = 10
const PADDING_TOP = 8
const PADDING_BOTTOM = 16

function shortDate(value: string, locale: string): string {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
  }).format(new Date(year, month - 1, day))
}

const SCORE_KEYS: Array<{ min: number; key: MessageKey }> = [
  { min: 90, key: 'security.score.excellent' },
  { min: 75, key: 'security.score.good' },
  { min: 50, key: 'security.score.fair' },
  { min: 0, key: 'security.score.critical' },
]

function scoreKey(score: number): MessageKey {
  return SCORE_KEYS.find((entry) => score >= entry.min)?.key ?? 'security.score.critical'
}

/**
 * Courbe du score de sécurité, limitée aux 90 derniers jours. Le graphique ne
 * contient que des scores et des dates : aucun secret.
 */
export function SecurityHistoryChart({ history }: SecurityHistoryChartProps) {
  const { t, intl } = useI18n()
  const points = useMemo(() => history.slice(-90), [history])
  const summary = useMemo(() => summarizeSecurityHistory(points), [points])
  const scoringChanged = points.some(
    (snapshot) => (snapshot.scoreVersion ?? 1) !== SECURITY_SCORE_VERSION,
  )

  if (!summary || points.length < 2) {
    return (
      <div className="security-history security-history--empty">
        <p className="security-history__title">{t('security.history.title')}</p>
        <p className="security-history__hint">{t('security.history.empty')}</p>
      </div>
    )
  }

  const innerWidth = WIDTH - PADDING_X * 2
  const innerHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM
  const coordinates = points.map((snapshot, index) => {
    const x =
      PADDING_X + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth)
    const y = PADDING_TOP + ((100 - snapshot.score) / 100) * innerHeight
    return { x, y, snapshot }
  })
  const line = coordinates.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
  const area = `M ${coordinates[0].x.toFixed(1)} ${(HEIGHT - PADDING_BOTTOM).toFixed(1)} L ${line.replaceAll(' ', ' L ')} L ${coordinates[coordinates.length - 1].x.toFixed(1)} ${(HEIGHT - PADDING_BOTTOM).toFixed(1)} Z`
  const trend = summary.delta > 0 ? 'up' : summary.delta < 0 ? 'down' : 'flat'
  const TrendIcon = trend === 'up' ? TrendingUp : TrendingDown

  return (
    <div className="security-history">
      <div className="security-history__head">
        <div>
          <p className="security-history__title">{t('security.history.title')}</p>
          <p className="security-history__hint">
            {t(
              pluralKey(
                points.length,
                'security.history.range.one',
                'security.history.range.other',
              ),
              {
                from: shortDate(summary.first.date, intl),
                to: shortDate(summary.last.date, intl),
                count: points.length,
              },
            )}
          </p>
        </div>
        <span className={`security-history__delta security-history__delta--${trend}`}>
          {trend !== 'flat' && <TrendIcon size={13} aria-hidden="true" />}
          {summary.delta > 0 ? '+' : ''}
          {summary.delta} pts
        </span>
      </div>
      {scoringChanged && (
        <p className="security-history__hint">{t('security.history.scoringChanged')}</p>
      )}

      <svg
        className="security-history__chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t('security.history.aria', {
          from: shortDate(summary.first.date, intl),
          to: shortDate(summary.last.date, intl),
          first: summary.first.score,
          last: summary.last.score,
          min: summary.min.score,
          max: summary.max.score,
        })}
      >
        {[0, 50, 100].map((value) => {
          const y = PADDING_TOP + ((100 - value) / 100) * innerHeight
          return (
            <g key={value}>
              <line
                x1={PADDING_X}
                x2={WIDTH - PADDING_X}
                y1={y}
                y2={y}
                className="security-history__grid"
              />
              <text x={PADDING_X} y={y - 2} className="security-history__axis">
                {value}
              </text>
            </g>
          )
        })}
        <path d={area} className="security-history__area" />
        <polyline points={line} className="security-history__line" />
        <circle
          cx={coordinates[coordinates.length - 1].x}
          cy={coordinates[coordinates.length - 1].y}
          r={3.5}
          className="security-history__point"
        />
      </svg>

      <div className="security-history__legend">
        <span>
          {t('security.history.min')} <strong>{summary.min.score}</strong> ·{' '}
          {t(scoreKey(summary.min.score))}
        </span>
        <span>
          {t('security.history.max')} <strong>{summary.max.score}</strong> ·{' '}
          {t(scoreKey(summary.max.score))}
        </span>
        <span>
          {t('security.history.current')} <strong>{summary.last.score}</strong> ·{' '}
          {t(scoreKey(summary.last.score))}
        </span>
      </div>
    </div>
  )
}
