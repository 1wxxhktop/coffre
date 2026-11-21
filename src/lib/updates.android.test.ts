import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('./invoke', () => ({ invoke: mocks.invoke }))
vi.mock('./platform', () => ({ isAndroidRuntime: () => true }))

import {
  checkForUpdate,
  discardUpdate,
  downloadUpdate,
  installUpdate,
  setInstallOnExit,
  updaterInfo,
} from './updates'

describe('mises à jour Android : commandes natives', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(null)
  })

  it('interroge le manifeste bêta même si le canal desktop est stable', async () => {
    await checkForUpdate('stable')
    expect(mocks.invoke).toHaveBeenCalledWith('android_updater_check', {
      channel: 'beta',
    })
  })

  it('utilise les commandes Android pour le téléchargement et l’installation', async () => {
    await downloadUpdate()
    expect(mocks.invoke).toHaveBeenCalledWith('android_updater_download')

    await installUpdate()
    expect(mocks.invoke).toHaveBeenCalledWith('android_updater_install')

    await discardUpdate()
    expect(mocks.invoke).toHaveBeenCalledWith('android_updater_discard')
  })

  it('lit la version native et ne verrouille pas le coffre à la fermeture', async () => {
    mocks.invoke.mockResolvedValueOnce({
      configured: true,
      currentVersion: '0.18.0-beta.135.1',
    })
    await expect(updaterInfo()).resolves.toEqual({
      configured: true,
      currentVersion: '0.18.0-beta.135.1',
    })
    expect(mocks.invoke).toHaveBeenCalledWith('updater_info')

    mocks.invoke.mockClear()
    await setInstallOnExit(true)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
