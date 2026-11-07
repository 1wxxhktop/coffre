import { Paperclip, Star } from 'lucide-react'
import { ItemIcon } from './ItemIcon'
import { formatDate } from '../lib/settings'
import { itemSubtitle, itemTypeLabel, type VaultItem } from '../lib/types'

interface ItemRowProps {
  item: VaultItem
  vaultName: string
  showVault: boolean
  selected: boolean
  onSelect: () => void
}

/** Ligne compacte de la liste, dans l’esprit de la barre latérale 1Password. */
export function ItemRow({ item, vaultName, showVault, selected, onSelect }: ItemRowProps) {
  return (
    <button
      type="button"
      className={`item-row item-row--${item.type} ${
        item.deletedAt ? 'item-row--trash' : ''
      } ${selected ? 'is-selected' : ''}`}
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      title={`${item.title} — ${itemTypeLabel(item.type)}`}
    >
      <span className={`item-icon item-icon--${item.type}`}>
        <ItemIcon type={item.type} size={18} />
      </span>

      <span className="item-row__content">
        <span className="item-row__title">
          {item.title}
          {item.favorite && (
            <Star
              size={12}
              className="item-row__favorite"
              fill="currentColor"
              aria-label="Favori"
            />
          )}
        </span>
        <span className="item-row__subtitle">
          {item.deletedAt
            ? `Supprimé le ${formatDate(item.deletedAt)}`
            : itemSubtitle(item) || itemTypeLabel(item.type)}
        </span>
      </span>

      <span className="item-row__meta">
        {showVault && <span className="item-row__vault">{vaultName}</span>}
        {item.attachments.length > 0 && (
          <span
            className="item-row__attachment"
            title={`${item.attachments.length} pièce${
              item.attachments.length > 1 ? 's' : ''
            } jointe${item.attachments.length > 1 ? 's' : ''}`}
          >
            <Paperclip size={12} />
            {item.attachments.length}
          </span>
        )}
      </span>
    </button>
  )
}
