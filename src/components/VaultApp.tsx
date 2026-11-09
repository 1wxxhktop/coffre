import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  CalendarClock,
  Check,
  FolderOpen,
  History,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Menu as MenuIcon,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Dashboard } from './Dashboard'
import { ColumnResizer } from './ColumnResizer'
import { Menu } from './Menu'
import {
  FILTER_MESSAGE_KEYS,
  SORT_MESSAGE_KEYS,
  type ItemFilter,
  type ItemSort,
} from '../lib/filters'
import { ItemRow } from './ItemRow'
import { AutoTypePicker } from './AutoTypePicker'
import { SshAgentBridge } from './SshAgentBridge'
import { VaultFormDialog } from './VaultFormDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { DialogLoading, PanelLoading } from './DialogFallback'
import { ExtensionBridge } from './ExtensionBridge'
import { useVault } from '../state/VaultProvider'
import { useSettings } from '../state/SettingsProvider'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { pluralKey, type MessageKey } from '../lib/i18n'
import { useAutoLock } from '../hooks/useAutoLock'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { LAYOUT_LIMITS, useLayoutPreferences } from '../hooks/useLayoutPreferences'
import { loadUsage, recordItemUsage, type UsageMap } from '../lib/usage'
import { dateGroupInfo, groupItemsByDate, type DateGroup } from '../lib/dateGroups'
import { formatMonthYear } from '../lib/settings'
import {
  analyzeSecurity,
  itemSecurityIssue,
  securityCategoryItems,
  SECURITY_CATEGORY_LABELS,
  type SecurityCategory,
} from '../lib/security'
import { collectExpiries } from '../lib/expiry'
import { loadSiteSecurity, siteSecurityForHost } from '../lib/siteSecurity'
import { scanBreaches } from '../lib/breach'
import { notifyExpiringItems } from '../lib/notifications'
import {
  itemSubtitle,
  itemTypeLabel,
  type ItemType,
  type VaultItem,
  type VaultSummary,
} from '../lib/types'
import { isTauriRuntime } from '../lib/external'
import type { StateUpdate } from '../lib/stateUpdate'

// Les dialogues lourds sont chargés à l’ouverture : le premier écran ne paie
// ni les importeurs de coffres tiers, ni l’éditeur d’élément complet.
const ItemDialog = lazy(() =>
  import('./ItemDialog').then((module) => ({ default: module.ItemDialog })),
)
const SettingsDialog = lazy(() =>
  import('./SettingsDialog').then((module) => ({ default: module.SettingsDialog })),
)
const SecurityDialog = lazy(() =>
  import('./SecurityDialog').then((module) => ({ default: module.SecurityDialog })),
)
const GeneratorDialog = lazy(() =>
  import('./GeneratorDialog').then((module) => ({ default: module.GeneratorDialog })),
)

