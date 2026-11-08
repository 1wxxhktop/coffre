import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  FolderOpen,
  LockKeyhole,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { Sidebar } from './Sidebar'
import {
  FILTER_LABELS,
  SORT_LABELS,
  type ItemFilter,
  type ItemSort,
} from '../lib/filters'
import { ItemRow } from './ItemRow'
import { ItemDialog } from './ItemDialog'
import { SettingsDialog } from './SettingsDialog'
import { SecurityDialog } from './SecurityDialog'
import { VaultFormDialog } from './VaultFormDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { ExtensionBridge } from './ExtensionBridge'
import { useVault } from '../state/VaultProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'
import { useAutoLock } from '../hooks/useAutoLock'
import { loadUsage, recordItemUsage, type UsageMap } from '../lib/usage'
import { itemSubtitle, itemTypeLabel, type ItemType, type VaultSummary } from '../lib/types'
import { isTauriRuntime } from '../lib/external'

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
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
  }

  return normalize(common.join(' '))
}

const TYPE_ORDER: ItemType[] = ['login', 'card', 'note', 'identity']

export function VaultApp() {
  const {
    vaults,
    items,
    warnings,
    dismissWarnings,
    lock,
    deleteVault,
    emptyTrash,
    trashItems,
    favoriteItems,
  } = useVault()
  const { settings } = useSettings()
  const { toast } = useToast()

  const [filter, setFilter] = useState<ItemFilter>('all')
  const [vaultFilter, setVaultFilter] = useState<'all' | string>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ItemSort>('name-asc')
  const [usage, setUsage] = useState<UsageMap>(() => loadUsage())
  const [visibleLimit, setVisibleLimit] = useState(200)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createType, setCreateType] = useState<ItemType | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [vaultForm, setVaultForm] = useState<
    { mode: 'create' } | { mode: 'rename'; vault: VaultSummary } | null
  >(null)
  const [vaultToDelete, setVaultToDelete] = useState<VaultSummary | null>(null)
  const [showEmptyTrash, setShowEmptyTrash] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showBulkTrash, setShowBulkTrash] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useAutoLock(
    settings.autoLockMinutes,
    settings.lockOnHide,
    settings.lockOnFocusLoss,
    lock,
  )

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
    if (vaultFilter !== 'all' && !vaults.some((vault) => vault.id === vaultFilter)) {
      setVaultFilter('all')
    }
  }, [vaults, vaultFilter])

  useEffect(() => {
    setSelectedIds(new Set())
    setSelectionMode(false)
  }, [filter, vaultFilter, search])

  useEffect(() => {
    setSelectedIds((previous) => {
      const next = new Set(
        [...previous].filter((id) => items.some((item) => item.id === id && !item.deletedAt)),
      )
      return next.size === previous.size ? previous : next
    })
  }, [items])

  useEffect(() => {
    if (selectedId && !items.some((item) => item.id === selectedId)) {
      setSelectedId(null)
    }
  }, [items, selectedId])

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
        setSelectedId(null)
        setSidebarOpen(false)
        return
      }

      if (!dialogOpen && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key.toLowerCase() === 'n' && filter !== 'trash') {
          event.preventDefault()
          setCreateType(
            filter === 'all' || filter === 'favorites' || filter === 'recent'
              ? 'login'
              : filter,
          )
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [filter])

  const activeVault = vaults.find((vault) => vault.id === vaultFilter)
  const scopedItems = useMemo(
    () =>
      vaultFilter === 'all'
        ? items
        : items.filter((item) => item.vaultId === vaultFilter),
    [items, vaultFilter],
  )

  /** Index de recherche pré-calculé : évite de reconstruire toutes les chaînes
   * à chaque frappe sur les gros coffres. */
  const searchIndex = useMemo(
    () => new Map(items.map((item) => [item.id, searchableText(item)])),
    [items],
  )

  const filteredItems = useMemo(() => {
    const query = normalize(search.trim())
    return scopedItems
      .filter((item) => {
        if (filter === 'trash') {
          if (!item.deletedAt) return false
        } else {
          if (item.deletedAt) return false
          if (filter === 'favorites' && !item.favorite) return false
          if (filter === 'recent' && !usage[item.id]) return false
          if (
            filter !== 'all' &&
            filter !== 'favorites' &&
            filter !== 'recent' &&
            item.type !== filter
          ) {
            return false
          }
        }
        if (query && !(searchIndex.get(item.id) ?? '').includes(query)) return false
        return true
      })
      .sort((a, b) => {
        if (filter === 'trash') {
          return (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')
        }
        // Les vues « Récents » suivent l’horodatage d’utilisation.
        if (filter === 'recent' || sort === 'recent') {
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
  }, [scopedItems, filter, search, sort, usage, searchIndex])

  useEffect(() => {
    setVisibleLimit(200)
  }, [filter, search, sort, vaultFilter])

  const visibleItems = filteredItems.slice(0, visibleLimit)

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
          ? `${count} élément${count > 1 ? 's' : ''} ${
              allSelectedFavorite ? 'retiré' : 'ajouté'
            }${count > 1 ? 's' : ''} ${allSelectedFavorite ? 'des' : 'aux'} favoris`
          : 'Aucun favori modifié',
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
          ? `${count} élément${count > 1 ? 's' : ''} déplacé${count > 1 ? 's' : ''} dans la corbeille`
          : 'Aucun élément déplacé',
        'info',
      )
    } finally {
      setBulkBusy(false)
    }
  }

  // La sélection suit la liste : un élément filtré hors de la vue est désélectionné.
  useEffect(() => {
    if (selectedId && !filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(null)
    }
  }, [filteredItems, selectedId])

  const selectedItem = selectedId ? items.find((item) => item.id === selectedId) : undefined
  const defaultVaultId = activeVault?.id ?? vaults[0]?.id ?? ''
  const heading = activeVault
    ? filter === 'all'
      ? activeVault.name
      : `${activeVault.name} · ${FILTER_LABELS[filter]}`
    : FILTER_LABELS[filter]
  const subheading =
    filter === 'trash'
      ? `${filteredItems.length} élément${filteredItems.length > 1 ? 's' : ''} dans la corbeille`
      : `${filteredItems.length} élément${filteredItems.length > 1 ? 's' : ''}${
          activeVault ? '' : ` dans ${vaults.length} coffre${vaults.length > 1 ? 's' : ''}`
        }`

  const openCreate = () => {
    if (filter === 'trash') return
    setCreateType(
      filter === 'all' || filter === 'favorites' || filter === 'recent' ? 'login' : filter,
    )
  }

  const clearFilters = () => {
    setFilter('all')
    setVaultFilter('all')
    setSearch('')
  }

  const removeVault = async () => {
    if (!vaultToDelete) return
    await deleteVault(vaultToDelete.id)
    if (vaultFilter === vaultToDelete.id) setVaultFilter('all')
    toast('Coffre supprimé', 'info')
    setVaultToDelete(null)
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>
      <ExtensionBridge />
      <Sidebar
        vaults={vaults}
        items={items}
        usage={usage}
        filter={filter}
        vaultFilter={vaultFilter}
        open={sidebarOpen}
        onFilterChange={setFilter}
        onVaultChange={setVaultFilter}
        onAddVault={() => setVaultForm({ mode: 'create' })}
        onRenameVault={(vault) => setVaultForm({ mode: 'rename', vault })}
        onDeleteVault={setVaultToDelete}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSecurity={() => setSecurityOpen(true)}
        onLock={lock}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="app-main">
        <header className="topbar" data-tauri-drag-region>
          <button
            type="button"
            className="icon-button topbar__menu"
            onClick={() => setSidebarOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu size={20} />
          </button>

          <div className="topbar__heading">
            <span className="eyebrow">Coffre local</span>
            <h1>
              {heading}
              {filter !== 'all' &&
                filter !== 'favorites' &&
                filter !== 'recent' &&
                filter !== 'trash' && (
                  <span className="topbar__filter">· {itemTypeLabel(filter)}</span>
                )}
            </h1>
            <span className="topbar__sub">{subheading}</span>
          </div>

          <div className="topbar__actions">
            <label className="search">
              <Search size={17} />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher un élément…"
                aria-label="Rechercher un élément"
              />
              <span className="search__hint" aria-hidden="true">
                ⌘K
              </span>
            </label>
            {filter !== 'trash' && (
              <button
                type="button"
                className="button button--primary"
                onClick={openCreate}
                aria-label="Nouvel élément"
              >
                <Plus size={18} />
                <span className="button__label">Nouvel élément</span>
              </button>
            )}
          </div>
        </header>

        {warnings.length > 0 && (
          <div className="banner banner--warning" role="status">
            <AlertTriangle size={18} />
            <div className="banner__body">
              <strong>
                {warnings.length} avertissement{warnings.length > 1 ? 's' : ''} pendant le
                déchiffrement
              </strong>
              <details>
                <summary>Voir les détails</summary>
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
              aria-label="Ignorer les avertissements"
            >
              <X size={15} />
            </button>
          </div>
        )}

        <main id="main-content" tabIndex={-1} className="content content--split">
          <section className="list-pane">
            <div className="content__bar">
              <span className="content__local">
                <ShieldCheck size={15} />
                Chiffré localement
              </span>
              <div className="content__bar-actions">
                {filter !== 'trash' && filteredItems.length > 0 && (
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => {
                      if (selectionMode) setSelectedIds(new Set())
                      setSelectionMode((value) => !value)
                    }}
                  >
                    {selectionMode ? 'Annuler' : 'Sélectionner'}
                  </button>
                )}
                {filter !== 'trash' && (
                  <label className="filter-sort">
                    <ArrowUpDown size={13} />
                    <select
                      className="filter-sort__select"
                      value={sort}
                      onChange={(event) => setSort(event.target.value as ItemSort)}
                      aria-label="Trier les éléments"
                      title={`Trier : ${SORT_LABELS[sort]}`}
                    >
                      {(Object.keys(SORT_LABELS) as ItemSort[]).map((value) => (
                        <option key={value} value={value}>
                          {SORT_LABELS[value]}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} />
                  </label>
                )}
              </div>
            </div>

          {selectionMode && (
            <div className="bulk-bar" role="toolbar" aria-label="Actions sur la sélection">
              <span>
                {selectedIds.size} sélectionné{selectedIds.size > 1 ? 's' : ''}
              </span>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={toggleSelectAllVisible}
              >
                {allVisibleSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
              </button>
              <button
                type="button"
                className="button button--secondary button--sm"
                onClick={() => void toggleSelectedFavorite()}
                disabled={bulkBusy || selectedItems.length === 0}
              >
                {allSelectedFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              </button>
              <button
                type="button"
                className="button button--danger button--sm"
                onClick={() => setShowBulkTrash(true)}
                disabled={bulkBusy || selectedIds.size === 0}
              >
                Corbeille
              </button>
            </div>
          )}

          {filter === 'trash' && filteredItems.length > 0 && (
            <div className="trash-toolbar">
              <span>
                <Trash2 size={16} />
                Les éléments de la corbeille restent chiffrés et peuvent être restaurés.
              </span>
              <button
                type="button"
                className="button button--danger button--sm"
                onClick={() => setShowEmptyTrash(true)}
              >
                Vider la corbeille
              </button>
            </div>
          )}

          {filteredItems.length > 0 ? (
            <div className="item-list">
              {visibleItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  vaultName={vaults.find((vault) => vault.id === item.vaultId)?.name ?? 'Coffre'}
                  showVault={vaultFilter === 'all'}
                  selected={selectedId === item.id}
                  selectable={selectionMode}
                  checked={selectedIds.has(item.id)}
                  onSelect={() => {
                    if (selectionMode) {
                      toggleSelected(item.id)
                      return
                    }
                    setSelectedId(item.id)
                    markUsed(item.id)
                  }}
                />
              ))}
              {filteredItems.length > visibleItems.length && (
                <button
                  type="button"
                  className="button button--secondary list-more"
                  onClick={() => setVisibleLimit((limit) => limit + 200)}
                >
                  Afficher les 200 éléments suivants
                </button>
              )}
            </div>
          ) : filter === 'trash' ? (
            <div className="empty">
              <span className="empty__icon">
                <Trash2 size={28} />
              </span>
              <h2>La corbeille est vide</h2>
              <p>
                Les éléments supprimés apparaîtront ici. Vous pourrez les restaurer ou les
                supprimer définitivement.
              </p>
              <div className="empty__actions">
                <button type="button" className="button button--secondary" onClick={clearFilters}>
                  Revenir à la bibliothèque
                </button>
              </div>
            </div>
          ) : items.filter((item) => !item.deletedAt).length === 0 ? (
            <div className="empty">
              <span className="empty__icon">
                <LockKeyhole size={30} />
              </span>
              <h2>Votre coffre est vide</h2>
              <p>
                Ajoutez votre première connexion. Tout est chiffré dans le navigateur avant
                d’être écrit sur le disque.
              </p>
              <div className="empty__actions">
                <button type="button" className="button button--primary" onClick={openCreate}>
                  <Plus size={17} />
                  Ajouter un élément
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setVaultForm({ mode: 'create' })}
                >
                  <FolderOpen size={17} />
                  Créer un coffre
                </button>
              </div>
            </div>
          ) : (
            <div className="empty">
              <span className="empty__icon">
                <Search size={28} />
              </span>
              <h2>Aucun résultat</h2>
              <p>
                Aucun élément ne correspond à ce filtre ou à cette recherche. Essayez un autre
                mot-clé.
              </p>
              <div className="empty__actions">
                <button type="button" className="button button--secondary" onClick={clearFilters}>
                  Réinitialiser les filtres
                </button>
                <button type="button" className="button button--ghost" onClick={openCreate}>
                  <Plus size={17} />
                  Créer un élément
                </button>
              </div>
            </div>
          )}
          </section>

          <aside className={`detail-pane ${selectedItem ? 'detail-pane--active' : ''}`}>
            {selectedItem ? (
              <ItemDialog
                key={selectedItem.id}
                item={selectedItem}
                presentation="panel"
                vaults={vaults}
                defaultVaultId={selectedItem.vaultId}
                onClose={() => setSelectedId(null)}
                onUsed={() => markUsed(selectedItem.id)}
              />
            ) : (
              <div className="detail-empty">
                <span className="detail-empty__icon">
                  <ShieldCheck size={26} />
                </span>
                <h2>Aucun élément sélectionné</h2>
                <p>
                  Choisissez un élément dans la liste pour afficher ses champs, son code 2FA
                  et ses pièces jointes.
                </p>
              </div>
            )}
          </aside>
        </main>

        <footer className="app-footer">
          <span>Stockage local · IndexedDB</span>
          <span className="app-footer__dot" />
          <span>Format chiffré v3</span>
          <span className="app-footer__spacer" />
          <button type="button" className="link-button" onClick={() => setSettingsOpen(true)}>
            Réglages
          </button>
          <button type="button" className="link-button" onClick={lock}>
            <LockKeyhole size={14} />
            Verrouiller
          </button>
        </footer>
      </div>

      {createType && (
        <ItemDialog
          initialType={createType}
          vaults={vaults}
          defaultVaultId={defaultVaultId}
          onClose={() => setCreateType(null)}
          onSaved={(item) => {
            setSelectedId(item.id)
            markUsed(item.id)
          }}
        />
      )}

      {securityOpen && (
        <SecurityDialog
          items={items}
          vaults={vaults}
          onClose={() => setSecurityOpen(false)}
          onOpenItem={(itemId) => {
            setSecurityOpen(false)
            setFilter('all')
            setVaultFilter('all')
            setSearch('')
            setSelectedId(itemId)
            markUsed(itemId)
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onImported={() => {
            setFilter('all')
            setVaultFilter('all')
            setSearch('')
            setSelectedId(null)
          }}
        />
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
          title={`Supprimer « ${vaultToDelete.name} » ?`}
          description={`Ce coffre contient ${vaultToDelete.itemCount} élément${
            vaultToDelete.itemCount > 1 ? 's' : ''
          }. Le coffre et tous ses éléments seront définitivement supprimés.`}
          confirmLabel="Supprimer le coffre"
          requireText={vaultToDelete.name}
          onClose={() => setVaultToDelete(null)}
          onConfirm={removeVault}
        />
      )}

      {showEmptyTrash && (
        <ConfirmDialog
          title="Vider la corbeille ?"
          description={`${deletedCount} élément${
            deletedCount > 1 ? 's' : ''
          } et leurs pièces jointes seront définitivement supprimés. Cette action est irréversible.`}
          confirmLabel="Vider définitivement"
          requireText="SUPPRIMER"
          onClose={() => setShowEmptyTrash(false)}
          onConfirm={async () => {
            const removed = await emptyTrash()
            setShowEmptyTrash(false)
            setSelectedId(null)
            toast(
              removed > 0
                ? `${removed} élément${removed > 1 ? 's' : ''} supprimé${
                    removed > 1 ? 's' : ''
                  } définitivement`
                : 'La corbeille est déjà vide',
              'info',
            )
          }}
        />
      )}

      {showBulkTrash && (
        <ConfirmDialog
          title={`Mettre ${selectedIds.size} élément${
            selectedIds.size > 1 ? 's' : ''
          } à la corbeille ?`}
          description="Les éléments resteront chiffrés et pourront être restaurés depuis la corbeille."
          confirmLabel="Mettre à la corbeille"
          onClose={() => setShowBulkTrash(false)}
          onConfirm={trashSelected}
        />
      )}
    </div>
  )
}
