import { useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  Fingerprint,
  KeyRound,
  Link2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react'
import { Modal } from './Modal'
import { SecurityHistoryChart } from './SecurityHistoryChart'
import { useI18n } from '../state/I18nProvider'
import { pluralKey, type MessageKey } from '../lib/i18n'
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
import { securityActions } from '../lib/securityPlan'
import { buildSecurityReportExport } from '../lib/securityReport'
import { downloadFile } from '../lib/settings'

interface SecurityDialogProps {
  report: SecurityReport
  breachCheck: boolean
  breachStatus: 'idle' | 'checking' | 'done' | 'error'
  onCheckBreaches: () => void
  onOpenSettings: () => void
  onClose: () => void
  onOpenCategory: (category: SecurityCategory) => void
}

const ACTION_TEXT: Record<
  SecurityCategory,
  { label: MessageKey; hint: MessageKey }
> = {
  breached: { label: 'security.breached', hint: 'security.breached.hint' },
  reused: { label: 'security.reused', hint: 'security.reused.hint' },
  weak: { label: 'security.weak', hint: 'security.weak.hint' },
  no2fa: { label: 'security.no2fa', hint: 'security.no2fa.hint' },
  noHttps: { label: 'security.noHttps', hint: 'security.noHttps.hint' },
  old: { label: 'security.old', hint: 'security.old.hint' },
  similar: { label: 'security.similar', hint: 'security.similar.hint' },
  duplicates: { label: 'security.duplicates', hint: 'security.duplicates.hint' },
  incomplete: { label: 'security.incomplete', hint: 'security.incomplete.hint' },
  passkey: { label: 'security.passkey', hint: 'security.passkey.hint' },
}

const ACTION_ICON: Record<SecurityCategory, typeof KeyRound> = {
  breached: ShieldAlert,
  reused: Copy,
  weak: KeyRound,
  no2fa: ShieldQuestion,
  noHttps: ShieldAlert,
  old: Clock3,
  similar: Copy,
  duplicates: Link2,
  incomplete: CircleHelp,
  passkey: Fingerprint,
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
  const actions = useMemo(() => securityActions(report), [report])
  const tone = securityTone(report.score)

  const exportReport = () => {
    const payload = buildSecurityReportExport(report, history)
    const stamp = payload.generatedAt.slice(0, 10)
    downloadFile(
      JSON.stringify(payload, null, 2),
      `coffre-securite-${stamp}.json`,
      'application/json',
    )
  }
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
  const capped = report.total > 0 && report.weakOrReusedCount > report.total / 2

  return (
    <Modal
      title={t('security.title')}
      description={t('security.description')}
      size="lg"
      onClose={onClose}
      footer={
        <div className="modal__footer-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={exportReport}
          >
            <Download size={16} />
            {t('security.export')}
          </button>
          <button type="button" className="button button--secondary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
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

      {actions.length > 0 && (
        <section className="security-plan" aria-labelledby="security-plan-title">
          <div className="security-plan__head">
            <div>
              <p className="security-plan__title" id="security-plan-title">
                {t('security.plan.title')}
              </p>
              <p className="security-plan__copy">{t('security.plan.copy')}</p>
            </div>
            <span className="security-plan__total">
              {t(
                pluralKey(
                  actions.length,
                  'security.plan.action.one',
                  'security.plan.action.other',
                ),
                { count: actions.length },
              )}
            </span>
          </div>
          <ol className="security-plan__list">
            {actions.map((action, index) => {
              const Icon = ACTION_ICON[action.category]
              const text = ACTION_TEXT[action.category]
              return (
                <li key={action.category}>
                  <button
                    type="button"
                    className={`security-plan__item security-plan__item--${action.tone}`}
                    onClick={() => onOpenCategory(action.category)}
                  >
                    <span className="security-plan__rank" aria-hidden="true">
                      {index + 1}
                    </span>
                    <Icon size={17} aria-hidden="true" />
                    <span className="security-plan__body">
                      <strong>{t(text.label)}</strong>
                      <small>{t(text.hint)}</small>
                    </span>
                    <span className="security-plan__badge">{action.count}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      )}

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
