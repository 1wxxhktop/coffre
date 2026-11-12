// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Vérifie la garantie de verrouillage pendant une écriture : l’événement
 * système bascule l’interface en « verrouillé » immédiatement, mais la
 * mutation déjà en file est signée et enregistrée avant l’effacement des clés.
 */

const PASSWORD = 'phrase de passe de test solide'

let systemLockHandler:
  | ((event: { payload: unknown }) => void)
  | null = null

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      if (name === 'coffre://system-lock') systemLockHandler = handler
      return () => undefined
    },
  ),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === 'startup_is_hidden') return false
    return undefined
  }),
}))

vi.mock('../lib/external', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/external')>()
  return { ...actual, isTauriRuntime: () => true }
})

const saveVaultFile = vi.fn(
  async (_file: { activity?: unknown[] }) => undefined,
)

vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/storage')>()
  return {
    ...actual,
    loadVaultState: vi.fn(async () => null),
    saveVaultState: vi.fn(async () => undefined),
    saveVaultFile,
    loadVaultFile: vi.fn(async () => {
      const { parseVaultFileText } = await import('../lib/vault')
      return parseVaultFileText(
        readFileSync('src/lib/__fixtures__/v4.coffre.json', 'utf8'),
      )
    }),
  }
})

vi.mock('../lib/systemIntegration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/systemIntegration')>()
  return {
    ...actual,
    isStartedHidden: vi.fn(async () => false),
    setTrayLanguage: vi.fn(async () => undefined),
    setTrayKeepOnClose: vi.fn(async () => undefined),
  }
})

const { SettingsProvider } = await import('./SettingsProvider')
const { VaultProvider, useVault } = await import('./VaultProvider')

let vault: ReturnType<typeof useVault> | null = null
let root: ReturnType<typeof createRoot> | null = null

function Probe({ publish }: { publish: (value: ReturnType<typeof useVault>) => void }) {
  const value = useVault()
  useEffect(() => {
    publish(value)
  }, [publish, value])
  return null
}

async function mountProvider() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const publish = (value: ReturnType<typeof useVault>) => {
    vault = value
  }
  await act(async () => {
    root!.render(
      createElement(
        SettingsProvider,
        null,
        createElement(VaultProvider, null, createElement(Probe, { publish })),
      ),
    )
  })
  await vi.waitFor(() => expect(vault?.status).toBe('locked'))
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount())
    root = null
  }
  vault = null
  systemLockHandler = null
  saveVaultFile.mockClear()
  vi.clearAllMocks()
})

describe('VaultProvider et verrouillage système', () => {
  it('termine l’écriture en cours avant d’effacer les clés', async () => {
    await mountProvider()
    await act(async () => {
      await vault!.unlock(PASSWORD)
    })
    expect(vault!.status).toBe('unlocked')
    expect(systemLockHandler).not.toBeNull()

    let resolveWrite: () => void = () => undefined
    const writeGate = new Promise<void>((resolve) => {
      resolveWrite = resolve
    })
    saveVaultFile.mockImplementationOnce(async () => {
      await writeGate
    })

    let activityWrite: Promise<void> = Promise.resolve()
    act(() => {
      activityWrite = vault!.recordActivity('unlock', 'Verrouillage système')
    })
    await vi.waitFor(() => expect(saveVaultFile).toHaveBeenCalledTimes(1))

    await act(async () => {
      systemLockHandler!({ payload: { kind: 'lock' } })
    })
    expect(vault!.status).toBe('locked')
    expect(vault!.session).toBeNull()

    await act(async () => {
      resolveWrite()
      await activityWrite
    })

    const saved = saveVaultFile.mock.calls[0][0]
    expect(saved.activity?.length ?? 0).toBeGreaterThan(0)
  })

  it('efface les sidecars déchiffrés au verrouillage', async () => {
    await mountProvider()
    await act(async () => {
      await vault!.unlock(PASSWORD)
    })

    await act(async () => {
      await vault!.recordActivity('unlock', 'Événement de test')
      await vault!.recordGeneratedPassword({
        password: 'genere-pour-le-test-42',
        host: 'example.test',
      })
      await vault!.setAliasKey('simplelogin', 'cle-api-test')
    })
    expect(vault!.activity.length).toBeGreaterThan(0)
    expect(vault!.generatorHistory.length).toBeGreaterThan(0)
    expect(vault!.aliasKeys.simplelogin).toBe('cle-api-test')

    await act(async () => {
      vault!.lock()
    })
    expect(vault!.status).toBe('locked')
    expect(vault!.activity).toEqual([])
    expect(vault!.generatorHistory).toEqual([])
    expect(vault!.aliasKeys).toEqual({})
    expect(vault!.templates).toEqual([])
  })
})
