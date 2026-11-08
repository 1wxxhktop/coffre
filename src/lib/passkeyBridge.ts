/**
 * Opérations passkey côté application, partagées par le pont natif et la
 * passerelle de l’onglet Coffre.
 */

import {
  base64ToBase64Url,
  createPasskey,
  isValidRpId,
  PasskeyError,
  signPasskey,
  type CreatedPasskey,
  type PasskeyAssertion,
  type PasskeyCreateInput,
  type PasskeyGetInput,
} from './passkeys'
import type {
  ExtensionPasskeyCreateResult,
  ExtensionPasskeyGetResult,
} from './extensionProtocol'
import { emptyDraft, type ItemDraft, type PasskeyItem, type VaultItem, type VaultSummary } from './types'

export interface PasskeyVaultAccess {
  items: VaultItem[]
  vaults: VaultSummary[]
  addItem: (draft: ItemDraft) => Promise<VaultItem>
}

export interface PasskeyCreateResult extends CreatedPasskey {
  itemId: string
}

export interface PasskeyGetResult extends PasskeyAssertion {
  itemId: string
}

/**
 * Réduit un résultat de création aux seules données publiques destinées au
 * navigateur : la clé privée ne doit jamais franchir le pont.
 */
export function toExtensionCreateResult(
  result: PasskeyCreateResult,
): ExtensionPasskeyCreateResult {
  return {
    itemId: result.itemId,
    credentialId: result.credentialId,
    userHandle: result.userHandle,
    clientDataJSON: result.clientDataJSON,
    authenticatorData: result.authenticatorData,
    attestationObject: result.attestationObject,
    publicKeyCose: base64ToBase64Url(result.publicKeyCose),
    signCount: result.signCount,
  }
}

export function toExtensionGetResult(
  result: PasskeyGetResult,
): ExtensionPasskeyGetResult {
  return {
    itemId: result.itemId,
    credentialId: result.credentialId,
    userHandle: result.userHandle,
    clientDataJSON: result.clientDataJSON,
    authenticatorData: result.authenticatorData,
    signature: result.signature,
    signCount: result.signCount,
  }
}

function passkeyItems(items: VaultItem[]): PasskeyItem[] {
  return items.filter(
    (item): item is PasskeyItem => item.type === 'passkey' && !item.deletedAt,
  )
}

export function findPasskey(
  items: VaultItem[],
  rpId: string,
  allowCredentials: string[] = [],
): PasskeyItem | null {
  const target = rpId.trim().toLowerCase()
  const allowed = new Set(allowCredentials)
  const matches = passkeyItems(items)
    .filter((item) => item.rpId.toLowerCase() === target)
    .filter(
      (item) => allowed.size === 0 || allowed.has(item.credentialId),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return matches[0] ?? null
}

export async function createPasskeyInVault(
  access: PasskeyVaultAccess,
  input: PasskeyCreateInput & { excludeCredentials?: string[] },
): Promise<PasskeyCreateResult> {
  if (!isValidRpId(input.rpId, input.origin)) {
    throw new PasskeyError('RP ID non autorisé pour cette origine')
  }
  const rpId = input.rpId.trim().toLowerCase()
  const excluded = new Set(input.excludeCredentials ?? [])
  if (
    passkeyItems(access.items).some(
      (item) => item.rpId.toLowerCase() === rpId && excluded.has(item.credentialId),
    )
  ) {
    throw new PasskeyError(
      'Une passkey existe déjà pour ce compte sur ce site.',
    )
  }

  const created = await createPasskey(input)
  const vaultId = access.vaults[0]?.id
  if (!vaultId) throw new PasskeyError('Aucun coffre disponible')
  const item = await access.addItem({
    ...emptyDraft('passkey', vaultId),
    type: 'passkey',
    title: `Passkey · ${rpId}`.slice(0, 200),
    rpId,
    userHandle: created.userHandle,
    userName: input.userName.trim().slice(0, 500),
    credentialId: created.credentialId,
    privateKey: created.privateKey,
    publicKeyCose: created.publicKeyCose,
    signCount: created.signCount,
  })
  return { ...created, itemId: item.id }
}

export async function getPasskeyAssertion(
  items: VaultItem[],
  input: PasskeyGetInput & { allowCredentials?: string[] },
): Promise<PasskeyGetResult | null> {
  if (!isValidRpId(input.rpId, input.origin)) {
    throw new PasskeyError('RP ID non autorisé pour cette origine')
  }
  const item = findPasskey(items, input.rpId, input.allowCredentials)
  if (!item) return null
  const assertion = await signPasskey(item, input)
  return { ...assertion, itemId: item.id }
}
