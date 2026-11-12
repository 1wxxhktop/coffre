import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/cx'

interface MenuProps {
  label: string
  trigger: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
  triggerClassName?: string
  panelClassName?: string
  disabled?: boolean
  title?: string
}

const FOCUSABLE_ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'

/**
 * Menu déroulant accessible : bouton déclencheur, panneau portalé (pour ne pas
 * être coupé par les conteneurs défilants), fermeture au clic extérieur et à
 * Échap, navigation aux flèches.
 */
export function Menu({
  label,
  trigger,
  children,
  align = 'right',
  className,
  triggerClassName = 'icon-button',
  panelClassName,
  disabled = false,
  title,
}: MenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback((returnFocus = false) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger || !panel) return
    const rect = trigger.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const margin = 8
    let left = align === 'right' ? rect.right - panelRect.width : rect.left
    left = Math.max(margin, Math.min(left, window.innerWidth - panelRect.width - margin))
    let top = rect.bottom + 4
    if (top + panelRect.height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - panelRect.height - 4)
    }
    setPosition({ top, left })
  }, [align, open])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (
        target &&
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close(true)
        return
      }

      if (event.key === 'Tab') {
        setOpen(false)
        return
      }

      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_ITEM) ?? [],
      )
      if (items.length === 0) return

      const active = document.activeElement as HTMLElement | null
      const index = active ? items.indexOf(active) : -1

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        items[(index + 1 + items.length) % items.length]?.focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        items[(index - 1 + items.length) % items.length]?.focus()
      } else if (event.key === 'Home') {
        event.preventDefault()
        items[0]?.focus()
      } else if (event.key === 'End') {
        event.preventDefault()
        items[items.length - 1]?.focus()
      }
    }

    const onViewportChange = () => setOpen(false)

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [close, open])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE_ITEM)
    ;(first ?? panel)?.focus({ preventScroll: true })
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cx(triggerClassName, className)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={cx('menu__panel menu__panel--fixed', panelClassName)}
            style={{ top: position.top, left: position.left }}
            role="menu"
            aria-label={label}
            tabIndex={-1}
            onClick={(event) => {
              const target = event.target as HTMLElement
              if (target.closest(FOCUSABLE_ITEM)) setOpen(false)
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}
