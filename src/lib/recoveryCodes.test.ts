import { describe, expect, it } from 'vitest'
import {
  createRecoveryCodeEntries,
  lowRecoveryCodeItems,
  parseRecoveryCodes,
  recoveryCodesExportText,
  remainingRecoveryCodes,
  setRecoveryCodeUsed,
} from './recoveryCodes'
import { emptyDraft, type RecoveryCodesItem } from './types'

const NOW = '2026-11-09T10:00:00.000Z'

function item(codes: Array<{ id: string; code: string; usedAt: string | null }>): RecoveryCodesItem {
  return {
    ...emptyDraft('recovery-codes', 'v1'),
    id: 'i_recovery',
    title: 'GitHub',
    createdAt: NOW,
    updatedAt: NOW,
    codes,
  } as RecoveryCodesItem
}

describe('codes de secours', () => {
  it('importe un code par ligne ou séparé par des espaces', () => {
    const parsed = parseRecoveryCodes(`
      Codes de secours GitHub
      1. AAAA-BBBB
      2. CCCC-DDDD
      - EEEE-FFFF
      GGGG-HHHH IIII-JJJJ
      aaaa-bbbb
    `)
    expect(parsed).toEqual([
      'AAAA-BBBB',
      'CCCC-DDDD',
      'EEEE-FFFF',
      'GGGG-HHHH',
      'IIII-JJJJ',
    ])
  })

  it('ignore les lignes vides et les puces sans code', () => {
    expect(parseRecoveryCodes('•\n---\n\n1234-5678')).toEqual(['1234-5678'])
  })

  it('conserve le fournisseur et les dates lors du marquage', () => {
    let index = 0
    const codes = createRecoveryCodeEntries(
      ['AAAA', 'BBBB', 'CCCC'],
      () => `rc_${index++}`,
    )
    const marked = setRecoveryCodeUsed(item(codes), 'rc_0', NOW)
    expect(marked.codes[0].usedAt).toBe(NOW)
    expect(marked.codes[1].usedAt).toBeNull()
    expect(remainingRecoveryCodes(marked)).toBe(2)
    const restored = setRecoveryCodeUsed(marked, 'rc_0', null)
    expect(remainingRecoveryCodes(restored)).toBe(3)
  })

  it('alerte à deux codes restants ou moins', () => {
    const codes = createRecoveryCodeEntries(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      (() => {
        let index = 0
        return () => `rc_${index++}`
      })(),
    )
    const ready = item(codes)
    expect(lowRecoveryCodeItems([ready])).toEqual([])
    let used = ready
    for (const code of codes.slice(0, 7)) {
      used = setRecoveryCodeUsed(used, code.id, NOW)
    }
    expect(remainingRecoveryCodes(used)).toBe(3)
    expect(lowRecoveryCodeItems([used])).toEqual([])
    used = setRecoveryCodeUsed(used, codes[7].id, NOW)
    expect(remainingRecoveryCodes(used)).toBe(2)
    expect(lowRecoveryCodeItems([used])).toHaveLength(1)
  })

  it('ignore la corbeille dans l’alerte', () => {
    const codes = createRecoveryCodeEntries(['AAAA'], () => 'rc')
    const trashed = { ...item(codes), deletedAt: NOW }
    expect(lowRecoveryCodeItems([trashed])).toEqual([])
  })

  it('produit un texte long avec l’état des codes', () => {
    let index = 0
    const codes = createRecoveryCodeEntries(
      ['AAAA', 'BBBB'],
      () => `rc_${index++}`,
    )
    const marked = setRecoveryCodeUsed(item(codes), 'rc_0', NOW)
    expect(recoveryCodesExportText(marked)).toContain('AAAA')
    expect(recoveryCodesExportText(marked)).toContain(`(utilisé le ${NOW})`)
    expect(recoveryCodesExportText(marked)).toContain('BBBB')
  })
})
