import {
  CalendarClock,
  ChevronRight,
  CircleHelp,
  Copy,
  CreditCard,
  Fingerprint,
  Folder,
  HardDrive,
  KeyRound,
  LayoutGrid,
  Link2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  Wand2,
} from 'lucide-react'
import { ItemIcon } from './ItemIcon'
import { useI18n } from '../state/I18nProvider'
import { formatDate, formatDateTime } from '../lib/settings'
import {
  expiryBadgeLabel,
  expiryTone,
  formatExpiryDate,
  type ExpiryEvent,
} from '../lib/expiry'
import {
  itemSecurityIssue,
  securityTone,
  type SecurityCategory,
  type SecurityReport,
} from '../lib/security'
import type { ItemFilter } from '../lib/filters'
import type { UsageMap } from '../lib/usage'
import {
  itemSubtitle,
  itemTypeLabel,
  type VaultItem,
  type VaultSummary,
} from '../lib/types'

interface DashboardProps {
  vaults: VaultSummary[]
  items: VaultItem[]
  usage: UsageMap
  securityReport: SecurityReport
  expiryEvents: ExpiryEvent[]
  readOnly: boolean
  syncPending: boolean
  lastSavedAt: string | null
  onNewItem: () => void
  onGeneratePassword: () => void
  onOpenSecurity: () => void
  onOpenItem: (itemId: string) => void
  onOpenCategory: (category: SecurityCategory) => void
  onOpenFilter: (filter: ItemFilter) => void
  onOpenVault: (vaultId: string) => void
  onAddVault: () => void
  onOpenSettings: () => void
}

interface WatchCategory {
  category: SecurityCategory
  label: string
  hint: string
  count: number
  icon: typeof ShieldAlert
  tone: 'danger' | 'warning' | 'neutral'
}

