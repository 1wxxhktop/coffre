import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from '../lib/cx'
import { useI18n } from '../state/I18nProvider'

interface ModalProps {
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  closeLabel?: string
  className?: string
}

/**
 * Pile de modales : seul le dernier niveau répond à Échap et piège le focus.
 * Rendu hors de #root via un portail pour que les notifications restent
 * visibles au-dessus de l’interface.
 */
const modalStack: string[] = []
let previousOverflow = ''
let previousFocus: HTMLElement | null = null

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({
  title,
  description,
  size = 'md',
  children,
  footer,
  onClose,
  closeLabel,
  className,
}: ModalProps) {
  const { t } = useI18n()
  const titleId = useId()
  const descriptionId = useId()
  const modalId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)

  closeRef.current = onClose

  useEffect(() => {
    const id = modalId
    const panel = panelRef.current
    if (!panel) return

    if (modalStack.length === 0) {
      previousOverflow = document.body.style.overflow
      previousFocus = document.activeElement as HTMLElement | null
      document.body.style.overflow = 'hidden'
      document.getElementById('root')?.setAttribute('inert', '')
    }
    modalStack.push(id)

    const focusInitial = () => {
      // Ne jamais voler le focus si l’utilisateur (ou un test) a déjà commencé
      // à interagir avec la modale : un focus différé déplacerait la saisie
      // vers un autre champ.
      if (panel.contains(document.activeElement)) return
      const autofocus = panel.querySelector<HTMLElement>('[data-autofocus]')
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      const target = autofocus ?? first ?? panel
      target.focus({ preventScroll: true })
    }
    focusInitial()

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id) return

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }

      if (event.key !== 'Tab') return

      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement)

      if (focusables.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)

      const index = modalStack.lastIndexOf(id)
      if (index !== -1) modalStack.splice(index, 1)

      if (modalStack.length === 0) {
        document.body.style.overflow = previousOverflow
        document.getElementById('root')?.removeAttribute('inert')
        previousFocus?.focus?.({ preventScroll: true })
      }
    }
  }, [modalId])

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') event.stopPropagation()
  }

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current()
      }}
    >
      <div
        ref={panelRef}
        className={cx('modal', `modal--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <header className="modal__header">
          <div>
            <h2 id={titleId} className="modal__title">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="modal__description">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => closeRef.current()}
            aria-label={closeLabel ?? t('common.close')}
          >
            <X size={18} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
