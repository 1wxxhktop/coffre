import { describe, expect, it } from 'vitest'
import { chooseChangePasswordTarget } from '../../extension/changePassword'

const candidates = [
  { id: 'login-ada', username: 'ada@example.com' },
  { id: 'login-grace', username: 'grace@example.com' },
]

describe('choix de la connexion à mettre à jour', () => {
  it('privilégie l’identifiant saisi', () => {
    expect(
      chooseChangePasswordTarget(candidates, {
        username: ' Grace@Example.com ',
        recentItemId: 'login-ada',
      })?.id,
    ).toBe('login-grace')
  })

  it('retombe sur la dernière connexion utilisée dans l’onglet', () => {
    expect(
      chooseChangePasswordTarget(candidates, {
        recentItemId: 'login-grace',
      })?.id,
    ).toBe('login-grace')
  })

  it('accepte l’unique connexion de l’hôte sans identifiant', () => {
    expect(
      chooseChangePasswordTarget([candidates[0]], { username: '' })?.id,
    ).toBe('login-ada')
  })

  it('ne devine pas entre plusieurs connexions sans indice', () => {
    expect(chooseChangePasswordTarget(candidates)).toBeNull()
    expect(
      chooseChangePasswordTarget(candidates, { recentItemId: 'inconnu' }),
    ).toBeNull()
  })

  it('ne propose rien sans connexion connue', () => {
    expect(chooseChangePasswordTarget([])).toBeNull()
  })
})
