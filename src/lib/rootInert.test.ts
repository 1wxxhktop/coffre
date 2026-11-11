// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lockRootInert, unlockRootInert } from './rootInert'

describe('rootInert', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"><button>ok</button></div>'
    document.body.style.overflow = 'auto'
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  it('verrouille #root et la page jusqu’au dernier déverrouillage', () => {
    lockRootInert()
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')

    lockRootInert()
    unlockRootInert()
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')

    unlockRootInert()
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false)
    expect(document.body.style.overflow).toBe('auto')
  })

  it('ignore un déverrouillage sans verrou', () => {
    unlockRootInert()
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false)
    expect(document.body.style.overflow).toBe('auto')
  })
})
