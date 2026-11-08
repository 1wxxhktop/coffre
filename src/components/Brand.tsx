interface BrandProps {
  compact?: boolean
  subtitle?: string
}

/**
 * Marque de l’application.
 *
 * Le symbole est volontairement plat : un carré plein et un cadenas en
 * réserve, dont les couleurs suivent les variables du thème clair ou sombre.
 */
export function Brand({ compact = false, subtitle }: BrandProps) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="100%" height="100%" role="presentation">
          <rect className="brand__mark-bg" x="2" y="2" width="44" height="44" rx="12" />
          <path
            className="brand__mark-lock"
            d="M16.5 21.5v-3.2a7.5 7.5 0 0 1 15 0v3.2"
            fill="none"
            strokeWidth="3.1"
            strokeLinecap="round"
          />
          <rect className="brand__mark-body" x="13.5" y="21" width="21" height="16" rx="5" />
          <circle className="brand__mark-keyhole" cx="24" cy="28" r="2.3" />
          <path
            className="brand__mark-keyhole"
            d="M24 30v4"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
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
