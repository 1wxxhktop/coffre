import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

interface FakeClipboard {
  value: string
  readable: boolean
  readText: () => Promise<string>
  writeText: (text: string) => Promise<void>
}

function installBrowser(options: { tauri?: boolean; focused?: boolean; readable?: boolean }) {
  const clipboard: FakeClipboard = {
    value: '',
    readable: options.readable ?? true,
    async readText() {
      if (!this.readable) throw new DOMException('refusé', 'NotAllowedError')
      return this.value
    },
    async writeText(text: string) {
      this.value = text
    },
  }
  const window: Record<string, unknown> = { isSecureContext: true }
  if (options.tauri) window.__TAURI_INTERNALS__ = {}
  vi.stubGlobal('window', window)
  vi.stubGlobal('navigator', { clipboard })
  vi.stubGlobal('document', { hasFocus: () => options.focused ?? true })
  return clipboard
}

beforeEach(() => {
  vi.resetModules()
  invoke.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('presse-papiers', () => {
  it('efface le secret après le délai s’il est toujours présent', async () => {
    vi.useFakeTimers()
    const clipboard = installBrowser({})
    const { copySensitive } = await import('./clipboard')
    const cleared = vi.fn()
    await copySensitive('s3cret!', 30, cleared)
    expect(clipboard.value).toBe('s3cret!')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(clipboard.value).toBe('')
    expect(cleared).toHaveBeenCalledOnce()
  })

  it('n’efface pas un contenu copié ensuite par l’utilisateur', async () => {
    vi.useFakeTimers()
    const clipboard = installBrowser({})
    const { copySensitive } = await import('./clipboard')
    await copySensitive('s3cret!', 30)
    clipboard.value = 'autre chose'
    await vi.advanceTimersByTimeAsync(30_000)
    expect(clipboard.value).toBe('autre chose')
  })

  it('vide quand même si la lecture est refusée et que la page a le focus', async () => {
    const clipboard = installBrowser({ readable: false, focused: true })
    const { clearClipboardIfMatches } = await import('./clipboard')
    clipboard.value = 's3cret!'
    await expect(clearClipboardIfMatches('s3cret!')).resolves.toBe(true)
    expect(clipboard.value).toBe('')
  })

  it('utilise les commandes natives dans l’application desktop', async () => {
    installBrowser({ tauri: true })
    invoke.mockResolvedValue(true)
    const { clearClipboardIfLastCopied, copySensitive } = await import('./clipboard')
    await copySensitive('s3cret!', 0)
    expect(invoke).toHaveBeenCalledWith('clipboard_copy_secret', { text: 's3cret!' })
    await clearClipboardIfLastCopied()
    expect(invoke).toHaveBeenCalledWith('clipboard_clear_if', { expected: 's3cret!' })
  })
})
