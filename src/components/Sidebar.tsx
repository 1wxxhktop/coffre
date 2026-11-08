import { useEffect, useRef } from 'react'
import {
  CalendarClock,
  CreditCard,
  FileText,
  Fingerprint,
  KeySquare,
  Wifi,
  Code2,
  History,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Brand } from './Brand'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useI18n } from '../state/I18nProvider'
import { pluralKey, type MessageKey } from '../lib/i18n'
import type { ItemFilter } from '../lib/filters'
import type { VaultItem, VaultSummary } from '../lib/types'
import type { UsageMap } from '../lib/usage'
import { useSettings } from '../state/SettingsProvider'
import { securityTone, type SecurityReport } from '../lib/security'
import { collectExpiries } from '../lib/expiry'

interface SidebarProps {
  vaults: VaultSummary[]
  items: VaultItem[]
  usage: UsageMap
  filter: ItemFilter
  vaultFilter: 'all' | string
  open: boolean
  collapsed: boolean
  dashboardActive: boolean
  onOpenDashboard: () => void
  onToggleCollapsed: () => void
  onFilterChange: (filter: ItemFilter) => void
  onVaultChange: (vaultId: 'all' | string) => void
  onAddVault: () => void
  onRenameVault: (vault: VaultSummary) => void
  onDeleteVault: (vault: VaultSummary) => void
  onOpenSettings: () => void
  onOpenSecurity: () => void
  securityReport: SecurityReport
  syncPending: boolean
  onLock: () => void
  onClose: () => void
}

const FILTER_KEYS: Record<ItemFilter, MessageKey> = {
  all: 'filter.all',
  recent: 'filter.recent',
  expiring: 'filter.expiring',
  favorites: 'filter.favorites',
  login: 'filter.login',
  card: 'filter.card',
  note: 'filter.note',
  identity: 'filter.identity',
  passkey: 'filter.passkey',
  'ssh-key': 'filter.sshKey',
  wifi: 'filter.wifi',
  'api-credential': 'filter.apiCredential',
  trash: 'filter.trash',
}

const FILTERS: Array<{ id: ItemFilter; icon: LucideIcon }> = [
  { id: 'all', icon: KeyRound },
  { id: 'recent', icon: History },
  { id: 'expiring', icon: CalendarClock },
  { id: 'favorites', icon: Star },
  { id: 'login', icon: KeyRound },
  { id: 'card', icon: CreditCard },
  { id: 'note', icon: FileText },
  { id: 'identity', icon: UserRound },
  { id: 'passkey', icon: Fingerprint },
  { id: 'ssh-key', icon: KeySquare },
  { id: 'wifi', icon: Wifi },
  { id: 'api-credential', icon: Code2 },
  { id: 'trash', icon: Trash2 },
]

