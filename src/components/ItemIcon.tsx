import { CreditCard, FileText, Fingerprint, KeyRound, Terminal, UserRound, Wifi } from 'lucide-react'
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
    case 'passkey':
      return <Fingerprint size={size} />
    case 'ssh-key':
      return <Terminal size={size} />
    case 'wifi':
      return <Wifi size={size} />
  }
}
