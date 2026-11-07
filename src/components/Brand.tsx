import { useId } from 'react'

interface BrandProps {
  compact?: boolean
  subtitle?: string
}

export function Brand({ compact = false, subtitle }: BrandProps) {
  const gradientId = useId()

  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="100%" height="100%" role="presentation">
          <defs>
            <linearGradient id={gradientId} x1="4" y1="4" x2="44" y2="44">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="55%" stopColor="#7c6cf6" />
              <stop offset="100%" stopColor="#4fd1c5" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="44" height="44" rx="13" fill={`url(#${gradientId})`} />
          <path
            d="M16.5 21.5v-3.2a7.5 7.5 0 0 1 15 0v3.2"
            fill="none"
            stroke="#0b0d12"
            strokeWidth="3.1"
            strokeLinecap="round"
          />
          <rect x="13.5" y="21" width="21" height="16" rx="5" fill="#0b0d12" />
          <circle cx="24" cy="28" r="2.3" fill="#c7c9ff" />
          <path d="M24 30v4" stroke="#c7c9ff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && (
        <span className="brand__text">
          <span className="brand__name">Coffre</span>
          {subtitle && <span className="brand__subtitle">{subtitle}</span>}
        </span>
      )}
    </div>
  )
}
