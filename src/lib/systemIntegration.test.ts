import { describe, expect, it } from 'vitest'
import {
  SYSTEM_LOCK_EVENT,
  systemLockShouldLock,
  type SystemLockPayload,
} from './systemIntegration'

const defaults = { lockOnSystemLock: true, lockOnSleep: true }

describe('verrouillage avec la session', () => {
  it('verrouille sur un événement de session', () => {
    expect(systemLockShouldLock(defaults, { kind: 'lock' })).toBe(true)
  })

  it('verrouille sur une mise en veille', () => {
    expect(systemLockShouldLock(defaults, { kind: 'sleep' })).toBe(true)
  })

  it('respecte chaque réglage séparément', () => {
    expect(
      systemLockShouldLock(
        { lockOnSystemLock: false, lockOnSleep: true },
        { kind: 'lock' },
      ),
    ).toBe(false)
    expect(
      systemLockShouldLock(
        { lockOnSystemLock: true, lockOnSleep: false },
        { kind: 'sleep' },
      ),
    ).toBe(false)
  })

  it('ignore une charge absente, inconnue ou malformée', () => {
    const payloads: unknown[] = [
      undefined,
      null,
      {},
      { kind: 'unlock' },
      { kind: 1 },
      'lock',
      { detail: 'secret' },
    ]
    for (const payload of payloads) {
      expect(systemLockShouldLock(defaults, payload)).toBe(false)
    }
  })

  it('n’expose que le type d’événement dans la charge utile', () => {
    const payload: SystemLockPayload = { kind: 'lock' }
    expect(JSON.stringify(payload)).toBe('{"kind":"lock"}')
    expect(SYSTEM_LOCK_EVENT).toBe('coffre://system-lock')
  })
})