export function Dashboard({
  vaults,
  items,
  usage,
  securityReport,
  expiryEvents,
  readOnly,
  syncPending,
  lastSavedAt,
  onNewItem,
  onGeneratePassword,
  onOpenSecurity,
  onOpenItem,
  onOpenCategory,
  onOpenFilter,
  onOpenVault,
  onAddVault,
  onOpenSettings,
}: DashboardProps) {
  const { tt } = useI18n()
  const activeItems = items.filter((item) => !item.deletedAt)
  const trashed = items.length - activeItems.length
  const logins = activeItems.filter((item) => item.type === 'login')
  const passkeys = activeItems.filter((item) => item.type === 'passkey')
  const cards = activeItems.filter((item) => item.type === 'card')
  const favorites = activeItems.filter((item) => item.favorite)
  const reusedCount = securityReport.reused.reduce(
    (total, group) => total + group.items.length,
    0,
  )
  const similarCount = securityReport.similar.reduce(
    (total, group) => total + group.items.length,
    0,
  )
  const duplicateCount = securityReport.duplicates.reduce(
    (total, group) => total + group.items.length,
    0,
  )

  const watchlist: WatchCategory[] = [
    {
      category: 'weak',
      label: 'Mots de passe faibles',
      hint: 'Courts ou faciles à deviner',
      count: securityReport.weak.length,
      icon: ShieldAlert,
      tone: 'danger',
    },
    {
      category: 'reused',
      label: 'Mots de passe réutilisés',
      hint: 'Un même secret pour plusieurs comptes',
      count: reusedCount,
      icon: Copy,
      tone: 'warning',
    },
    {
      category: 'no2fa',
      label: tt('Sans double authentification'),
      hint: tt('Le compte dépend du seul mot de passe'),
      count: securityReport.no2fa.length,
      icon: KeyRound,
      tone: 'warning',
    },
    {
      category: 'passkey',
      label: tt('Passkey disponible'),
      hint: tt('Connexion sans mot de passe possible'),
      count: securityReport.passkeyAvailable.length,
      icon: Fingerprint,
      tone: 'neutral',
    },
    {
      category: 'noHttps',
      label: tt('Sites sans HTTPS'),
      hint: tt('URL servie en clair sur le réseau'),
      count: securityReport.noHttps.length,
      icon: ShieldAlert,
      tone: 'danger',
    },
    {
      category: 'old',
      label: 'Non modifiés depuis un an',
      hint: 'À vérifier même sans fuite connue',
      count: securityReport.old.length,
      icon: CalendarClock,
      tone: 'neutral',
    },
    {
      category: 'incomplete',
      label: 'Connexions incomplètes',
      hint: 'Identifiant, mot de passe ou URL manquant',
      count: securityReport.incomplete.length,
      icon: CircleHelp,
      tone: 'neutral',
    },
    {
      category: 'duplicates',
      label: 'Sites en doublon',
      hint: 'Plusieurs éléments pour le même site',
      count: duplicateCount,
      icon: Link2,
      tone: 'neutral',
    },
    {
      category: 'similar',
      label: 'Variantes proches',
      hint: 'Des secrets qui se ressemblent trop',
      count: similarCount,
      icon: Copy,
      tone: 'neutral',
    },
  ]

  const priorityItems: VaultItem[] = []
  const seen = new Set<string>()
  for (const item of [
    ...securityReport.weak,
    ...securityReport.reused.flatMap((group) => group.items),
    ...securityReport.no2fa,
    ...securityReport.noHttps,
    ...securityReport.old,
    ...securityReport.incomplete,
    ...securityReport.duplicates.flatMap((group) => group.items),
  ]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    priorityItems.push(item)
    if (priorityItems.length >= 4) break
  }

  const recentItems = [...activeItems]
    .sort(
      (a, b) =>
        (usage[b.id] ?? 0) - (usage[a.id] ?? 0) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 5)

  const expiring = expiryEvents.slice(0, 5)
  const scoreTone = securityTone(securityReport.score)
  const circumference = 2 * Math.PI * 48
  const dashOffset = circumference * (1 - securityReport.score / 100)

  const itemVault = new Map(items.map((item) => [item.id, item.vaultId]))
  const issuesByVault = new Map<string, number>()
  for (const itemId of securityReport.issueIds) {
    const vaultId = itemVault.get(itemId)
    if (!vaultId) continue
    issuesByVault.set(vaultId, (issuesByVault.get(vaultId) ?? 0) + 1)
  }

  const stats: Array<{
    id: string
    label: string
    value: number
    icon: typeof KeyRound
    filter: ItemFilter
  }> = [
    { id: 'all', label: 'Éléments', value: activeItems.length, icon: LayoutGrid, filter: 'all' },
    { id: 'logins', label: 'Connexions', value: logins.length, icon: KeyRound, filter: 'login' },
    { id: 'passkeys', label: 'Passkeys', value: passkeys.length, icon: Fingerprint, filter: 'passkey' },
    { id: 'cards', label: 'Cartes', value: cards.length, icon: CreditCard, filter: 'card' },
    { id: 'favorites', label: 'Favoris', value: favorites.length, icon: Star, filter: 'favorites' },
    { id: 'trash', label: 'Corbeille', value: trashed, icon: Trash2, filter: 'trash' },
  ]

  return (
    <div className="dashboard">
      <section className="dashboard__hero">
        <div className="dashboard__hero-copy">
          <span className="eyebrow">{tt('Vue d’ensemble')}</span>
          <h2>
            {activeItems.length === 0
              ? 'Bienvenue dans votre coffre.'
              : 'Tout votre coffre, en un coup d’œil.'}
          </h2>
          <p>
            {activeItems.length === 0
              ? 'Ajoutez votre première connexion pour voir apparaître votre santé de sécurité, vos échéances et vos éléments récents.'
              : `${activeItems.length} élément${activeItems.length > 1 ? 's' : ''} dans ${vaults.length} coffre${
                  vaults.length > 1 ? 's' : ''
                }, ${favorites.length} favori${favorites.length > 1 ? 's' : ''}. Tout reste chiffré sur cet appareil.`}
          </p>
          <div className="dashboard__quick-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={onNewItem}
              disabled={readOnly}
            >
              <Plus size={17} />
              Nouvel élément
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={onGeneratePassword}
            >
              <Wand2 size={17} />
              Générer un mot de passe
            </button>
            <button type="button" className="button button--ghost" onClick={onOpenSecurity}>
              <ShieldCheck size={17} />
              Voir la sécurité
            </button>
          </div>
        </div>

        <div className={`dashboard__health dashboard__health--${scoreTone}`}>
          <div className="dashboard__ring-wrap">
            <svg viewBox="0 0 120 120" className="dashboard__ring" aria-hidden="true">
              <circle className="dashboard__ring-track" cx="60" cy="60" r="48" />
              <circle
                className="dashboard__ring-value"
                cx="60"
                cy="60"
                r="48"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="dashboard__ring-label">
              <strong>{securityReport.total === 0 ? '—' : securityReport.score}</strong>
              {securityReport.total > 0 && <span>/100</span>}
            </div>
          </div>
          <div className="dashboard__health-copy">
            <span className="dashboard__health-kicker">{tt('Santé du coffre')}</span>
            <strong>
              {securityReport.total === 0
                ? 'Aucune connexion analysée'
                : securityReport.scoreLabel}
            </strong>
            <p>{securityReport.scoreReason}</p>
            <button type="button" className="link-button" onClick={onOpenSecurity}>
              Voir le détail
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>

      <section
        className="dashboard__stats"
        aria-label={tt('Statistiques du coffre')}
      >
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <button
              key={stat.id}
              type="button"
              className="dashboard-stat"
              onClick={() => onOpenFilter(stat.filter)}
            >
              <span className="dashboard-stat__icon">
                <Icon size={18} />
              </span>
              <span className="dashboard-stat__body">
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </span>
            </button>
          )
        })}
      </section>

      <div className="dashboard__grid">
        <div className="dashboard__main">
          <section className="dashboard-card">
            <header className="dashboard-card__head">
              <div>
                <h3>{tt('Points d’attention')}</h3>
                <p>
                  {tt('Les signaux faibles de votre coffre, classés par priorité.')}
                </p>
              </div>
              <button type="button" className="link-button" onClick={onOpenSecurity}>
                Tableau de bord
                <ChevronRight size={14} />
              </button>
            </header>
            <div className="dashboard-watch">
              {watchlist.map((entry) => {
                const Icon = entry.icon
                return (
                  <button
                    key={entry.category}
                    type="button"
                    className={`dashboard-watch__row ${
                      entry.count === 0 ? 'is-empty' : ''
                    }`}
                    onClick={() => onOpenCategory(entry.category)}
                    disabled={entry.count === 0}
                  >
                    <span
                      className={`dashboard-watch__icon dashboard-watch__icon--${entry.tone}`}
                    >
                      <Icon size={16} />
                    </span>
                    <span className="dashboard-watch__body">
                      <strong>{entry.label}</strong>
                      <small>{entry.hint}</small>
                    </span>
                    <span className="dashboard-watch__count">{entry.count}</span>
                    <ChevronRight size={15} className="dashboard-watch__chevron" />
                  </button>
                )
              })}
            </div>
          </section>

          <section className="dashboard-card">
            <header className="dashboard-card__head">
              <div>
                <h3>{tt('À traiter en priorité')}</h3>
                <p>{tt('Les éléments qui exposent le plus votre coffre.')}</p>
              </div>
              <button
                type="button"
                className="link-button"
                onClick={onOpenSecurity}
              >
                Tout voir
                <ChevronRight size={14} />
              </button>
            </header>
            {priorityItems.length > 0 ? (
              <div className="dashboard-items">
                {priorityItems.map((item) => {
                  const issue = itemSecurityIssue(item, securityReport)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="dashboard-item"
                      onClick={() => onOpenItem(item.id)}
                    >
                      <span className={`item-icon item-icon--${item.type}`}>
                        <ItemIcon type={item.type} item={item} size={17} />
                      </span>
                      <span className="dashboard-item__body">
                        <strong>{item.title}</strong>
                        <small>
                          {itemSubtitle(item) || itemTypeLabel(item.type)} ·{' '}
                          {formatDate(item.updatedAt)}
                        </small>
                      </span>
                      {issue && (
                        <span className="dashboard-item__issue">{issue.label}</span>
                      )}
                      <ChevronRight size={15} className="dashboard-item__chevron" />
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="dashboard-empty">
                <ShieldCheck size={20} />
                <p>
                  {securityReport.total === 0
                    ? 'Ajoutez une connexion pour lancer l’analyse locale.'
                    : 'Aucun point critique à traiter. Votre coffre est à jour.'}
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="dashboard__aside">
          <section className="dashboard-card">
            <header className="dashboard-card__head">
              <div>
                <h3>{tt('Stockage')}</h3>
                <p>{tt('Chiffré localement, sans serveur.')}</p>
              </div>
            </header>
            <div className="dashboard-status">
              <span className={`dashboard-status__icon ${syncPending ? 'is-warning' : ''}`}>
                {syncPending ? <RefreshCw size={17} /> : <HardDrive size={17} />}
              </span>
              <span className="dashboard-status__body">
                <strong>
                  {tt(syncPending ? 'Synchronisation en attente' : 'Coffre local à jour')}
                </strong>
                <small>
                  {lastSavedAt
                    ? `${tt('Dernière écriture :')} ${formatDateTime(lastSavedAt)}`
                    : tt('Aucune écriture locale')}
                </small>
              </span>
              {syncPending && (
                <button
                  type="button"
                  className="button button--secondary button--sm"
                  onClick={onOpenSettings}
                >
                  {tt('Réglages')}
                </button>
              )}
            </div>
            <p className="dashboard-storage-note">
              {tt('3 sauvegardes locales tournantes · AES-256-GCM')}
            </p>
          </section>

          <section className="dashboard-card">
            <header className="dashboard-card__head">
              <div>
                <h3>{tt('Récents')}</h3>
                <p>{tt('Vos derniers éléments utilisés.')}</p>
              </div>
              <button type="button" className="link-button" onClick={() => onOpenFilter('recent')}>
                Tout voir
                <ChevronRight size={14} />
              </button>
            </header>
            {recentItems.length > 0 ? (
              <div className="dashboard-items">
                {recentItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="dashboard-item dashboard-item--compact"
                    onClick={() => onOpenItem(item.id)}
                  >
                    <span className={`item-icon item-icon--${item.type}`}>
                      <ItemIcon type={item.type} item={item} size={15} />
                    </span>
                    <span className="dashboard-item__body">
                      <strong>{item.title}</strong>
                      <small>{itemSubtitle(item) || itemTypeLabel(item.type)}</small>
                    </span>
                    <ChevronRight size={14} className="dashboard-item__chevron" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="dashboard-empty">
                <Folder size={20} />
                <p>{tt('Vos éléments récemment ouverts apparaîtront ici.')}</p>
              </div>
            )}
          </section>

          <section className="dashboard-card">
            <header className="dashboard-card__head">
              <div>
                <h3>{tt('Coffres')}</h3>
                <p>{tt('Votre bibliothèque locale.')}</p>
              </div>
              <button type="button" className="icon-button icon-button--sm" onClick={onAddVault} aria-label={tt('Créer un coffre')}>
                <Plus size={15} />
              </button>
            </header>
            <div className="dashboard-vaults">
              {vaults.map((vault) => {
                const issues = issuesByVault.get(vault.id) ?? 0
                return (
                  <button
                    key={vault.id}
                    type="button"
                    className="dashboard-vault"
                    onClick={() => onOpenVault(vault.id)}
                  >
                    <span className="dashboard-vault__dot" aria-hidden="true" />
                    <span className="dashboard-vault__body">
                      <strong>{vault.name}</strong>
                      <small>
                        {vault.itemCount === 0
                          ? tt('Aucun élément')
                          : `${vault.itemCount} élément${vault.itemCount > 1 ? 's' : ''}`}
                        {issues > 0 ? ` · ${issues} à revoir` : ' · aucun problème'}
                      </small>
                    </span>
                    <ChevronRight size={14} className="dashboard-item__chevron" />
                  </button>
                )
              })}
            </div>
          </section>

          <section className="dashboard-card">
            <header className="dashboard-card__head">
              <div>
                <h3>{tt('Échéances')}</h3>
                <p>{tt('Les 60 prochains jours.')}</p>
              </div>
              <button
                type="button"
                className="link-button"
                onClick={() => onOpenFilter('expiring')}
              >
                Tout voir
                <ChevronRight size={14} />
              </button>
            </header>
            {expiring.length > 0 ? (
              <div className="dashboard-items">
                {expiring.map((event) => (
                  <button
                    key={`${event.item.id}-${event.kind}-${event.date}`}
                    type="button"
                    className="dashboard-item dashboard-item--compact"
                    onClick={() => onOpenItem(event.item.id)}
                  >
                    <span className="dashboard-item__icon">
                      <CalendarClock size={15} />
                    </span>
                    <span className="dashboard-item__body">
                      <strong>{event.item.title}</strong>
                      <small>
                        {event.label} · {formatExpiryDate(event.date)}
                      </small>
                    </span>
                    <span
                      className={`expiry-badge expiry-badge--${expiryTone(event.daysLeft)}`}
                    >
                      {expiryBadgeLabel(event.daysLeft)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="dashboard-empty">
                <CalendarClock size={20} />
                <p>{tt('Aucune échéance dans les 60 prochains jours.')}</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
