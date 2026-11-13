import { describe, expect, it } from 'vitest'
import { windowChrome } from './windowChrome'

describe('barre de titre selon la plateforme', () => {
  it('garde la barre native hors Tauri', () => {
    expect(windowChrome('Mozilla/5.0 (Windows NT 10.0)', false)).toBe('native')
    expect(windowChrome('Mozilla/5.0 (Macintosh; Intel Mac OS X)', false)).toBe(
      'native',
    )
  })

  it('reconnaît macOS et Windows dans Tauri', () => {
    expect(windowChrome('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', true)).toBe(
      'macos',
    )
    expect(windowChrome('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', true)).toBe(
      'windows',
    )
  })

  it('laisse la barre native sur Linux', () => {
    expect(windowChrome('Mozilla/5.0 (X11; Linux x86_64)', true)).toBe('native')
  })
})
