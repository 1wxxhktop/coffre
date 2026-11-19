import { Globe, Plus, X } from 'lucide-react'
import { useI18n } from '../state/I18nProvider'

interface SiteUrlsFieldProps {
  urls: string[]
  onChange: (urls: string[]) => void
  max?: number
}

/** Liste d’adresses web partagée par les connexions et les comptes bancaires. */
export function SiteUrlsField({ urls, onChange, max = 10 }: SiteUrlsFieldProps) {
  const { tt } = useI18n()
  return (
    <div className="field field--full">
      <span className="field__label">{tt('Adresses du site')}</span>
      <div className="url-list">
        {urls.map((url, index) => (
          <div key={index} className="url-row">
            <Globe size={16} className="url-row__icon" />
            <input
              className="input"
              value={url}
              onChange={(event) => {
                const next = [...urls]
                next[index] = event.target.value
                onChange(next)
              }}
              placeholder="https://exemple.com"
              autoComplete="off"
            />
            <button
              type="button"
              className="icon-button"
              onClick={() => onChange(urls.filter((_, i) => i !== index))}
              aria-label={tt('Retirer l’adresse')}
              disabled={urls.length <= 1}
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {urls.length < max && (
          <button
            type="button"
            className="link-button"
            onClick={() => onChange([...urls, ''])}
          >
            <Plus size={15} />
            {tt('Ajouter une adresse')}
          </button>
        )}
      </div>
    </div>
  )
}
