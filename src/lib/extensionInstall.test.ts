import { describe, expect, it } from 'vitest'
import {
  automaticUpdatePreset,
  isFullyAutomaticUpdate,
  isNewerVersion,
  selfUpdateDecision,
} from './extensionInstall'

describe('comparaison de versions', () => {
  it('compare numériquement, segment par segment', () => {
    expect(isNewerVersion('0.12.0', '0.11.9')).toBe(true)
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true)
    expect(isNewerVersion('1.0', '0.99.99')).toBe(true)
    expect(isNewerVersion('0.12.0', '0.12.0')).toBe(false)
    expect(isNewerVersion('0.11.0', '0.12.0')).toBe(false)
    expect(isNewerVersion('0.12', '0.12.0')).toBe(false)
  })

  it('ne considère jamais une version illisible comme plus récente', () => {
    expect(isNewerVersion('9.9.9-beta', '0.1.0')).toBe(false)
    expect(isNewerVersion('abc', '0.1.0')).toBe(false)
    expect(isNewerVersion('1.0.0', 'abc')).toBe(false)
    expect(isNewerVersion('', '0.1.0')).toBe(false)
  })
})

describe('rechargement automatique de l’extension', () => {
  it('recharge quand le disque porte une version plus récente', () => {
    expect(selfUpdateDecision('0.12.0', '0.13.0', null)).toBe('reload')
  })

  it('ne fait rien si l’extension est à jour ou plus récente', () => {
    expect(selfUpdateDecision('0.13.0', '0.13.0', null)).toBe('none')
    expect(selfUpdateDecision('0.14.0', '0.13.0', null)).toBe('none')
    expect(selfUpdateDecision('0.13.0', null, null)).toBe('none')
    expect(selfUpdateDecision('0.13.0', undefined, '0.13.0')).toBe('none')
  })

  it('ne recharge qu’une fois par version, puis demande une action manuelle', () => {
    expect(selfUpdateDecision('0.12.0', '0.13.0', '0.13.0')).toBe('manual')
    // Une version encore plus récente donne droit à une nouvelle tentative.
    expect(selfUpdateDecision('0.12.0', '0.14.0', '0.13.0')).toBe('reload')
  })
})

describe('interrupteur « Mettre à jour automatiquement »', () => {
  const manual = {
    updateCheck: 'off',
    updateAutoDownload: false,
    updateInstallMode: 'ask',
  } as const

  it('n’est actif que si les trois étapes sont automatiques', () => {
    expect(isFullyAutomaticUpdate(manual)).toBe(false)
    expect(
      isFullyAutomaticUpdate({
        updateCheck: 'weekly',
        updateAutoDownload: true,
        updateInstallMode: 'on-quit',
      }),
    ).toBe(true)
    expect(
      isFullyAutomaticUpdate({
        updateCheck: 'daily',
        updateAutoDownload: true,
        updateInstallMode: 'ask',
      }),
    ).toBe(false)
  })

  it('active tout, en gardant une fréquence déjà choisie', () => {
    expect(automaticUpdatePreset(true, manual)).toEqual({
      updateCheck: 'daily',
      updateAutoDownload: true,
      updateInstallMode: 'on-quit',
    })
    expect(
      automaticUpdatePreset(true, { ...manual, updateCheck: 'weekly' }).updateCheck,
    ).toBe('weekly')
    expect(isFullyAutomaticUpdate(automaticUpdatePreset(true, manual))).toBe(true)
  })

  it('désactivé : plus aucune requête automatique', () => {
    expect(
      automaticUpdatePreset(false, {
        updateCheck: 'launch',
        updateAutoDownload: true,
        updateInstallMode: 'on-quit',
      }),
    ).toEqual(manual)
  })
})
