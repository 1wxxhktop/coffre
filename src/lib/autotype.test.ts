import { describe, expect, it } from 'vitest'
import {
  autotypeActiveWindow,
  autotypeAvailable,
  DEFAULT_AUTOTYPE_SEQUENCE,
} from './autotype'

describe('saisie automatique', () => {
  it('expose la séquence KeePass par défaut', () => {
    expect(DEFAULT_AUTOTYPE_SEQUENCE).toBe('{USERNAME}{TAB}{PASSWORD}{ENTER}')
  })

  it('refuse les commandes hors application desktop', async () => {
    expect(autotypeAvailable()).toBe(false)
    await expect(autotypeActiveWindow()).rejects.toThrow(/desktop/)
  })
})
