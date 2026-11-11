import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { searchPalette, type PaletteAction } from '../lib/palette'
import type { VaultItem } from '../lib/types'
import type { UsageMap } from '../lib/usage'
import { useI18n } from '../state/I18nProvider'
import { ItemIcon } from './ItemIcon'

export interface PaletteCommand extends PaletteAction {
  icon: ReactNode
  run: () => void
}

interface CommandPaletteProps {
  items: VaultItem[]
  usage: UsageMap
  commands: PaletteCommand[]
  onOpenItem: (itemId: string) => void
  onClose: () => void
}

/**
 * Palette de commandes (⌘K / Ctrl+K) : une seule zone de saisie pour ouvrir
 * un élément ou lancer une action. La recherche ne lit jamais les secrets.
 */
export function CommandPalette({
  items,
  usage,
  commands,
  onOpenItem,
  onClose,
}: CommandPaletteProps) {
  const { tt } = useI18n()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const optionId = (index: number) => `${listId}-option-${index}`

  const results = useMemo(
    () => searchPalette(query, commands, items, usage),
    [query, commands, items, usage],
  )
  const options = useMemo(
    () => [
      ...results.actions.map((action) => ({ kind: 'action' as const, action })),
      ...results.items.map((item) => ({ kind: 'item' as const, item })),
    ],
    [results],
  )
  const activeIndex = Math.min(active, Math.max(0, options.length - 1))

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const runOption = (index: number) => {
    const option = options[index]
    if (!option) return
    onClose()
    if (option.kind === 'action') option.action.run()
    else onOpenItem(option.item.id)
  }

  const section = (title: string) => (
    <div className="palette__section" role="presentation">
      {title}
    </div>
  )

  return createPortal(
    <div
      className="modal-overlay palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={tt('Palette de commandes')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive(options.length ? (activeIndex + 1) % options.length : 0)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive(
              options.length ? (activeIndex - 1 + options.length) % options.length : 0,
            )
          } else if (event.key === 'Enter') {
            event.preventDefault()
            runOption(activeIndex)
          } else if (event.key === 'Tab') {
            // Un seul champ : le focus reste dans la palette.
            event.preventDefault()
          }
        }}
      >
        <label className="palette__search">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={options.length ? optionId(activeIndex) : undefined}
            aria-label={tt('Rechercher un élément ou une action')}
            placeholder={tt('Rechercher un élément ou une action…')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="palette__kbd">{tt('Échap')}</kbd>
        </label>

        <div className="palette__list" id={listId} role="listbox" ref={listRef}>
          {options.length === 0 && (
            <p className="palette__empty">{tt('Aucun résultat')}</p>
          )}
          {results.actions.length > 0 && section(tt('Actions'))}
          {results.actions.map((action, index) => (
            <div
              key={action.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className="palette__option"
              onMouseMove={() => setActive(index)}
              onClick={() => runOption(index)}
            >
              <span className="palette__icon">{action.icon}</span>
              <span className="palette__title">{action.label}</span>
              {action.shortcut && <kbd className="palette__kbd">{action.shortcut}</kbd>}
              <CornerDownLeft size={14} className="palette__enter" aria-hidden="true" />
            </div>
          ))}
          {results.items.length > 0 &&
            section(query.trim() ? tt('Éléments') : tt('Utilisés récemment'))}
          {results.items.map((item, offset) => {
            const index = results.actions.length + offset
            const detail = item.type === 'login' ? item.username : ''
            return (
              <div
                key={item.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                className="palette__option"
                onMouseMove={() => setActive(index)}
                onClick={() => runOption(index)}
              >
                <span className={`item-icon item-icon--${item.type} palette__icon`}>
                  <ItemIcon type={item.type} item={item} size={15} />
                </span>
                <span className="palette__title">{item.title}</span>
                {detail && <span className="palette__detail">{detail}</span>}
                <CornerDownLeft size={14} className="palette__enter" aria-hidden="true" />
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
