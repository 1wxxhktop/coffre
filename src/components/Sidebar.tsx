import {
  CreditCard,
  FileText,
  History,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useMemo } from 'react'
import { Brand } from './Brand'
import { FILTER_LABELS, type ItemFilter } from '../lib/filters'
import type { VaultItem, VaultSummary } from '../lib/types'
import type { UsageMap } from '../lib/usage'
import { useSettings } from '../state/SettingsProvider'
import { analyzeSecurity, securityTone } from '../lib/security'

interface SidebarProps {
  vaults: VaultSummary[]
  items: VaultItem[]
  usage: UsageMap
  filter: ItemFilter
  vaultFilter: 'all' | string
  open: boolean
  onFilterChange: (filter: ItemFilter) => void
  onVaultChange: (vaultId: 'all' | string) => void
  onAddVault: () => void
  onRenameVault: (vault: VaultSummary) => void
  onDeleteVault: (vault: VaultSummary) => void
  onOpenSettings: () => void
  onOpenSecurity: () => void
  onLock: () => void
  onClose: () => void
}

const FILTERS: Array<{ id: ItemFilter; icon: LucideIcon }> = [
  { id: 'all', icon: KeyRound },
  { id: 'recent', icon: History },
  { id: 'favorites', icon: Star },
  { id: 'login', icon: KeyRound },
  { id: 'card', icon: CreditCard },
  { id: 'note', icon: FileText },
  { id: 'identity', icon: UserRound },
  { id: 'trash', icon: Trash2 },
]

export function Sidebar({
  vaults,
  items,
  usage,
  filter,
  vaultFilter,
  open,
  onFilterChange,
  onVaultChange,
  onAddVault,
  onRenameVault,
  onDeleteVault,
  onOpenSettings,
  onOpenSecurity,
  onLock,
  onClose,
}: SidebarProps) {
  const { settings } = useSettings()
  const report = useMemo(() => analyzeSecurity(items), [items])
  const tone = securityTone(report.score)
  const SecurityIcon = report.affected > 0 ? ShieldAlert : ShieldCheck
  const scopedItems = vaultFilter === 'all' ? items : items.filter((item) => item.vaultId === vaultFilter)

  const countFor = (id: ItemFilter): number => {
    if (id === 'trash') return scopedItems.filter((item) => item.deletedAt).length
    const active = scopedItems.filter((item) => !item.deletedAt)
    if (id === 'all') return active.length
    if (id === 'favorites') return active.filter((item) => item.favorite).length
    if (id === 'recent') return active.filter((item) => Boolean(usage[item.id])).length
    return active.filter((item) => item.type === id).length
  }

  return (
    <>
      <div
        className={`sidebar-backdrop ${open ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Navigation du coffre">
        <div className="sidebar__head" data-tauri-drag-region>
          <Brand subtitle="local-first" />
          <button
            type="button"
            className="icon-button sidebar__close"
            onClick={onClose}
            aria-label="Fermer le menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar__nav" aria-label="Filtres">
          <span className="sidebar__section-label">Bibliothèque</span>
          {FILTERS.map((entry) => {
            const Icon = entry.icon
            const count = countFor(entry.id)
            return (
              <button
                key={entry.id}
                type="button"
                className={`sidebar__item ${
                  filter === entry.id ? 'is-active' : ''
                } ${entry.id === 'trash' ? 'sidebar__item--trash' : ''}`}
                aria-current={filter === entry.id ? 'page' : undefined}
                onClick={() => {
                  onFilterChange(entry.id)
                  onClose()
                }}
              >
                <Icon size={17} />
                <span>{FILTER_LABELS[entry.id]}</span>
                {count > 0 && <span className="sidebar__count">{count}</span>}
              </button>
            )
          })}
        </nav>

        <div className="sidebar__vaults">
          <div className="sidebar__section-head">
            <span className="sidebar__section-label">Coffres</span>
            <button
              type="button"
              className="icon-button icon-button--sm"
              onClick={onAddVault}
              aria-label="Créer un coffre"
              title="Créer un coffre"
            >
              <Plus size={16} />
            </button>
          </div>

          <button
            type="button"
            className={`sidebar__item ${vaultFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => {
              onVaultChange('all')
              onClose()
            }}
          >
            <ShieldCheck size={17} />
            <span>Tous les coffres</span>
            <span className="sidebar__count">
              {items.filter((item) => !item.deletedAt).length}
            </span>
          </button>

          {vaults.map((vault) => (
            <div
              key={vault.id}
              className={`sidebar__vault ${vaultFilter === vault.id ? 'is-active' : ''}`}
            >
              <button
                type="button"
                className="sidebar__vault-main"
                aria-current={vaultFilter === vault.id ? 'page' : undefined}
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
                  aria-label={`Renommer ${vault.name}`}
                  title="Renommer"
                >
                  <Pencil size={14} />
                </button>
                {vaults.length > 1 && (
                  <button
                    type="button"
                    className="icon-button icon-button--sm icon-button--danger"
                    onClick={() => onDeleteVault(vault)}
                    aria-label={`Supprimer ${vault.name}`}
                    title="Supprimer"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>

        <div className="sidebar__footer">
          <button
            type="button"
            className={`sidebar__security sidebar__security--${tone}`}
            onClick={() => {
              onOpenSecurity()
              onClose()
            }}
            title={
              settings.autoLockMinutes > 0
                ? `Verrouillage automatique après ${settings.autoLockMinutes} min`
                : 'Verrouillage automatique désactivé'
            }
          >
            <SecurityIcon size={16} />
            <span>
              Sécurité
              <small>
                {report.total === 0
                  ? 'Aucune connexion analysée'
                  : `${report.score}/100 · ${
                      report.affected > 0 ? `${report.affected} à revoir` : 'aucun problème'
                    }`}
              </small>
            </span>
          </button>
          <div className="sidebar__footer-actions">
            <button type="button" className="sidebar__action" onClick={onOpenSettings}>
              <Settings size={17} />
              Réglages
            </button>
            <button type="button" className="sidebar__action sidebar__action--lock" onClick={onLock}>
              <LockKeyhole size={17} />
              Verrouiller
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
