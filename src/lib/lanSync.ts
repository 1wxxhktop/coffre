/**
 * Client Tauri de la synchronisation directe sur le réseau local (F2).
 *
 * L’appairage et le transport Noise sont implémentés dans `lan_sync.rs`.
 * L’application ne reçoit que le fichier chiffré de l’autre appareil, puis
 * applique la même fusion que la synchronisation par dossier.
 */

import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './external'

export interface LanPeer {
  id: string
  name: string
  publicKey: string
  host: string
  addedAt: string
}

export interface LanIdentityInfo {
  fingerprint: string
  publicKey: string
}

export interface LanPairCode {
  code: string
  host: string
  port: number
  fingerprint: string
}

export interface LanDiscovery {
  name: string
  host: string
  port: number
  id: string
}

export interface LanSyncResult {
  peer: LanPeer
  file: string
  blobsReceived: number
}

export function lanSyncAvailable(): boolean {
  return isTauriRuntime()
}

function requireTauri(): void {
  if (!isTauriRuntime()) {
    throw new Error('La synchronisation locale est réservée aux applications desktop.')
  }
}

export async function lanIdentity(): Promise<LanIdentityInfo> {
  requireTauri()
  return invoke<LanIdentityInfo>('lan_identity')
}

export async function lanPairStart(name: string): Promise<LanPairCode> {
  requireTauri()
  return invoke<LanPairCode>('lan_pair_start', { name })
}

export async function lanPairJoin(code: string, name: string): Promise<LanPeer> {
  requireTauri()
  return invoke<LanPeer>('lan_pair_join', { code, name })
}

export async function lanDiscover(): Promise<LanDiscovery[]> {
  requireTauri()
  return invoke<LanDiscovery[]>('lan_discover')
}

export async function lanUpdatePeerHost(id: string, host: string): Promise<LanPeer> {
  requireTauri()
  return invoke<LanPeer>('lan_update_peer_host', { id, host })
}

export async function lanPeers(): Promise<LanPeer[]> {
  requireTauri()
  return invoke<LanPeer[]>('lan_peers')
}

export async function lanForgetPeer(id: string): Promise<void> {
  requireTauri()
  await invoke('lan_forget_peer', { id })
}

export async function lanSyncServe(
  file: string,
  blobIds: string[] = [],
): Promise<LanSyncResult> {
  requireTauri()
  return invoke<LanSyncResult>('lan_sync_serve', { file, blobIds })
}

export async function lanSyncPull(
  id: string,
  file: string,
  blobIds: string[] = [],
): Promise<LanSyncResult> {
  requireTauri()
  return invoke<LanSyncResult>('lan_sync_pull', { id, file, blobIds })
}

/** Groupe une empreinte hexadécimale par quatre caractères pour la lecture. */
export function formatFingerprint(value: string): string {
  return value
    .toUpperCase()
    .replace(/(.{4})/g, '$1 ')
    .trim()
}
