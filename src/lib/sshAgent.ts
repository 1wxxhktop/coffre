import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toBase64 } from './crypto'
import { isTauriRuntime } from './external'

export interface SshAgentStatus {
  running: boolean
  socket: string | null
  identities: number
  fingerprints: string[]
}

export interface SshAgentApproval {
  id: number
  comment: string
  fingerprint: string
  algorithm: string
  dataLen: number
  dataSha256: string
  dataPreview: string | null
}

/** Vérifie que l’agent SSH est disponible dans cette exécution. */
export function sshAgentSupported(): boolean {
  return isTauriRuntime()
}

export async function sshAgentStatus(): Promise<SshAgentStatus> {
  return invoke<SshAgentStatus>('ssh_agent_status')
}

export async function startSshAgent(masterKey: Uint8Array): Promise<SshAgentStatus> {
  return invoke<SshAgentStatus>('ssh_agent_start', {
    masterKey: toBase64(masterKey),
  })
}

export async function stopSshAgent(): Promise<void> {
  if (!isTauriRuntime()) return
  try {
    await invoke('ssh_agent_stop')
  } catch {
    // Le verrouillage ne doit jamais échouer à cause de l’agent.
  }
}

export async function respondSshAgent(id: number, approved: boolean): Promise<void> {
  await invoke('ssh_agent_respond', { id, approved })
}

export async function onSshAgentApproval(
  handler: (request: SshAgentApproval) => void,
): Promise<UnlistenFn> {
  return listen<SshAgentApproval>('coffre:ssh-agent-approval', (event) => {
    handler(event.payload)
  })
}
