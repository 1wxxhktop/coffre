import { describe, expect, it, vi } from 'vitest'
import {
  FirstVaultEmptyError,
  pullFirstVault,
} from './lanBootstrap'

describe('réception du premier coffre', () => {
  it('réessaie jusqu’à ce que l’autre appareil serve le coffre', async () => {
    const pull = vi
      .fn()
      .mockRejectedValueOnce(new Error('injoignable'))
      .mockResolvedValueOnce({ file: '', blobsReceived: 0 })
      .mockResolvedValueOnce({ file: '{"format":"coffre"}', blobsReceived: 2 })
    const result = await pullFirstVault(pull, {
      wait: async () => undefined,
      timeoutMs: 10_000,
    })
    expect(result.file).toBe('{"format":"coffre"}')
    expect(result.blobsReceived).toBe(2)
    expect(pull).toHaveBeenCalledTimes(3)
  })

  it('signale un coffre vide', async () => {
    const pull = vi.fn().mockResolvedValue({ file: '  ', blobsReceived: 0 })
    await expect(
      pullFirstVault(pull, { wait: async () => undefined, timeoutMs: 1 }),
    ).rejects.toBeInstanceOf(FirstVaultEmptyError)
  })

  it('s’arrête quand la boîte de dialogue est fermée', async () => {
    const pull = vi.fn().mockResolvedValue({ file: '', blobsReceived: 0 })
    let cancelled = false
    await expect(
      pullFirstVault(pull, {
        timeoutMs: 10_000,
        wait: async () => {
          cancelled = true
        },
        cancelled: () => cancelled,
      }),
    ).rejects.toBeInstanceOf(FirstVaultEmptyError)
    expect(pull).toHaveBeenCalledTimes(1)
  })
})
