import { describe, expect, it } from 'vitest'
import {
  createPasskeyInVault,
  findPasskey,
  getPasskeyAssertion,
  toExtensionCreateResult,
  toExtensionGetResult,
} from './passkeyBridge'
import { decodeClientData } from './passkeys'
import type { ItemDraft, VaultItem, VaultSummary } from './types'

function vaultAccess() {
  const items: VaultItem[] = []
  const vaults: VaultSummary[] = [
    {
      id: 'v1',
      name: 'Personnel',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      itemCount: 0,
    },
  ]
  return {
    items,
    vaults,
    async addItem(draft: ItemDraft): Promise<VaultItem> {
      const item = {
        ...draft,
        id: `i_${items.length + 1}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as VaultItem
      items.push(item)
      return item
    },
  }
}

describe('passkeyBridge', () => {
  it('crée un élément passkey sans exposer la clé au retour du pont', async () => {
    const access = vaultAccess()
    const created = await createPasskeyInVault(access, {
      rpId: 'example.com',
      origin: 'https://login.example.com',
      challenge: 'Y2hhbGxlbmdl',
      userName: 'ada@example.com',
    })
    expect(created.itemId).toBe('i_1')
    expect(created.privateKey.length).toBeGreaterThan(0)
    expect(access.items).toHaveLength(1)
    const item = access.items[0]
    expect(item.type).toBe('passkey')
    if (item.type !== 'passkey') throw new Error('passkey attendue')
    expect(item.rpId).toBe('example.com')
    expect(item.userName).toBe('ada@example.com')
    expect(item.credentialId).toBe(created.credentialId)
    expect(item.privateKey).toBe(created.privateKey)
    expect(item.signCount).toBe(0)
  })

  it('refuse une deuxième passkey exclue par le site', async () => {
    const access = vaultAccess()
    const first = await createPasskeyInVault(access, {
      rpId: 'example.com',
      origin: 'https://example.com',
      challenge: 'Y2hhbGxlbmdl',
      userName: 'ada',
    })
    await expect(
      createPasskeyInVault(access, {
        rpId: 'example.com',
        origin: 'https://example.com',
        challenge: 'YXV0cmU',
        userName: 'ada',
        excludeCredentials: [first.credentialId],
      }),
    ).rejects.toThrow('existe déjà')
  })

  it('retrouve la passkey du domaine et signe une assertion', async () => {
    const access = vaultAccess()
    const created = await createPasskeyInVault(access, {
      rpId: 'example.com',
      origin: 'https://example.com',
      challenge: 'Y2hhbGxlbmdl',
      userName: 'ada',
    })
    expect(findPasskey(access.items, 'example.com')?.id).toBe('i_1')
    expect(findPasskey(access.items, 'example.com', ['autre'])).toBeNull()

    const assertion = await getPasskeyAssertion(access.items, {
      rpId: 'example.com',
      origin: 'https://login.example.com',
      challenge: 'YXNzZXJ0aW9u',
    })
    expect(assertion?.itemId).toBe(created.itemId)
    expect(assertion?.credentialId).toBe(created.credentialId)
    expect(assertion?.signCount).toBe(0)
    expect(decodeClientData(assertion!.clientDataJSON).type).toBe('webauthn.get')
  })

  it('renvoie null pour un domaine sans passkey', async () => {
    const access = vaultAccess()
    await createPasskeyInVault(access, {
      rpId: 'example.com',
      origin: 'https://example.com',
      challenge: 'Y2hhbGxlbmdl',
      userName: 'ada',
    })
    await expect(
      getPasskeyAssertion(access.items, {
        rpId: 'other.example',
        origin: 'https://other.example',
        challenge: 'YXNzZXJ0aW9u',
      }),
    ).resolves.toBeNull()
  })

  it('ne transmet que des données publiques au navigateur', async () => {
    const access = vaultAccess()
    const created = await createPasskeyInVault(access, {
      rpId: 'example.com',
      origin: 'https://example.com',
      challenge: 'Y2hhbGxlbmdl',
      userName: 'ada',
    })
    const wire = toExtensionCreateResult(created)
    expect(Object.keys(wire)).not.toContain('privateKey')
    expect(wire.publicKeyCose).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(wire.credentialId).toBe(created.credentialId)

    const assertion = await getPasskeyAssertion(access.items, {
      rpId: 'example.com',
      origin: 'https://example.com',
      challenge: 'YXNzZXJ0aW9u',
    })
    expect(assertion).not.toBeNull()
    const wireAssertion = toExtensionGetResult(assertion!)
    expect(Object.keys(wireAssertion)).not.toContain('privateKey')
    expect(wireAssertion.signature).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
