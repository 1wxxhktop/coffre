// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { isDesktopRuntime, isMobileRuntime, isMobileUserAgent } from './platform'

const original = navigator.userAgent

function setUserAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value,
  })
}

afterEach(() => {
  setUserAgent(original)
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})

describe('plateforme d’exécution', () => {
  it('reconnaît les navigateurs mobiles', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 15)')).toBe(true)
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)')).toBe(true)
    expect(isMobileUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false)
  })

  it('ne considère mobile que dans Tauri', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 15)')
    expect(isMobileRuntime()).toBe(false)
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    expect(isMobileRuntime()).toBe(true)
    expect(isDesktopRuntime()).toBe(false)
  })

  it('reconnaît le bureau Tauri', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X)')
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    expect(isMobileRuntime()).toBe(false)
    expect(isDesktopRuntime()).toBe(true)
  })
})
