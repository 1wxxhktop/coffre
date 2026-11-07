/**
 * Verrou d’onglet (Web Locks) : un seul onglet peut déverrouiller et écrire le
 * même coffre à la fois. Le navigateur libère automatiquement le verrou si
 * l’onglet disparaît.
 */

const LOCK_NAME = 'coffre-vault-session'

let releaseLock: (() => void) | null = null

export function vaultLockSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.locks)
}

export async function acquireVaultLock(): Promise<boolean> {
  if (!vaultLockSupported()) return true
  if (releaseLock) return true

  return new Promise<boolean>((resolve) => {
    let settled = false
    void navigator.locks
      .request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          settled = true
          resolve(false)
          return
        }
        await new Promise<void>((release) => {
          releaseLock = release
          settled = true
          resolve(true)
        })
        releaseLock = null
      })
      .catch(() => {
        if (!settled) {
          settled = true
          resolve(false)
        }
      })
  })
}

export function releaseVaultLock(): void {
  const release = releaseLock
  releaseLock = null
  release?.()
}