export function Sidebar({
  vaults,
  items,
  usage,
  filter,
  vaultFilter,
  open,
  collapsed,
  dashboardActive,
  onOpenDashboard,
  onToggleCollapsed,
  onFilterChange,
  onVaultChange,
  onAddVault,
  onRenameVault,
  onDeleteVault,
  onOpenSettings,
  onOpenSecurity,
  securityReport,
  syncPending,
  onLock,
  onClose,
}: SidebarProps) {
  const { settings } = useSettings()
  const { t } = useI18n()
  const compact = useMediaQuery('(max-width: 1099px)')
  const asideRef = useRef<HTMLElement>(null)
  const tone = securityTone(securityReport.score)
  const SecurityIcon = securityReport.affected > 0 ? ShieldAlert : ShieldCheck
  const scopedItems = vaultFilter === 'all' ? items : items.filter((item) => item.vaultId === vaultFilter)
  const expiringCount = collectExpiries(scopedItems).length

  const countFor = (id: ItemFilter): number => {
    if (id === 'trash') return scopedItems.filter((item) => item.deletedAt).length
    const active = scopedItems.filter((item) => !item.deletedAt)
    if (id === 'all') return active.length
    if (id === 'favorites') return active.filter((item) => item.favorite).length
    if (id === 'recent') return active.filter((item) => Boolean(usage[item.id])).length
    if (id === 'expiring') return expiringCount
    return active.filter((item) => item.type === id).length
  }

  // Menu mobile : piège à focus, Échap et restitution du focus à la fermeture.
  useEffect(() => {
    if (!compact || !open) return
    const aside = asideRef.current
    if (!aside) return
    const previous = document.activeElement as HTMLElement | null
    const focusable = () =>
      Array.from(
        aside.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null)

    const first = focusable()[0]
    first?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === firstItem || !aside.contains(active))) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && (active === lastItem || !aside.contains(active))) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [compact, onClose, open])

  return (
    <>
      <div
        className={`sidebar-backdrop ${open ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={asideRef}
        className={`sidebar ${open ? 'is-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}
        aria-label={t('sidebar.navigation')}
        inert={compact && !open ? true : undefined}
      >
        <div className="sidebar__head" data-tauri-drag-region>
          <Brand compact={collapsed && !compact} subtitle={t('sidebar.localFirst')} />
          <div className="sidebar__head-actions">
            <button
              type="button"
              className="icon-button sidebar__collapse"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
              title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
            >
              {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
            <button
              type="button"
              className="icon-button sidebar__close"
              onClick={onClose}
              aria-label={t('sidebar.close')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="sidebar__home">
          <span className="sidebar__section-label">{t('sidebar.home')}</span>
          <button
            type="button"
            className={`sidebar__item ${dashboardActive ? 'is-active' : ''}`}
            aria-current={dashboardActive ? 'page' : undefined}
            aria-label={t('sidebar.dashboard')}
            title={t('sidebar.dashboard')}
            onClick={onOpenDashboard}
          >
            <LayoutDashboard size={17} />
            <span>{t('sidebar.dashboard')}</span>
          </button>
        </div>

        <nav className="sidebar__nav" aria-label={t('sidebar.filters')}>
          <span className="sidebar__section-label">{t('sidebar.library')}</span>
          {FILTERS.map((entry) => {
            const Icon = entry.icon
            const count = countFor(entry.id)
            return (
              <button
                key={entry.id}
                type="button"
                className={`sidebar__item ${
                  !dashboardActive && filter === entry.id ? 'is-active' : ''
                } ${entry.id === 'trash' ? 'sidebar__item--trash' : ''}`}
                aria-current={
                  !dashboardActive && filter === entry.id ? 'page' : undefined
                }
                aria-label={t(FILTER_KEYS[entry.id])}
                title={t(FILTER_KEYS[entry.id])}
                onClick={() => {
                  onFilterChange(entry.id)
                  onClose()
                }}
              >
                <Icon size={17} />
                <span>{t(FILTER_KEYS[entry.id])}</span>
                {count > 0 && <span className="sidebar__count">{count}</span>}
              </button>
            )
          })}
        </nav>

        <div className="sidebar__vaults">
          <div className="sidebar__section-head">
            <span className="sidebar__section-label">{t('sidebar.vaults')}</span>
            <button
              type="button"
              className="icon-button icon-button--sm"
              onClick={onAddVault}
              aria-label={t('sidebar.createVault')}
              title={t('sidebar.createVault')}
            >
              <Plus size={16} />
            </button>
          </div>

          <button
            type="button"
            className={`sidebar__item ${
              !dashboardActive && vaultFilter === 'all' ? 'is-active' : ''
            }`}
            aria-label={t('sidebar.allVaults')}
            title={t('sidebar.allVaults')}
            onClick={() => {
              onVaultChange('all')
              onClose()
            }}
          >
            <ShieldCheck size={17} />
            <span>{t('sidebar.allVaults')}</span>
            <span className="sidebar__count">
              {items.filter((item) => !item.deletedAt).length}
            </span>
          </button>

          {vaults.map((vault) => (
            <div
              key={vault.id}
              className={`sidebar__vault ${
                !dashboardActive && vaultFilter === vault.id ? 'is-active' : ''
              }`}
            >
              <button
                type="button"
                className="sidebar__vault-main"
                aria-current={vaultFilter === vault.id ? 'page' : undefined}
                aria-label={vault.name}
                title={vault.name}
                onClick={() => {
                  onVaultChange(vault.id)
                  onClose()
                }}
              >
                <span className="sidebar__vault-dot" aria-hidden="true" />
                <span className="sidebar__vault-name">{vault.name}</span>
                <span className="sidebar__count">{vault.itemCount}</span>
              </button>
              <span className="sidebar__vault-actions">
                <button
                  type="button"
                  className="icon-button icon-button--sm"
                  onClick={() => onRenameVault(vault)}
                  aria-label={t('sidebar.renameVault', { name: vault.name })}
                  title={t('sidebar.rename')}
                >
                  <Pencil size={14} />
                </button>
                {vaults.length > 1 && (
                  <button
                    type="button"
                    className="icon-button icon-button--sm icon-button--danger"
                    onClick={() => onDeleteVault(vault)}
                    aria-label={t('sidebar.deleteVault', { name: vault.name })}
                    title={t('sidebar.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>

        <div className="sidebar__footer">
          {syncPending && (
            <button
              type="button"
              className="sidebar__security sidebar__security--warning"
              aria-label={t('sidebar.sync')}
              onClick={() => {
                onOpenSettings()
                onClose()
              }}
            >
              <RefreshCw size={16} />
              <span>
                {t('sidebar.sync')}
                <small>{t('sidebar.sync.copy')}</small>
              </span>
            </button>
          )}
          <button
            type="button"
            className={`sidebar__security sidebar__security--${tone}`}
            aria-label={`${t('sidebar.security.label')} — ${securityReport.score}/100`}
            onClick={() => {
              onOpenSecurity()
              onClose()
            }}
            title={
              settings.autoLockMinutes > 0
                ? t('sidebar.autoLock.after', { count: settings.autoLockMinutes })
                : t('sidebar.autoLock.off')
            }
          >
            <SecurityIcon size={16} />
            <span>
              {t('sidebar.security')}
              <small>
                {securityReport.total === 0
                  ? t('sidebar.security.ok')
                  : `${securityReport.score}/100 · ${
                      securityReport.affected > 0
                        ? t(
                            pluralKey(
                              securityReport.affected,
                              'sidebar.security.issues.one',
                              'sidebar.security.issues.other',
                            ),
                            { count: securityReport.affected },
                          )
                        : t('sidebar.security.noIssue')
                    }`}
              </small>
            </span>
          </button>
          <div className="sidebar__footer-actions">
            <button
              type="button"
              className="sidebar__action sidebar__action--settings"
              onClick={onOpenSettings}
              aria-label={t('sidebar.settings')}
              title={t('sidebar.settings')}
            >
              <Settings size={17} />
              <span>{t('sidebar.settings')}</span>
            </button>
            <button
              type="button"
              className="sidebar__action sidebar__action--lock"
              onClick={onLock}
              aria-label={t('sidebar.lock')}
              title={t('sidebar.lock')}
            >
              <LockKeyhole size={17} />
              <span>{t('sidebar.lock')}</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
