import { useRef } from 'react'
import { CalendarClock, Check, Paperclip, ShieldAlert, Star } from 'lucide-react'
import { ItemIcon } from './ItemIcon'
import { useI18n } from '../state/I18nProvider'
import { pluralKey, type MessageKey } from '../lib/i18n'
import { formatDate } from '../lib/settings'
import {
  EXPIRY_HORIZON_DAYS,
  expiryBadgeLabel,
  expiryDescription,
  expiryTone,
  nextExpiry,
} from '../lib/expiry'
import type { ItemSecurityIssue } from '../lib/security'
import { itemSubtitle, type VaultItem } from '../lib/types'

const ISSUE_KEYS: Record<ItemSecurityIssue['category'], MessageKey> = {
  breached: 'security.issue.breached',
  weak: 'security.issue.weak',
  reused: 'security.issue.reused',
  similar: 'security.issue.similar',
  no2fa: 'security.issue.no2fa',
  old: 'security.issue.old',
  incomplete: 'security.issue.incomplete',
  duplicates: 'security.issue.duplicates',
}

const TYPE_KEYS: Record<VaultItem['type'], MessageKey> = {
  login: 'itemType.login',
  note: 'itemType.note',
  card: 'itemType.card',
  identity: 'itemType.identity',
  passkey: 'itemType.passkey',
  'ssh-key': 'itemType.sshKey',
  wifi: 'itemType.wifi',
  'api-credential': 'itemType.apiCredential',
  'software-license': 'itemType.softwareLicense',
  document: 'itemType.document',
}

interface ItemRowProps {
  item: VaultItem
  vaultName: string
  showVault: boolean
  selected: boolean
  selectable?: boolean
  issue?: ItemSecurityIssue | null
  checked?: boolean
  onSelect: () => void
  onLongPress?: () => void
}

/** Ligne compacte de la liste, dans l’esprit de la barre latérale 1Password. */
export function ItemRow({
  item,
  vaultName,
  showVault,
  selected,
  selectable = false,
  issue = null,
  checked = false,
  onSelect,
  onLongPress,
}: ItemRowProps) {
  const { t, intl } = useI18n()
  const expiry = item.deletedAt ? null : nextExpiry(item)
  const showExpiry = Boolean(expiry && expiry.daysLeft <= EXPIRY_HORIZON_DAYS)
  const timerRef = useRef<number | null>(null)
  const longPressRef = useRef(false)

  const clearLongPress = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const startLongPress = (pointerType: string) => {
    if (!onLongPress || pointerType === 'mouse') return
    clearLongPress()
    longPressRef.current = false
    timerRef.current = window.setTimeout(() => {
      longPressRef.current = true
      onLongPress()
    }, 500)
  }

  return (
    <button
      type="button"
      className={`item-row item-row--${item.type} ${
        item.deletedAt ? 'item-row--trash' : ''
      } ${selected ? 'is-selected' : ''}`}
      onClick={() => {
        if (longPressRef.current) {
          longPressRef.current = false
          return
        }
        onSelect()
      }}
      onPointerDown={(event) => startLongPress(event.pointerType)}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onPointerMove={clearLongPress}
      onContextMenu={(event) => {
        if (!longPressRef.current) return
        event.preventDefault()
        clearLongPress()
        longPressRef.current = false
      }}
      aria-current={!selectable && selected ? 'true' : undefined}
      aria-pressed={selectable ? checked : undefined}
      title={`${item.title} — ${t(TYPE_KEYS[item.type])}`}
    >
      {selectable && (
        <span className={`item-row__check ${checked ? 'is-checked' : ''}`} aria-hidden="true">
          {checked && <Check size={13} />}
        </span>
      )}
      <span className={`item-icon item-icon--${item.type}`}>
        <ItemIcon type={item.type} item={item} size={18} />
      </span>

      <span className="item-row__content">
        <span className="item-row__title">
          <span className="item-row__title-text">{item.title}</span>
          {item.favorite && (
            <Star
              size={12}
              className="item-row__favorite"
              fill="currentColor"
              aria-label={t('vault.favorite')}
            />
          )}
        </span>
        <span className="item-row__subtitle">
          {item.deletedAt
            ? t('vault.deletedOn', { date: formatDate(item.deletedAt, intl) })
            : itemSubtitle(item) || t(TYPE_KEYS[item.type])}
        </span>
      </span>

      <span className="item-row__meta">
        {showExpiry && expiry && (
          <span
            className={`expiry-badge expiry-badge--${expiryTone(expiry.daysLeft)}`}
            title={`${expiry.label} — ${expiryDescription(expiry.daysLeft)}`}
          >
            <CalendarClock size={11} aria-hidden="true" />
            {expiryBadgeLabel(expiry.daysLeft)}
          </span>
        )}
        {issue && (
          <span className="item-row__issue" title={t(ISSUE_KEYS[issue.category])}>
            <ShieldAlert size={11} aria-hidden="true" />
            <span className="item-row__issue-label" aria-hidden="true">
              {issue.shortLabel}
            </span>
            <span className="sr-only">{t(ISSUE_KEYS[issue.category])}</span>
          </span>
        )}
        {showVault && <span className="item-row__vault">{vaultName}</span>}
        {item.attachments.length > 0 && (
          <span
            className="item-row__attachment"
            title={t(
              pluralKey(
                item.attachments.length,
                'vault.attachments.one',
                'vault.attachments.other',
              ),
              { count: item.attachments.length },
            )}
          >
            <Paperclip size={12} />
            {item.attachments.length}
          </span>
        )}
      </span>
    </button>
  )
}
