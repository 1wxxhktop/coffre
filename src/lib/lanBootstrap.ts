/**
 * Réception du premier coffre par le réseau local.
 *
 * Le nouvel appareil n’a pas encore de fichier : il envoie un message vide et
 * reçoit le coffre de l’appareil déjà configuré. L’autre appareil peut mettre
 * quelques secondes à démarrer sa réception, d’où les tentatives répétées.
 */

export interface FirstVaultResult {
  file: string
  blobsReceived: number
}

export interface FirstVaultOptions {
  timeoutMs?: number
  retryDelayMs?: number
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
  cancelled?: () => boolean
}

export class FirstVaultEmptyError extends Error {
  constructor() {
    super('L’autre appareil n’a pas envoyé de coffre.')
    this.name = 'FirstVaultEmptyError'
  }
}

export async function pullFirstVault(
  pull: () => Promise<FirstVaultResult>,
  options: FirstVaultOptions = {},
): Promise<FirstVaultResult> {
  const now = options.now ?? Date.now
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const timeout = options.timeoutMs ?? 120_000
  const retryDelay = options.retryDelayMs ?? 2_000
  const deadline = now() + timeout
  let lastError: Error = new FirstVaultEmptyError()

  while (!options.cancelled?.() && now() < deadline) {
    try {
      const result = await pull()
      if (result.file.trim()) return result
      lastError = new FirstVaultEmptyError()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    if (options.cancelled?.() || now() >= deadline) break
    await wait(retryDelay)
  }

  throw lastError
}
