/**
 * Client Tauri du coffre de fichiers chiffrés en flux (F8).
 *
 * Les documents sont chiffrés par Rust dans `vault/blobs/<id>`. La clé de 32
 * octets doit être fournie par l’appelant ; son enveloppe par la clé d’élément
 * et le rattachement à l’interface restent à raccorder.
 */

import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './external'
import type { VaultItem } from './types'

export interface BlobInfo {
  size: number
  sha256: string
  path: string
}

export function blobStoreAvailable(): boolean {
  return isTauriRuntime()
}

function requireTauri(): void {
  if (!isTauriRuntime()) {
    throw new Error('Le coffre de fichiers en flux est réservé au desktop.')
  }
}

/** Identifiants de blobs référencés par des pièces jointes déchiffrées. */
export function referencedBlobIds(items: VaultItem[]): string[] {
  const ids = new Set<string>()
  for (const item of items) {
    for (const attachment of item.attachments) {
      if (attachment.storage === 'blob' && attachment.blobId) {
        ids.add(attachment.blobId)
      }
    }
  }
  return [...ids]
}

export function newBlobKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export async function encryptBlob(input: {
  id: string
  sourcePath: string
  key: string
}): Promise<BlobInfo> {
  requireTauri()
  return invoke<BlobInfo>('blob_encrypt', input)
}

export async function decryptBlob(input: {
  id: string
  targetPath: string
  key: string
}): Promise<BlobInfo> {
  requireTauri()
  return invoke<BlobInfo>('blob_decrypt', input)
}

export async function previewBlob(input: {
  id: string
  key: string
  maxBytes?: number
}): Promise<string> {
  requireTauri()
  return invoke<string>('blob_preview', {
    id: input.id,
    key: input.key,
    maxBytes: input.maxBytes ?? 4 * 1024 * 1024,
  })
}

export async function exportBlobsToDirectory(
  dir: string,
  ids: string[],
): Promise<number> {
  requireTauri()
  return invoke<number>('blob_export_to', { dir, ids })
}

export async function importBlobsFromDirectory(dir: string): Promise<number> {
  requireTauri()
  return invoke<number>('blob_import_from', { dir })
}

export interface BlobEntry {
  id: string
  size: number
}

export async function listBlobs(): Promise<BlobEntry[]> {
  requireTauri()
  return invoke<BlobEntry[]>('blob_list')
}

export async function removeBlob(id: string): Promise<void> {
  requireTauri()
  await invoke('blob_remove', { id })
}
