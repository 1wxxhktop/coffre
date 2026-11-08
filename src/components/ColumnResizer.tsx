import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'

interface ColumnResizerProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  onReset: () => void
  className?: string
  style?: CSSProperties
}

/**
 * Poignée de redimensionnement d’une colonne.
 *
 * Glisser à la souris ou au doigt, ou utiliser les flèches gauche/droite quand
 * la poignée a le focus. Un double-clic restaure la largeur par défaut.
 */
export function ColumnResizer({
  label,
  value,
  min,
  max,
  onChange,
  onReset,
  className,
  style,
}: ColumnResizerProps) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startValue = value
    const clamp = (next: number) => Math.min(max, Math.max(min, next))

    const move = (moveEvent: globalThis.PointerEvent) => {
      onChange(clamp(startValue + moveEvent.clientX - startX))
    }
    const up = () => {
      document.body.classList.remove('is-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }

    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    window.addEventListener('pointercancel', up, { once: true })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 24 : 8
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onChange(Math.max(min, value - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onChange(Math.min(max, value + step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      onChange(min)
    } else if (event.key === 'End') {
      event.preventDefault()
      onChange(max)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      title={`${label} · ${Math.round(value)} px`}
      tabIndex={0}
      className={className ? `column-resizer ${className}` : 'column-resizer'}
      style={style}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  )
}
