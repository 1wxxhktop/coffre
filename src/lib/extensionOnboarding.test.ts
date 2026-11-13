// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  completeExtensionOnboarding,
  dismissExtensionOnboarding,
  extensionOnboardingState,
  markExtensionOnboardingPending,
  shouldShowExtensionOnboarding,
} from './extensionOnboarding'

beforeEach(() => {
  localStorage.clear()
})

describe('assistant d’installation de l’extension', () => {
  it('s’ouvre pour un coffre neuf ou une extension absente', () => {
    expect(
      shouldShowExtensionOnboarding({
        available: true,
        paired: false,
        state: 'pending',
      }),
    ).toBe(true)
    expect(
      shouldShowExtensionOnboarding({
        available: true,
        paired: false,
        state: null,
      }),
    ).toBe(true)
  })

  it('ne s’ouvre pas si l’extension est associée ou le build sans extension', () => {
    expect(
      shouldShowExtensionOnboarding({
        available: true,
        paired: true,
        state: 'pending',
      }),
    ).toBe(false)
    expect(
      shouldShowExtensionOnboarding({
        available: false,
        paired: false,
        state: 'pending',
      }),
    ).toBe(false)
  })

  it('respecte les choix terminé et plus tard', () => {
    expect(
      shouldShowExtensionOnboarding({
        available: true,
        paired: false,
        state: 'done',
      }),
    ).toBe(false)
    expect(
      shouldShowExtensionOnboarding({
        available: true,
        paired: false,
        state: 'dismissed',
      }),
    ).toBe(false)
  })

  it('mémorise la création, le report et la fin', () => {
    expect(extensionOnboardingState()).toBeNull()
    markExtensionOnboardingPending()
    expect(extensionOnboardingState()).toBe('pending')
    dismissExtensionOnboarding()
    expect(extensionOnboardingState()).toBe('dismissed')
    markExtensionOnboardingPending()
    expect(extensionOnboardingState()).toBe('pending')
    completeExtensionOnboarding()
    expect(extensionOnboardingState()).toBe('done')
  })
})
