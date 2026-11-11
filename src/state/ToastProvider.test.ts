// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../state/I18nProvider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

import { ToastProvider, useToast } from './ToastProvider'

function Harness() {
  const { toast } = useToast()
  return createElement(
    'button',
    { id: 'toast-trigger', onClick: () => toast('hello') },
    'toast',
  )
}

describe('ToastProvider', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('affiche la pile de notifications directement sous body', () => {
    act(() =>
      root.render(
        createElement(
          'div',
          { id: 'root' },
          createElement(ToastProvider, null, createElement(Harness)),
        ),
      ),
    )
    act(() => document.getElementById('toast-trigger')!.click())

    const stack = document.querySelector('.toast-stack')
    expect(stack).not.toBeNull()
    expect(stack?.parentElement).toBe(document.body)
    expect(document.getElementById('root')?.contains(stack!)).toBe(false)
  })
})
