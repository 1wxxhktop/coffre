/// <reference lib="webworker" />
import { argon2id } from 'hash-wasm'

interface KdfRequest {
  id: number
  password: Uint8Array
  salt: Uint8Array
  memorySize: number
  iterations: number
  parallelism: number
  hashLength: number
}

const context = self as unknown as DedicatedWorkerGlobalScope

context.onmessage = (event: MessageEvent<KdfRequest>) => {
  const request = event.data
  void (async () => {
    try {
      const hash = await argon2id({
        password: request.password,
        salt: request.salt,
        memorySize: request.memorySize,
        iterations: request.iterations,
        parallelism: request.parallelism,
        hashLength: request.hashLength,
        outputType: 'binary',
      })
      request.password.fill(0)
      request.salt.fill(0)
      context.postMessage({ id: request.id, hash }, [hash.buffer])
    } catch (error) {
      request.password.fill(0)
      request.salt.fill(0)
      context.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : 'Dérivation impossible',
      })
    }
  })()
}
