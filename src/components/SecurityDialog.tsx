import { useEffect, useMemo, useState } from 'react'
import {
  CircleHelp,
  Clock3,
  Copy,
  KeyRound,
  Link2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react'
import { Modal } from './Modal'
import { SecurityHistoryChart } from './SecurityHistoryChart'
import { useI18n } from '../state/I18nProvider'
import { pluralKey } from '../lib/i18n'
import {
  loadSecurityHistory,
  mergeSecuritySnapshot,
  recordSecuritySnapshot,
  type SecuritySnapshot,
} from '../lib/securityHistory'
import {
  securityTone,
  type SecurityCategory,
  type SecurityReport,
} from '../lib/security'

interface SecurityDialogProps {
  report: SecurityReport
  breachCheck: boolean
  breachStatus: 'idle' | 'checking' | 'done' | 'error'
  onCheckBreaches: () => void
  onOpenSettings: () => void
  onClose: () => void
  onOpenCategory: (category: SecurityCategory) => void
}

function CategoryButton({
  count,
  label,
  hint,
  category,
  onOpen,
}: {
  count: number
  label: string
  hint: string
  category: SecurityCategory
  onOpen: (category: SecurityCategory) => void
}) {
  return (
    <button
      type="button"
      className={`security-category ${count === 0 ? 'security-category--empty' : ''}`}
      onClick={() => onOpen(category)}
    >
      <strong>{count}</strong>
      <span>{label}</span>
      <small>{hint}</small>
    </button>
  )
}

function PointButton({
  count,
  label,
  hint,
  category,
  icon,
  onOpen,
}: {
  count: number
  label: string
  hint: string
  category: SecurityCategory
  icon: 'copy' | 'key' | 'clock' | 'help' | 'link' | 'breach'
  onOpen: (category: SecurityCategory) => void
}) {
  const Icon =
    icon === 'copy'
      ? Copy
      : icon === 'clock'
        ? Clock3
        : icon === 'help'
          ? CircleHelp
          : icon === 'link'
            ? Link2
            : icon === 'breach'
              ? ShieldAlert
              : KeyRound

  return (
    <button
      type="button"
      className="security-point"
      onClick={() => onOpen(category)}
      disabled={count === 0}
    >
      <Icon size={15} aria-hidden="true" />
      <span className="security-point__body">
        <span>{label}</span>
        <small>{hint}</small>
      </span>
      <strong>{count}</strong>
    </button>
  )
}

export function SecurityDialog({
  report,
  breachCheck,
  breachStatus,
  onCheckBreaches,
  onOpenSettings,
  onClose,
  onOpenCategory,
}: SecurityDialogProps) {
  const { t } = useI18n()
  const [initialHistory] = useState<SecuritySnapshot[]>(() => loadSecurityHistory())
  // L’instantané courant est dérivé du rapport ; l’effet ne fait que persister.
  const history = useMemo(
    () => mergeSecuritySnapshot(initialHistory, report),
    [initialHistory, report],
  )
  const tone = securityTone(report.score)
  const scoreLabel =
    report.score >= 90
      ? t('security.score.excellent')
      : report.score >= 75
        ? t('security.score.good')
        : report.score >= 50
          ? t('security.score.fair')
          : t('security.score.critical')
  const scoreReason =
    report.total === 0
      ? t('security.reason.noLogins')
      : report.affected === 0
        ? t('security.reason.noIssues')
        : report.breached.length > 0
        ? t(
            pluralKey(
              report.breached.length,
              'security.reason.breached.one',
              'security.reason.breached.other',
            ),
            { count: report.breached.length, total: report.total },
          )
        : report.weakOrReusedCount > 0
          ? t(
              pluralKey(
                report.weakOrReusedCount,
                'security.reason.weak.one',
                'security.reason.weak.other',
              ),
              { count: report.weakOrReusedCount, total: report.total },
            )
          : t(
              pluralKey(
                report.affected,
                'security.reason.issues.one',
                'security.reason.issues.other',
              ),
              { count: report.affected, total: report.total },
            )

  useEffect(() => {
    if (report.total === 0) return
    recordSecuritySnapshot(report)
  }, [report])
  const reusedCount = report.reused.reduce((total, group) => total + group.items.length, 0)
  const similarCount = report.similar.reduce((total, group) => total + group.items.length, 0)
  const duplicateCount = report.duplicates.reduce(
    (total, group) => total + group.items.length,
    0,
  )
  const capped = report.total > 0 && report.weakOrReusedCount > report.total / 2

  return (
    <Modal
      title={t('security.title')}
      description={t('security.description')}
      size="lg"
      onClose={onClose}
      footer={
        <button type="button" className="button button--secondary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className={`security-score security-score--${tone}`}>
        <div className="security-score__value">
          {report.total === 0 ? '—' : report.score}
          {report.total > 0 && <small>/100</small>}
        </div>
        <div className="security-score__body">
          <strong>
            {report.total === 0
              ? t('security.noLogins')
              : report.affected === 0
                ? t('security.excellent')
                : t(
                    pluralKey(
                      report.affected,
                      'security.affected.one',
                      'security.affected.other',
                    ),
                    { label: scoreLabel, count: report.affected },
                  )}
          </strong>
          <p>{scoreReason}</p>
          {capped && <p>{t('security.capped')}</p>}
          {report.total > 0 && (
            <>
              <div
                className="security-distribution"
                role="img"
                aria-label={t('security.distribution.aria', {
                  strong: report.strongCount,
                  medium: report.mediumCount,
                  weak: report.weak.length,
                })}
              >
                <span
                  className="security-distribution__strong"
                  style={{ flex: Math.max(report.strongCount, 0.001) }}
                />
                <span
                  className="security-distribution__medium"
                  style={{ flex: Math.max(report.mediumCount, 0.001) }}
                />
                <span
                  className="security-distribution__weak"
                  style={{ flex: Math.max(report.weak.length, 0.001) }}
                />
              </div>
              <div className="security-distribution__legend">
                <span>
                  <i className="security-dot security-dot--strong" />{' '}
                  {t('security.legend.strong')}
                </span>
                <span>
                  <i className="security-dot security-dot--medium" />{' '}
                  {t('security.legend.medium')}
                </span>
                <span>
                  <i className="security-dot security-dot--weak" />{' '}
                  {t('security.legend.weak')}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <SecurityHistoryChart history={history} />

      <div
        className={`security-breach ${
          report.breached.length > 0 ? 'security-breach--found' : ''
        }`}
      >
        <div className="security-breach__head">
          <ShieldAlert size={20} />
          <div>
            <strong>{t('security.breach.title')}</strong>
            <p>{t('security.breach.privacy')}</p>
          </div>
        </div>
        {breachCheck ? (
          <>
            <p className="security-breach__status">
              {breachStatus === 'checking'
                ? t('security.breach.checking')
                : breachStatus === 'error'
                  ? t('security.breach.error')
                  : breachStatus === 'done'
                    ? report.breached.length > 0
                      ? t(
                          pluralKey(
                            report.breached.length,
                            'security.breach.found.one',
                            'security.breach.found.other',
                          ),
                          { count: report.breached.length },
                        )
                      : t('security.breach.none')
                    : t('security.breach.idle')}
            </p>
            <button
              type="button"
              className="button button--secondary button--sm"
              onClick={onCheckBreaches}
              disabled={breachStatus === 'checking'}
            >
              {breachStatus === 'checking'
                ? t('security.breach.checking')
                : t('security.breach.check')}
            </button>
          </>
        ) : (
          <>
            <p className="security-breach__status">
              {t('security.breach.off')}
            </p>
            <button
              type="button"
              className="button button--secondary button--sm"
              onClick={onOpenSettings}
            >
              {t('security.breach.settings')}
            </button>
          </>
        )}
      </div>

      {report.affected === 0 && report.total > 0 && (
        <div className="security-empty">
          <ShieldCheck size={22} />
          <p>{t('security.empty')}</p>
        </div>
      )}

      {report.total > 0 && (
        <>
          <div className="security-primary" aria-label={t('security.primary')}>
            <CategoryButton
              count={report.weak.length}
              label={t('security.weak')}
              hint={t('security.weak.hint')}
              category="weak"
              onOpen={onOpenCategory}
            />
            <CategoryButton
              count={reusedCount}
              label={t('security.reused')}
              hint={t('security.reused.hint')}
              category="reused"
              onOpen={onOpenCategory}
            />
            <CategoryButton
              count={report.no2fa.length}
              label={t('security.no2fa')}
              hint={t('security.no2fa.hint')}
              category="no2fa"
              onOpen={onOpenCategory}
            />
          </div>

          <div className="security-points">
            <p className="security-points__title">{t('security.points')}</p>
            {report.breached.length > 0 && (
              <PointButton
                count={report.breached.length}
                label={t('security.breached')}
                hint={t('security.breached.hint')}
                category="breached"
                icon="breach"
                onOpen={onOpenCategory}
              />
            )}
            <PointButton
              count={similarCount}
              label={t('security.similar')}
              hint={t('security.similar.hint')}
              category="similar"
              icon="copy"
              onOpen={onOpenCategory}
            />
            <PointButton
              count={report.old.length}
              label={t('security.old')}
              hint={t('security.old.hint')}
              category="old"
              icon="clock"
              onOpen={onOpenCategory}
            />
            <PointButton
              count={report.incomplete.length}
              label={t('security.incomplete')}
              hint={t('security.incomplete.hint')}
              category="incomplete"
              icon="help"
              onOpen={onOpenCategory}
            />
            <PointButton
              count={duplicateCount}
              label={t('security.duplicates')}
              hint={t('security.duplicates.hint')}
              category="duplicates"
              icon="link"
              onOpen={onOpenCategory}
            />
          </div>
        </>
      )}

      {report.total > 0 && report.affected > 0 && (
        <p className="security-section__hint">
          <ShieldAlert size={13} /> {t('security.categoryHint')}
        </p>
      )}

      {report.total === 0 && (
        <p className="security-footnote">
          <ShieldQuestion size={13} /> {t('security.noLoginsHint')}
        </p>
      )}

      <p className="security-footnote">{t('security.footnote')}</p>
    </Modal>
  )
}
