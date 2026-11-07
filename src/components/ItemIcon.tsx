import { CreditCard, FileText, KeyRound, UserRound } from 'lucide-react'
import type { ItemType } from '../lib/types'

export function ItemIcon({ type, size = 18 }: { type: ItemType; size?: number }) {
  switch (type) {
    case 'login':
      return <KeyRound size={size} />
    case 'note':
      return <FileText size={size} />
    case 'card':
      return <CreditCard size={size} />
    case 'identity':
      return <UserRound size={size} />
  }
}
