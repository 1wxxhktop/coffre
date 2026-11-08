// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearTravelMode,
  getTravelMode,
  setTravelMode,
} from './travelMode'

describe('état local du mode voyage', () => {
  beforeEach(() => localStorage.clear())

  it('conserve la sélection par fichier', () => {
    expect(getTravelMode('file-a')).toBeNull()
    setTravelMode('file-a', { enabled: true, safeVaultIds: ['v1', 'v1', 'v2'] })
    setTravelMode('file-b', { enabled: false, safeVaultIds: [] })

    expect(getTravelMode('file-a')).toEqual({
      enabled: true,
      safeVaultIds: ['v1', 'v2'],
    })
    expect(getTravelMode('file-b')?.enabled).toBe(false)
    clearTravelMode('file-a')
    expect(getTravelMode('file-a')).toBeNull()
    expect(getTravelMode('file-b')?.enabled).toBe(false)
  })
})