function createTypeForFilter(filter: ItemFilter): ItemType {
  return filter === 'all' ||
    filter === 'favorites' ||
    filter === 'recent' ||
    filter === 'expiring' ||
    filter === 'trash'
    ? 'login'
    : filter
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

const GROUP_BY_DATE_KEY = 'coffre:ui:group-by-date'
const EMPTY_BREACHES: ReadonlySet<string> = new Set()
const EMPTY_SELECTION: Set<string> = new Set()

function loadGroupByDate(): boolean {
  try {
    return localStorage.getItem(GROUP_BY_DATE_KEY) !== '0'
  } catch {
    return true
  }
}

function searchableText(item: ReturnType<typeof useVault>['items'][number]): string {
  const common = [
    item.title,
    itemSubtitle(item),
    item.tags.join(' '),
    item.notes,
    item.customFields.map((field) => `${field.label} ${field.value}`).join(' '),
    item.attachments.map((attachment) => attachment.name).join(' '),
  ]

  switch (item.type) {
    case 'login':
      common.push(item.username, item.urls.join(' '))
      break
    case 'card':
      common.push(item.cardholder, item.number.slice(-4), item.brand)
      break
    case 'identity':
      common.push(
        item.firstName,
        item.lastName,
        item.email,
        item.phone,
        item.city,
        item.country,
      )
      break
    case 'note':
      break
    case 'passkey':
      common.push(item.rpId, item.userName)
      break
    case 'ssh-key':
      common.push(item.comment, item.fingerprint, item.publicKey)
      break
    case 'wifi':
      common.push(item.ssid, item.security)
      break
    case 'api-credential':
      common.push(item.keyId, item.environment, item.endpoint)
      break
    case 'software-license':
      common.push(item.licensedTo, item.version, item.website)
      break
    case 'document':
      common.push(item.issuer, item.documentNumber, item.documentKind)
      break
  }

  return normalize(common.join(' '))
}

const TYPE_ORDER: ItemType[] = ['login', 'card', 'note', 'identity', 'passkey', 'ssh-key', 'wifi', 'api-credential', 'software-license', 'document']

const SECURITY_CATEGORY_KEYS: Record<SecurityCategory, MessageKey> = {
  breached: 'security.category.breached',
  weak: 'security.category.weak',
  reused: 'security.category.reused',
  similar: 'security.category.similar',
  no2fa: 'security.category.no2fa',
  passkey: 'security.category.passkey',
  noHttps: 'security.category.noHttps',
  old: 'security.category.old',
  incomplete: 'security.category.incomplete',
  duplicates: 'security.category.duplicates',
}

export function VaultApp() {
  const {
    vaults,
    items,
    warnings,
    dismissWarnings,
    readOnly,
    file,
    syncPending,
    lock,
    deleteVault,
    emptyTrash,
    trashItems,
    favoriteItems,
  } = useVault()
  const { settings } = useSettings()
  const { t, intl } = useI18n()
  const { toast } = useToast()
  const layout = useLayoutPreferences()
  const desktopLayout = useMediaQuery('(min-width: 1100px)')
  const splitRef = useRef<HTMLElement>(null)
  const [splitWidth, setSplitWidth] = useState(0)
  const listMax = desktopLayout
    ? Math.max(
        LAYOUT_LIMITS.listMin,
        Math.min(LAYOUT_LIMITS.listMax, Math.floor(splitWidth - 360)),
      )
    : LAYOUT_LIMITS.listMax
  const shellStyle = {
    '--sidebar-width': `${layout.sidebarWidth}px`,
    '--list-width': `${layout.listWidth}px`,
  } as unknown as CSSProperties

  const [view, setView] = useState<'vault' | 'dashboard'>('dashboard')
  const [filter, setFilter] = useState<ItemFilter>('all')
  const [vaultFilter, setVaultFilter] = useState<'all' | string>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ItemSort>('name-asc')
  const [groupByDate, setGroupByDate] = useState(loadGroupByDate)
  const [usage, setUsage] = useState<UsageMap>(() => loadUsage())
  const [selectionState, setSelectionState] = useState<{
    scope: string
    mode: boolean
    ids: Set<string>
  }>({ scope: '', mode: false, ids: EMPTY_SELECTION })
  const [limitState, setLimitState] = useState({ scope: '', value: 200 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createType, setCreateType] = useState<ItemType | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [securityCategory, setSecurityCategory] = useState<SecurityCategory | null>(null)
  // Un filtre de coffre supprimé retombe sur « tous les coffres » sans effet
  // de synchronisation.
  const activeVaultFilter =
    vaultFilter === 'all' || vaults.some((vault) => vault.id === vaultFilter)
      ? vaultFilter
      : 'all'
  const selectionScope = `${filter}\u0000${activeVaultFilter}\u0000${search}\u0000${securityCategory ?? ''}`
  const listScope = `${selectionScope}\u0000${sort}`
  const activeSelection =
    selectionState.scope === selectionScope ? selectionState : null
  const selectionMode = activeSelection?.mode ?? false
  const rawSelectedIds = activeSelection?.ids ?? EMPTY_SELECTION
  const selectedIds = useMemo(() => {
    if (rawSelectedIds.size === 0) return rawSelectedIds
    const next = new Set(
      [...rawSelectedIds].filter((id) =>
        items.some((item) => item.id === id && !item.deletedAt),
      ),
    )
    return next.size === rawSelectedIds.size ? rawSelectedIds : next
  }, [items, rawSelectedIds])
  // Changer de filtre ou de recherche repart d’une liste complète.
  const visibleLimit = limitState.scope === listScope ? limitState.value : 200
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [vaultForm, setVaultForm] = useState<
    { mode: 'create' } | { mode: 'rename'; vault: VaultSummary } | null
  >(null)
  const [vaultToDelete, setVaultToDelete] = useState<VaultSummary | null>(null)
  const [showEmptyTrash, setShowEmptyTrash] = useState(false)
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const breachRevision = useMemo(
    () =>
      items
        .filter((item) => item.type === 'login' && !item.deletedAt)
        .map((item) => `${item.id}:${item.updatedAt}`)
        .join('|'),
    [items],
  )
  // L’état de vérification est lié à la révision des éléments : un changement
  // de coffre ou de réglage invalide implicitement les résultats précédents.
  const [breachState, setBreachState] = useState<{
    scope: string
    ids: ReadonlySet<string>
    status: 'idle' | 'checking' | 'done' | 'error'
  }>({ scope: '', ids: EMPTY_BREACHES, status: 'idle' })
  const breachScope = settings.breachCheck ? breachRevision : ''
  const breachedIds = breachState.scope === breachScope ? breachState.ids : EMPTY_BREACHES
  const breachStatus = breachState.scope === breachScope ? breachState.status : 'idle'
  const breachScopeRef = useRef(breachScope)
  useEffect(() => {
    breachScopeRef.current = breachScope
  }, [breachScope])

  const [siteSecurityRevision, setSiteSecurityRevision] = useState(0)
  useEffect(() => {
    let active = true
    void loadSiteSecurity().then(() => {
      if (active) setSiteSecurityRevision((value) => value + 1)
    })
    return () => {
      active = false
    }
  }, [])
  const siteSecurityLookup = useCallback(
    (host: string) => {
      void siteSecurityRevision
      return siteSecurityForHost(host)
    },
    [siteSecurityRevision],
  )
  const securityReport = useMemo(
    () => analyzeSecurity(items, undefined, breachedIds, siteSecurityLookup),
    [items, breachedIds, siteSecurityLookup],
  )

  const checkBreaches = useCallback(async () => {
    if (!settings.breachCheck || breachStatus === 'checking') return
    const scope = breachScope
    setBreachState({ scope, ids: breachedIds, status: 'checking' })
    try {
      const result = await scanBreaches(items)
      if (scope !== breachScopeRef.current) return
      setBreachState({ scope, ids: new Set(result.breachedItemIds), status: 'done' })
    } catch {
      if (scope !== breachScopeRef.current) return
      setBreachState({ scope, ids: breachedIds, status: 'error' })
    }
  }, [breachScope, breachStatus, breachedIds, items, settings.breachCheck])
  const securityIssueById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof itemSecurityIssue>>()
    for (const item of items) {
      const issue = itemSecurityIssue(item, securityReport)
      if (issue) map.set(item.id, issue)
    }
    return map
  }, [items, securityReport])
  const expiryEvents = useMemo(() => collectExpiries(items), [items])
  const expiryByItem = useMemo(() => {
    const map = new Map<string, (typeof expiryEvents)[number]>()
    for (const event of expiryEvents) {
      if (!map.has(event.item.id)) map.set(event.item.id, event)
    }
    return map
  }, [expiryEvents])
  const setSelectedIds = useCallback(
    (update: StateUpdate<Set<string>>) => {
      setSelectionState((previous) => {
        const base =
          previous.scope === selectionScope
            ? previous
            : { scope: selectionScope, mode: false, ids: EMPTY_SELECTION }
        return {
          ...base,
          ids: typeof update === 'function' ? update(base.ids) : update,
        }
      })
    },
    [selectionScope],
  )
  const setSelectionMode = useCallback(
    (update: StateUpdate<boolean>) => {
      setSelectionState((previous) => {
        const base =
          previous.scope === selectionScope
            ? previous
            : { scope: selectionScope, mode: false, ids: EMPTY_SELECTION }
        return {
          ...base,
          mode: typeof update === 'function' ? update(base.mode) : update,
        }
      })
    },
    [selectionScope],
  )
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showBulkTrash, setShowBulkTrash] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const element = splitRef.current
    if (!element || !desktopLayout) return
    const observer = new ResizeObserver(([entry]) => {
      setSplitWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [desktopLayout, view])

  useEffect(() => {
    if (!desktopLayout || splitWidth === 0) return
    if (layout.listWidth > listMax) layout.setListWidth(listMax)
  }, [desktopLayout, layout, listMax, splitWidth])

  useAutoLock(
    settings.autoLockMinutes,
    settings.lockOnHide,
    settings.lockOnFocusLoss,
    lock,
  )

  const expiryEventsRef = useRef(expiryEvents)
  useEffect(() => {
    expiryEventsRef.current = expiryEvents
  }, [expiryEvents])

  // Rappels à l’ouverture ou après une modification : une seule notification
  // par échéance et par jour, sans requête réseau.
  useEffect(() => {
    if (!settings.expiryNotifications || expiryEvents.length === 0) return
    const due = notifyExpiringItems(expiryEvents)
    if (due.length > 0) {
      toast(
        t(
          pluralKey(due.length, 'vault.expiryToast.one', 'vault.expiryToast.other'),
          { count: due.length },
        ),
        'info',
      )
    }
  }, [settings.expiryNotifications, expiryEvents, t, toast])

  // Vérification périodique tant que l’application reste ouverte.
  useEffect(() => {
    if (!settings.expiryNotifications) return
    const timer = window.setInterval(() => {
      const due = notifyExpiringItems(expiryEventsRef.current)
      if (due.length > 0) {
        toast(
          t(
            pluralKey(due.length, 'vault.expiryToast.one', 'vault.expiryToast.other'),
            { count: due.length },
          ),
          'info',
        )
      }
    }, 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [settings.expiryNotifications, t, toast])

  /** Enregistre l’ouverture ou la copie d’un élément pour la vue « Récents ». */
  const markUsed = useCallback((itemId: string) => {
    setUsage(recordItemUsage(itemId))
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) return
    let unlisten: (() => void) | undefined
    void listen('coffre:quick-search', () => {
      searchRef.current?.focus()
      searchRef.current?.select()
    }).then((cleanup) => {
      unlisten = cleanup
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const dialogOpen = Boolean(document.querySelector('.modal-overlay'))
      const target = event.target as HTMLElement | null
      const typing =
        target?.matches('input, textarea, select, [contenteditable="true"]') ?? false

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !dialogOpen) {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }

      if (event.key === 'Escape' && !dialogOpen && !typing) {
        if (createType) {
          setCreateType(null)
          return
        }
        setSelectedId(null)
        setSidebarOpen(false)
        return
      }

      if (!dialogOpen && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (
          event.key.toLowerCase() === 'n' &&
          filter !== 'trash' &&
          filter !== 'passkey'
        ) {
          event.preventDefault()
          setView('vault')
          setCreateType(createTypeForFilter(filter))
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [createType, filter])

  const activeVault = vaults.find((vault) => vault.id === activeVaultFilter)
  const scopedItems = useMemo(() => {
    const base = securityCategory
      ? securityCategoryItems(securityReport, securityCategory)
      : items
    return activeVaultFilter === 'all'
      ? base
      : base.filter((item) => item.vaultId === activeVaultFilter)
  }, [items, securityCategory, securityReport, activeVaultFilter])

  /** Index de recherche pré-calculé : évite de reconstruire toutes les chaînes
   * à chaque frappe sur les gros coffres. */
  const searchIndex = useMemo(
    () => new Map(items.map((item) => [item.id, searchableText(item)])),
    [items],
  )

  const groupingActive =
    groupByDate && !securityCategory && filter !== 'expiring'
  const groupDateOf = useCallback(
    (item: VaultItem): string | number | null => {
      if (filter === 'trash') return item.deletedAt
      if (filter === 'recent' || sort === 'recent') {
        return usage[item.id] ?? item.updatedAt
      }
      if (sort === 'created') return item.createdAt
      return item.updatedAt
    },
    [filter, sort, usage],
  )

  const filteredItems = useMemo(() => {
    const query = normalize(search.trim())
    const entries = scopedItems
      .filter((item) => {
        if (securityCategory) {
          if (item.deletedAt) return false
          if (query && !(searchIndex.get(item.id) ?? '').includes(query)) return false
          return true
        }
        if (filter === 'trash') {
          if (!item.deletedAt) return false
        } else {
          if (item.deletedAt) return false
          if (filter === 'favorites' && !item.favorite) return false
          if (filter === 'recent' && !usage[item.id]) return false
          if (filter === 'expiring' && !expiryByItem.has(item.id)) return false
          if (
            filter !== 'all' &&
            filter !== 'favorites' &&
            filter !== 'recent' &&
            filter !== 'expiring' &&
            item.type !== filter
          ) {
            return false
          }
        }
        if (query && !(searchIndex.get(item.id) ?? '').includes(query)) return false
        return true
      })
      .map((item) => ({
        item,
        rank: groupingActive ? dateGroupInfo(groupDateOf(item)).rank : 0,
      }))

    entries.sort((left, right) => {
      const a = left.item
      const b = right.item
      if (groupingActive && left.rank !== right.rank) return left.rank - right.rank
      if (filter === 'trash' && !securityCategory) {
        return (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')
      }
      // La vue « Bientôt expirés » suit l’échéance la plus proche.
      if (filter === 'expiring' && !securityCategory) {
        const aDate = expiryByItem.get(a.id)?.date ?? '9999-12-31'
        const bDate = expiryByItem.get(b.id)?.date ?? '9999-12-31'
        if (aDate !== bDate) return aDate.localeCompare(bDate)
        return a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })
      }
      // Les vues « Récents » suivent l’horodatage d’utilisation.
      if ((filter === 'recent' || sort === 'recent') && !securityCategory) {
        return (usage[b.id] ?? 0) - (usage[a.id] ?? 0)
      }
      // Les favoris restent en tête, puis le tri choisi s’applique.
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
      switch (sort) {
        case 'name-desc':
          return b.title.localeCompare(a.title, 'fr', { sensitivity: 'base' })
        case 'updated':
          return b.updatedAt.localeCompare(a.updatedAt)
        case 'created':
          return b.createdAt.localeCompare(a.createdAt)
        case 'type': {
          const delta = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
          return delta !== 0
            ? delta
            : a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })
        }
        default:
          return a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })
      }
    })
    return entries.map((entry) => entry.item)
  }, [
    scopedItems,
    filter,
    search,
    sort,
    usage,
    searchIndex,
    expiryByItem,
    securityCategory,
    groupingActive,
    groupDateOf,
  ])

  useEffect(() => {
    try {
      localStorage.setItem(GROUP_BY_DATE_KEY, groupByDate ? '1' : '0')
    } catch {
      // Le stockage local peut être indisponible : la préférence reste en mémoire.
    }
  }, [groupByDate])

  const visibleItems = filteredItems.slice(0, visibleLimit)
  const dateGroups = useMemo(
    () => (groupingActive ? groupItemsByDate(visibleItems, groupDateOf) : null),
    [groupingActive, visibleItems, groupDateOf],
  )

  const deletedCount = items.filter((item) => item.deletedAt).length
  const selectedItems = items.filter(
    (item) => selectedIds.has(item.id) && !item.deletedAt,
  )
  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((item) => selectedIds.has(item.id))
  const allSelectedFavorite =
    selectedItems.length > 0 && selectedItems.every((item) => item.favorite)

  const toggleSelected = (itemId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const toggleSelectAllVisible = () => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (allVisibleSelected) {
        for (const item of visibleItems) next.delete(item.id)
      } else {
        for (const item of visibleItems) next.add(item.id)
      }
      return next
    })
  }

  const toggleSelectedFavorite = async () => {
    if (bulkBusy || selectedItems.length === 0) return
    setBulkBusy(true)
    try {
      const count = await favoriteItems(
        selectedItems.map((item) => item.id),
        !allSelectedFavorite,
      )
      toast(
        count > 0
          ? t(
              pluralKey(
                count,
                allSelectedFavorite
                  ? 'vault.favorite.removed.one'
                  : 'vault.favorite.added.one',
                allSelectedFavorite
                  ? 'vault.favorite.removed.other'
                  : 'vault.favorite.added.other',
              ),
              { count },
            )
          : t('vault.favorite.none'),
        'info',
      )
      setSelectedIds(new Set())
    } finally {
      setBulkBusy(false)
    }
  }

  const trashSelected = async () => {
    if (bulkBusy || selectedIds.size === 0) return
    setBulkBusy(true)
    try {
      const count = await trashItems([...selectedIds])
      setShowBulkTrash(false)
      setSelectedIds(new Set())
      setSelectionMode(false)
      toast(
        count > 0
          ? t(
              pluralKey(count, 'vault.trash.moved.one', 'vault.trash.moved.other'),
              { count },
            )
          : t('vault.trash.none'),
        'info',
      )
    } finally {
      setBulkBusy(false)
    }
  }

  // Un élément retiré de la liste filtrée n’est plus affiché comme sélectionné.
  const selectedItem =
    selectedId && filteredItems.some((entry) => entry.id === selectedId)
      ? items.find((item) => item.id === selectedId)
      : undefined
  const activeItems = items.filter((item) => !item.deletedAt)
  const singleEmpty =
    activeItems.length === 0 &&
    filter === 'all' &&
    activeVaultFilter === 'all' &&
    !search.trim() &&
    !securityCategory
  const dashboardActive = view === 'dashboard'
  const mobileModalActive = securityOpen || settingsOpen
  const detailActive = !dashboardActive && Boolean(selectedItem)
  const defaultVaultId = activeVault?.id ?? vaults[0]?.id ?? ''
  const canCreateInDefault =
    Boolean(defaultVaultId) &&
    vaults.find((vault) => vault.id === defaultVaultId)?.role !== 'read'
  const filterLabel = t(FILTER_MESSAGE_KEYS[filter])
  const securityLabel = securityCategory ? t(SECURITY_CATEGORY_KEYS[securityCategory]) : null
  const heading = dashboardActive
    ? t('vault.dashboardTitle')
    : securityCategory
      ? securityLabel
      : activeVault
        ? filter === 'all'
          ? activeVault.name
          : `${activeVault.name} · ${filterLabel}`
        : filterLabel
  const countLabel = (count: number) =>
    count === 0
      ? t('vault.itemCount.none')
      : t(pluralKey(count, 'vault.itemCount.one', 'vault.itemCount.other'), { count })
  const subheading = dashboardActive
    ? t('vault.dashboardSub')
    : securityCategory
      ? t('vault.categoryCount', { count: filteredItems.length })
    : filter === 'trash'
      ? `${countLabel(filteredItems.length)} · ${t('filter.trash')}`
      : filter === 'expiring'
        ? t('vault.expiringCount', { count: filteredItems.length })
        : filteredItems.length === 0
          ? `${countLabel(0)}${
              activeVault
                ? ''
                : ` · ${t(
                    pluralKey(vaults.length, 'auth.vaultCount.one', 'auth.vaultCount.other'),
                    { count: vaults.length },
                  )}`
            }`
          : `${countLabel(filteredItems.length)}${
              activeVault
                ? ''
                : ` · ${t(
                    pluralKey(vaults.length, 'auth.vaultCount.one', 'auth.vaultCount.other'),
                    { count: vaults.length },
                  )}`
            }`
  const originLabel = securityCategory ? securityLabel ?? '' : filterLabel

  const openCreate = () => {
    if (filter === 'trash' || filter === 'passkey' || readOnly) return
    setView('vault')
    setSecurityCategory(null)
    setCreateType(createTypeForFilter(filter))
  }

  const openCreateFromDashboard = () => {
    if (readOnly) return
    setSecurityCategory(null)
    setCreateType('login')
  }

  const openDashboardItem = (itemId: string) => {
    setView('vault')
    setSecurityCategory(null)
    setFilter('all')
    setVaultFilter('all')
    setSearch('')
    setCreateType(null)
    setSelectedId(itemId)
    markUsed(itemId)
  }

  const openDashboardFilter = (next: ItemFilter) => {
    setView('vault')
    setSecurityCategory(null)
    setSearch('')
    setFilter(next)
  }

  const openDashboardVault = (vaultId: string) => {
    setView('vault')
    setSecurityCategory(null)
    setSearch('')
    setFilter('all')
    setVaultFilter(vaultId)
  }

  const closeDetail = () => {
    if (createType) {
      setCreateType(null)
      return
    }
    setSelectedId(null)
  }

  const clearFilters = () => {
    setFilter('all')
    setVaultFilter('all')
    setSearch('')
    setSecurityCategory(null)
  }

  const openSecurityCategory = (category: SecurityCategory) => {
    setSecurityOpen(false)
    setView('vault')
    setSecurityCategory(category)
    setFilter('all')
    setVaultFilter('all')
    setSearch('')
    setSelectedId(null)
    setCreateType(null)
  }

  const removeVault = async () => {
    if (!vaultToDelete) return
    await deleteVault(vaultToDelete.id)
    if (vaultFilter === vaultToDelete.id) setVaultFilter('all')
    toast(t('vault.vaultDeleted'), 'info')
    setVaultToDelete(null)
  }

  // Flèches dans la liste : parcours rapide au clavier.
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('.item-row') ?? [],
    )
    if (rows.length === 0) return
    const active = document.activeElement as HTMLElement | null
    const index = active ? rows.indexOf(active) : -1
    let next = index
    if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1)
    if (event.key === 'ArrowUp') next = Math.max(0, index - 1)
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = rows.length - 1
    event.preventDefault()
    rows[next]?.focus()
  }

  const onListTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  const onListTouchEnd = (event: React.TouchEvent) => {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start || !detailActive) return
    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (deltaX > 70 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      closeDetail()
    }
  }

  const dateGroupLabel = (group: DateGroup<VaultItem>): string => {
    if (group.kind === 'month-year' && group.date) {
      return formatMonthYear(group.date.toISOString(), intl)
    }
    switch (group.kind) {
      case 'today':
        return t('vault.dateGroup.today')
      case 'yesterday':
        return t('vault.dateGroup.yesterday')
      case 'week':
        return t('vault.dateGroup.week')
      case 'month':
        return t('vault.dateGroup.month')
      default:
        return t('vault.dateGroup.unknown')
    }
  }

  const renderItemRow = (item: VaultItem) => (
    <ItemRow
      key={item.id}
      item={item}
      vaultName={vaults.find((vault) => vault.id === item.vaultId)?.name ?? 'Coffre'}
      showVault={activeVaultFilter === 'all' && vaults.length > 1}
      selected={selectedId === item.id}
      selectable={selectionMode}
      issue={securityIssueById.get(item.id) ?? null}
      checked={selectedIds.has(item.id)}
      onSelect={() => {
        if (selectionMode) {
          toggleSelected(item.id)
          return
        }
        setCreateType(null)
        setSelectedId(item.id)
        markUsed(item.id)
      }}
      onLongPress={() => {
        setSelectionMode(true)
        toggleSelected(item.id)
      }}
    />
  )

  return (
    <div className="app-shell" style={shellStyle}>
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>
      <ExtensionBridge />
      <Sidebar
        vaults={vaults}
        items={items}
        usage={usage}
        filter={filter}
        vaultFilter={activeVaultFilter}
        open={sidebarOpen}
        collapsed={layout.sidebarCollapsed}
        dashboardActive={dashboardActive}
        onOpenDashboard={() => {
          setView('dashboard')
          setSelectedId(null)
          setCreateType(null)
          setSecurityCategory(null)
          setSidebarOpen(false)
        }}
        onToggleCollapsed={layout.toggleSidebar}
        onFilterChange={(next) => {
          setView('vault')
          setSecurityCategory(null)
          setCreateType(null)
          setFilter(next)
        }}
        onVaultChange={(next) => {
          setView('vault')
          setCreateType(null)
          setVaultFilter(next)
        }}
        onAddVault={() => setVaultForm({ mode: 'create' })}
        onRenameVault={(vault) => setVaultForm({ mode: 'rename', vault })}
        onDeleteVault={setVaultToDelete}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSecurity={() => setSecurityOpen(true)}
        securityReport={securityReport}
        syncPending={syncPending}
        onLock={lock}
        onClose={() => setSidebarOpen(false)}
      />

      {!layout.sidebarCollapsed && (
        <ColumnResizer
          className="column-resizer--sidebar"
          label={t('layout.resizeSidebar')}
          value={layout.sidebarWidth}
          min={LAYOUT_LIMITS.sidebarMin}
          max={LAYOUT_LIMITS.sidebarMax}
          onChange={layout.setSidebarWidth}
          onReset={layout.resetSidebarWidth}
          style={{ left: layout.sidebarWidth }}
        />
      )}

      <div className={`app-main ${detailActive ? 'app-main--detail' : ''}`}>
        <header className={`topbar ${detailActive ? 'topbar--detail' : ''}`} data-tauri-drag-region>
          <button
            type="button"
            className="icon-button topbar__menu"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('vault.openMenu')}
          >
            <MenuIcon size={20} />
          </button>

          <div className="topbar__library">
            <div className="topbar__heading">
              <span className="eyebrow">{t('vault.appEyebrow')}</span>
              <h1>
                {heading}
                {!dashboardActive &&
                  !securityCategory &&
                  filter !== 'all' &&
                  filter !== 'favorites' &&
                  filter !== 'recent' &&
                  filter !== 'expiring' &&
                  filter !== 'trash' && (
                    <span className="topbar__filter">· {itemTypeLabel(filter)}</span>
                  )}
              </h1>
              <span className="topbar__sub">{subheading}</span>
            </div>

            <div className="topbar__actions">
              {!dashboardActive && (
                <label className="search">
                <Search size={17} />
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('vault.search')}
                  aria-label={t('vault.searchLabel')}
                />
                  <span className="search__hint" aria-hidden="true">
                    ⌘K
                  </span>
                </label>
              )}
              {(dashboardActive || (filter !== 'trash' && filter !== 'passkey')) && (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={dashboardActive ? openCreateFromDashboard : openCreate}
                  aria-label={t('vault.newItem')}
                  disabled={readOnly || !canCreateInDefault}
                  title={readOnly ? t('vault.readOnlyTooltip') : undefined}
                >
                  <Plus size={18} />
                  <span className="button__label">{t('vault.newItem')}</span>
                </button>
              )}
            </div>
          </div>

          {detailActive && (
            <div className="topbar__detail">
              <button
                type="button"
                className="icon-button topbar__back topbar__back--labelled"
                onClick={closeDetail}
                aria-label={t('vault.backToList', { list: originLabel })}
              >
                <ArrowLeft size={19} />
                <span>{originLabel}</span>
              </button>
            </div>
          )}
        </header>

        {readOnly && (
          <div className="banner banner--warning" role="alert">
            <LockKeyhole size={18} />
            <div className="banner__body">
              <strong>{t('vault.readOnlyTitle')}</strong>
              <span>{t('vault.integrityWarning')}</span>
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="banner banner--warning" role="status">
            <AlertTriangle size={18} />
            <div className="banner__body">
              <strong>
                {t(
                  pluralKey(
                    warnings.length,
                    'vault.warnings.one',
                    'vault.warnings.other',
                  ),
                  { count: warnings.length },
                )}
              </strong>
              <details>
                <summary>{t('vault.warnings.details')}</summary>
                <ul>
                  {warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </details>
            </div>
            <button
              type="button"
              className="icon-button icon-button--sm"
              onClick={dismissWarnings}
              aria-label={t('vault.warnings.dismiss')}
            >
              <X size={15} />
            </button>
          </div>
        )}

        {dashboardActive ? (
          <main id="main-content" tabIndex={-1} className="content content--dashboard">
            <Dashboard
              vaults={vaults}
              items={items}
              usage={usage}
              securityReport={securityReport}
              expiryEvents={expiryEvents}
              readOnly={readOnly}
              onNewItem={openCreateFromDashboard}
              onGeneratePassword={() => setGeneratorOpen(true)}
              onOpenSecurity={() => setSecurityOpen(true)}
              onOpenItem={openDashboardItem}
              onOpenCategory={openSecurityCategory}
              onOpenFilter={openDashboardFilter}
              onOpenVault={openDashboardVault}
              onAddVault={() => setVaultForm({ mode: 'create' })}
              syncPending={syncPending}
              lastSavedAt={file?.updatedAt ?? null}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </main>
        ) : (
        <main
          ref={splitRef}
          id="main-content"
          tabIndex={-1}
          className={`content content--split ${singleEmpty ? 'is-empty' : ''}`}
        >
          {!singleEmpty && (
            <section className="list-pane" aria-label={t('vault.listLabel')}>
              <div className="content__bar">
                <span
                  className="content__local"
                  title={t('vault.encryptedTooltip')}
                >
                  <ShieldCheck size={15} aria-hidden="true" />
                  <span className="sr-only">{t('vault.encryptedLocally')}</span>
                </span>
                <div className="content__bar-actions">
                  <div className="list-toolbar">
                    <Menu
                      label={t('vault.listOptions')}
                      title={t('vault.listOptions')}
                      trigger={<ArrowUpDown size={14} />}
                      triggerClassName="list-toolbar__trigger"
                    >
                      {filter !== 'trash' && filteredItems.length > 0 && (
                        <button
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={selectionMode}
                          className="menu__item"
                          onClick={() => {
                            if (selectionMode) setSelectedIds(new Set())
                            setSelectionMode((value) => !value)
                          }}
                        >
                          {t('vault.selectionMode')}
                          {selectionMode && <Check size={14} className="menu__check" />}
                        </button>
                      )}
                      {!securityCategory && filter !== 'expiring' && (
                        <button
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={groupByDate}
                          className="menu__item"
                          onClick={() => setGroupByDate((value) => !value)}
                        >
                          {t('vault.groupByDate')}
                          {groupByDate && <Check size={14} className="menu__check" />}
                        </button>
                      )}
                      <div className="menu__label">{t('vault.sortBy')}</div>
                      {(Object.keys(SORT_MESSAGE_KEYS) as ItemSort[]).map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={sort === value}
                          className="menu__item"
                          onClick={() => setSort(value)}
                        >
                          {t(SORT_MESSAGE_KEYS[value])}
                          {sort === value && <Check size={14} className="menu__check" />}
                        </button>
                      ))}
                    </Menu>
                  </div>
                </div>
              </div>

              {securityCategory && (
                <div className="security-filter-bar">
                  <ShieldAlert size={15} aria-hidden="true" />
                  <span>
                    <strong>{SECURITY_CATEGORY_LABELS[securityCategory]}</strong> ·{' '}
                    {countLabel(filteredItems.length)}
                  </span>
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => setSecurityCategory(null)}
                  >
                    {t('vault.showAll')}
                  </button>
                </div>
              )}

              {selectionMode && (
                <div
                  className="bulk-bar"
                  role="toolbar"
                  aria-label={t('vault.selectionActions')}
                >
                  <span>
                    {t(
                      pluralKey(
                        selectedIds.size,
                        'vault.selected.one',
                        'vault.selected.other',
                      ),
                      { count: selectedIds.size },
                    )}
                  </span>
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={toggleSelectAllVisible}
                  >
                    {allVisibleSelected ? t('vault.deselectAll') : t('vault.selectAll')}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary button--sm"
                    onClick={() => void toggleSelectedFavorite()}
                    disabled={bulkBusy || selectedItems.length === 0}
                  >
                    {allSelectedFavorite ? t('vault.removeFavorite') : t('vault.addFavorite')}
                  </button>
                  <button
                    type="button"
                    className="button button--danger button--sm"
                    onClick={() => setShowBulkTrash(true)}
                    disabled={bulkBusy || selectedIds.size === 0}
                  >
                    {t('vault.trash')}
                  </button>
                </div>
              )}

              {filter === 'trash' && !securityCategory && filteredItems.length > 0 && (
                <div className="trash-toolbar">
                  <span>
                    <Trash2 size={16} />
                    {t('vault.trashNotice')}
                  </span>
                  <button
                    type="button"
                    className="button button--danger button--sm"
                    onClick={() => setShowEmptyTrash(true)}
                  >
                    {t('vault.emptyTrash')}
                  </button>
                </div>
              )}

              {filteredItems.length > 0 ? (
                <div className="item-list" ref={listRef} onKeyDown={onListKeyDown}>
                  {dateGroups
                    ? dateGroups.map((group) => (
                        <div key={group.key} className="item-group">
                          <h2 className="item-group__title">
                            {dateGroupLabel(group)}
                          </h2>
                          {group.items.map(renderItemRow)}
                        </div>
                      ))
                    : visibleItems.map(renderItemRow)}
                  {filteredItems.length > visibleItems.length && (
                    <button
                      type="button"
                      className="button button--secondary list-more"
                      onClick={() =>
                        setLimitState({ scope: listScope, value: visibleLimit + 200 })
                      }
                    >
                      {t('vault.loadMore')}
                    </button>
                  )}
                </div>
              ) : securityCategory ? (
                <div className="empty">
                  <span className="empty__icon">
                    <ShieldCheck size={28} />
                  </span>
                  <h2>{t('vault.emptyCategory.title')}</h2>
                  <p>{t('vault.emptyCategory.copy')}</p>
                  <div className="empty__actions">
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => setSecurityCategory(null)}
                    >
                      {t('vault.showAll')}
                    </button>
                  </div>
                </div>
              ) : filter === 'trash' ? (
                <div className="empty">
                  <span className="empty__icon">
                    <Trash2 size={28} />
                  </span>
                  <h2>{t('vault.emptyTrash.title')}</h2>
                  <p>{t('vault.emptyTrash.copy')}</p>
                  <div className="empty__actions">
                    <button type="button" className="button button--secondary" onClick={clearFilters}>
                      {t('vault.backToLibrary')}
                    </button>
                  </div>
                </div>
              ) : filter === 'expiring' ? (
                <div className="empty">
                  <span className="empty__icon">
                    <CalendarClock size={28} />
                  </span>
                  <h2>{t('vault.emptyExpiring.title')}</h2>
                  <p>{t('vault.emptyExpiring.copy')}</p>
                  <div className="empty__actions">
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => setFilter('all')}
                    >
                      {t('vault.viewAll')}
                    </button>
                  </div>
                </div>
              ) : activeItems.length === 0 ? (
                <div className="empty">
                  <span className="empty__icon">
                    <LockKeyhole size={30} />
                  </span>
                  <h2>{t('vault.emptyVault.title')}</h2>
                  <p>{t('vault.emptyVault.copy')}</p>
                  <div className="empty__actions">
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={openCreate}
                      disabled={readOnly}
                    >
                      <Plus size={17} />
                      {t('vault.addItem')}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setVaultForm({ mode: 'create' })}
                      disabled={readOnly}
                    >
                      <FolderOpen size={17} />
                      {t('vault.createVault')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="empty">
                  <span className="empty__icon">
                    <Search size={28} />
                  </span>
                  <h2>{t('vault.noResult.title')}</h2>
                  <p>{t('vault.noResult.copy')}</p>
                  <div className="empty__actions">
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={clearFilters}
                    >
                      {t('vault.resetFilters')}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={openCreate}
                      disabled={readOnly || !canCreateInDefault}
                    >
                      <Plus size={17} />
                      {t('vault.newItem')}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {!singleEmpty && (
            <ColumnResizer
              className="column-resizer--list"
              label={t('layout.resizeList')}
              value={layout.listWidth}
              min={LAYOUT_LIMITS.listMin}
              max={listMax}
              onChange={layout.setListWidth}
              onReset={layout.resetListWidth}
              style={{ left: layout.listWidth }}
            />
          )}

          <aside
            className={`detail-pane ${detailActive ? 'detail-pane--active' : ''}`}
            aria-label={detailActive ? t('vault.detailTitle') : undefined}
            onTouchStart={onListTouchStart}
            onTouchEnd={onListTouchEnd}
          >
            {selectedItem ? (
              <Suspense fallback={<PanelLoading />}>
                <ItemDialog
                  key={selectedItem.id}
                  item={selectedItem}
                  presentation="panel"
                  vaults={vaults}
                  defaultVaultId={selectedItem.vaultId}
                  securityReport={securityReport}
                  onClose={() => setSelectedId(null)}
                  onSaved={(item) => setSelectedId(item.id)}
                  onUsed={() => markUsed(selectedItem.id)}
                />
              </Suspense>
            ) : singleEmpty ? (
              <div className="empty">
                <span className="empty__icon">
                  <LockKeyhole size={30} />
                </span>
                <h2>{t('vault.emptyVault.title')}</h2>
                <p>{t('vault.emptyVault.copy')}</p>
                <div className="empty__actions">
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={openCreate}
                    disabled={readOnly}
                  >
                    <Plus size={17} />
                    {t('vault.addItem')}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setVaultForm({ mode: 'create' })}
                    disabled={readOnly}
                  >
                    <FolderOpen size={17} />
                    {t('vault.createVault')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="detail-empty">
                <span className="detail-empty__icon">
                  <ShieldCheck size={26} />
                </span>
                <h2>{t('vault.noSelection.title')}</h2>
                <p>{t('vault.noSelection.copy')}</p>
              </div>
            )}
          </aside>
        </main>
        )}

        <nav className="mobile-tabs" aria-label={t('vault.mainNavigation')}>
          <button
            type="button"
            className={`mobile-tabs__item ${
              dashboardActive && !mobileModalActive ? 'is-active' : ''
            }`}
            aria-current={dashboardActive && !mobileModalActive ? 'page' : undefined}
            onClick={() => {
              setView('dashboard')
              setSecurityCategory(null)
              setSelectedId(null)
              setCreateType(null)
            }}
          >
            <LayoutDashboard size={19} />
            {t('vault.home')}
          </button>
          <button
            type="button"
            className={`mobile-tabs__item ${
              !dashboardActive && !mobileModalActive && filter === 'all' && !securityCategory
                ? 'is-active'
                : ''
            }`}
            aria-current={
              !dashboardActive && !mobileModalActive && filter === 'all' && !securityCategory
                ? 'page'
                : undefined
            }
            onClick={() => {
              setView('vault')
              setSecurityCategory(null)
              setFilter('all')
              setSelectedId(null)
            }}
          >
            <KeyRound size={19} />
            {t('vault.all')}
          </button>
          <button
            type="button"
            className={`mobile-tabs__item ${
              !dashboardActive && !mobileModalActive && filter === 'favorites' ? 'is-active' : ''
            }`}
            aria-current={
              !dashboardActive && !mobileModalActive && filter === 'favorites'
                ? 'page'
                : undefined
            }
            onClick={() => {
              setView('vault')
              setSecurityCategory(null)
              setFilter('favorites')
              setSelectedId(null)
            }}
          >
            <Star size={19} />
            {t('filter.favorites')}
          </button>
          <button
            type="button"
            className={`mobile-tabs__item ${
              !dashboardActive && !mobileModalActive && filter === 'recent' ? 'is-active' : ''
            }`}
            aria-current={
              !dashboardActive && !mobileModalActive && filter === 'recent' ? 'page' : undefined
            }
            onClick={() => {
              setView('vault')
              setSecurityCategory(null)
              setFilter('recent')
              setSelectedId(null)
            }}
          >
            <History size={19} />
            {t('filter.recent')}
          </button>
          <button
            type="button"
            className={`mobile-tabs__item ${securityOpen ? 'is-active' : ''}`}
            onClick={() => setSecurityOpen(true)}
          >
            <ShieldCheck size={19} />
            {t('sidebar.security')}
          </button>
          <button
            type="button"
            className={`mobile-tabs__item ${settingsOpen ? 'is-active' : ''}`}
            aria-current={settingsOpen ? 'page' : undefined}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={19} />
            {t('settings.title')}
          </button>
        </nav>

        <footer className="app-footer">
          <span>{t('vault.footer.storage')}</span>
          <span className="app-footer__dot" />
          <span>{t('vault.footer.offline')}</span>
          <span className="app-footer__spacer" />
        </footer>
      </div>

      {securityOpen && (
        <Suspense fallback={<DialogLoading onClose={() => setSecurityOpen(false)} />}>
          <SecurityDialog
            report={securityReport}
            breachCheck={settings.breachCheck}
            breachStatus={breachStatus}
            onCheckBreaches={() => void checkBreaches()}
            onOpenSettings={() => {
              setSecurityOpen(false)
              setSettingsOpen(true)
            }}
            onClose={() => setSecurityOpen(false)}
            onOpenCategory={openSecurityCategory}
          />
        </Suspense>
      )}

      <AutoTypePicker />

      {settingsOpen && (
        <Suspense fallback={<DialogLoading onClose={() => setSettingsOpen(false)} />}>
          <SettingsDialog
            onClose={() => setSettingsOpen(false)}
            onImported={() => {
              setView('vault')
              setFilter('all')
              setVaultFilter('all')
              setSearch('')
              setSecurityCategory(null)
              setSelectedId(null)
            }}
          />
        </Suspense>
      )}

      {vaultForm && (
        <VaultFormDialog
          mode={vaultForm.mode}
          vault={vaultForm.mode === 'rename' ? vaultForm.vault : undefined}
          onClose={() => setVaultForm(null)}
        />
      )}

      {vaultToDelete && (
        <ConfirmDialog
          title={t('vault.deleteVault.title', { name: vaultToDelete.name })}
          description={t(
            pluralKey(
              vaultToDelete.itemCount,
              'vault.deleteVault.description.one',
              'vault.deleteVault.description.other',
            ),
            { count: vaultToDelete.itemCount },
          )}
          confirmLabel={t('vault.deleteVault.confirm')}
          requireText={vaultToDelete.name}
          onClose={() => setVaultToDelete(null)}
          onConfirm={removeVault}
        />
      )}

      {showEmptyTrash && (
        <ConfirmDialog
          title={t('vault.emptyTrash.titleConfirm')}
          description={t(
            pluralKey(
              deletedCount,
              'vault.emptyTrash.description.one',
              'vault.emptyTrash.description.other',
            ),
            { count: deletedCount },
          )}
          confirmLabel={t('vault.emptyTrash.confirm')}
          requireText={t('vault.emptyTrash.require')}
          onClose={() => setShowEmptyTrash(false)}
          onConfirm={async () => {
            const removed = await emptyTrash()
            setShowEmptyTrash(false)
            setSelectedId(null)
            toast(
              removed > 0
                ? t(
                    pluralKey(
                      removed,
                      'vault.emptyTrash.done.one',
                      'vault.emptyTrash.done.other',
                    ),
                    { count: removed },
                  )
                : t('vault.emptyTrash.alreadyEmpty'),
              'info',
            )
          }}
        />
      )}

      {createType && (
        <Suspense fallback={<DialogLoading onClose={() => setCreateType(null)} />}>
          <ItemDialog
            key={`new-${createType}`}
            initialType={createType}
            vaults={vaults}
            defaultVaultId={defaultVaultId}
            presentation="dialog"
            securityReport={securityReport}
            onClose={() => setCreateType(null)}
            onSaved={(item) => {
              setCreateType(null)
              setView('vault')
              setSelectedId(item.id)
              markUsed(item.id)
            }}
          />
        </Suspense>
      )}

      {generatorOpen && (
        <Suspense fallback={<DialogLoading onClose={() => setGeneratorOpen(false)} />}>
          <GeneratorDialog onClose={() => setGeneratorOpen(false)} />
        </Suspense>
      )}

      {showBulkTrash && (
        <ConfirmDialog
          title={t(
            pluralKey(
              selectedIds.size,
              'vault.trash.bulkTitle.one',
              'vault.trash.bulkTitle.other',
            ),
            { count: selectedIds.size },
          )}
          description={t('vault.trash.bulkDescription')}
          confirmLabel={t('vault.trash.bulkConfirm')}
          onClose={() => setShowBulkTrash(false)}
          onConfirm={trashSelected}
        />
      )}

      <SshAgentBridge />
    </div>
  )
}
