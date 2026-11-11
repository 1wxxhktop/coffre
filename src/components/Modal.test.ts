// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../state/I18nProvider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

import { Modal } from './Modal'

function Harness() {
  const [openA, setOpenA] = useState(false)
  const [openB, setOpenB] = useState(false)
  return createElement(
    'div',
    null,
    createElement(
      'div',
      { id: 'root' },
      createElement(
        'button',
        { id: 'outside', onClick: () => setOpenA(true) },
        'open',
      ),
    ),
    openA &&
      createElement(
        Modal,
        // oxlint-disable-next-line react/no-children-prop -- createElement sans JSX
        { title: 'A', onClose: () => setOpenA(false), children: null },
        createElement(
          'button',
          { id: 'trigger-b', onClick: () => setOpenB(true) },
          'B',
        ),
        openB &&
          createElement(
            Modal,
            // oxlint-disable-next-line react/no-children-prop -- createElement sans JSX
            { title: 'B', onClose: () => setOpenB(false), children: null },
            createElement('button', { id: 'inside-b' }, 'ok'),
          ),
      ),
  )
}

describe('Modal', () => {
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

  it('rend #root inerte pendant l’ouverture', () => {
    act(() => root.render(createElement(Harness)))
    const outside = document.getElementById('outside')!
    outside.focus()
    act(() => outside.click())
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(true)
  })

  it('restaure le focus du déclencheur après une modale imbriquée', () => {
    act(() => root.render(createElement(Harness)))
    const outside = document.getElementById('outside')!
    outside.focus()
    act(() => outside.click())

    const trigger = document.getElementById('trigger-b')!
    trigger.focus()
    act(() => trigger.click())
    expect(document.getElementById('inside-b')).not.toBeNull()

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(document.getElementById('inside-b')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(document.activeElement).toBe(outside)
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false)
  })
})
