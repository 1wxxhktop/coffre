import { BadgeCheck, Code2, CreditCard, FileCheck2, FileText, Fingerprint, KeyRound, ListChecks, Terminal, UserRound, Wifi } from 'lucide-react'
import { serviceForItem } from '../lib/serviceIcons'
import type { ItemType, VaultItem } from '../lib/types'

interface ItemIconProps {
  type?: ItemType
  /** Élément complet : permet d’afficher l’icône du service rattaché. */
  item?: VaultItem
  size?: number
}

export function ItemIcon({ type, item, size = 18 }: ItemIconProps) {
  if (item) {
    const service = serviceForItem(item)
    if (service?.path) {
      return (
        <svg
          data-service={service.id}
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <path d={service.path} />
        </svg>
      )
    }
    if (service?.monogram) {
      return (
        <span
          className="item-icon__monogram"
          data-service={service.id}
          style={{ fontSize: Math.max(10, Math.round(size * 0.62)) }}
          aria-hidden="true"
        >
          {service.monogram}
        </span>
      )
    }
  }

  const resolved = type ?? item?.type
  if (!resolved) return null

  switch (resolved) {
    case 'login':
      return <KeyRound size={size} />
    case 'note':
      return <FileText size={size} />
    case 'card':
      return <CreditCard size={size} />
    case 'identity':
      return <UserRound size={size} />
    case 'passkey':
      return <Fingerprint size={size} />
    case 'ssh-key':
      return <Terminal size={size} />
    case 'wifi':
      return <Wifi size={size} />
    case 'api-credential':
      return <Code2 size={size} />
    case 'software-license':
      return <BadgeCheck size={size} />
    case 'document':
      return <FileCheck2 size={size} />
    case 'recovery-codes':
      return <ListChecks size={size} />
  }
}
