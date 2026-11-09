import { describe, expect, it } from 'vitest'
import { serviceForItem } from './serviceIcons'
import type { VaultItem } from './types'

function item(partial: Record<string, unknown>): VaultItem {
  return partial as unknown as VaultItem
}

describe('icônes de services', () => {
  it('reconnaît le domaine d’une connexion', () => {
    const login = item({
      type: 'login',
      title: 'Compte',
      urls: ['https://github.com/login'],
    })
    expect(serviceForItem(login)).toMatchObject({ id: 'github', label: 'GitHub' })
  })

  it('reconnaît le domaine d’une passkey et d’une clé API', () => {
    expect(
      serviceForItem(item({ type: 'passkey', title: 'Compte', rpId: 'accounts.google.com' })),
    ).toMatchObject({ id: 'google' })
    expect(
      serviceForItem(
        item({
          type: 'api-credential',
          title: 'Paiement',
          endpoint: 'https://api.stripe.com/v1',
        }),
      ),
    ).toMatchObject({ id: 'stripe' })
  })

  it('reconnaît le titre quand aucune URL n’est renseignée', () => {
    expect(
      serviceForItem(item({ type: 'login', title: 'Mon compte GitHub', urls: [] })),
    ).toMatchObject({ id: 'github' })
  })

  it('utilise un monogramme pour un domaine inconnu', () => {
    expect(
      serviceForItem(
        item({ type: 'login', title: 'Intranet', urls: ['https://portail.exemple.fr'] }),
      ),
    ).toMatchObject({ id: 'domain:portail.exemple.fr', monogram: 'E' })
  })

  it('reconnaît la marque d’une carte', () => {
    expect(
      serviceForItem(item({ type: 'card', title: 'Carte', brand: 'Visa', number: '' })),
    ).toMatchObject({ id: 'visa' })
    expect(
      serviceForItem(
        item({ type: 'card', title: 'Carte', brand: '', number: '5555 5555 5555 4444' }),
      ),
    ).toMatchObject({ id: 'mastercard' })
  })

  it('laisse l’icône du type quand aucun service n’est identifiable', () => {
    expect(serviceForItem(item({ type: 'note', title: 'Courses', notes: '' }))).toBeNull()
  })
})
