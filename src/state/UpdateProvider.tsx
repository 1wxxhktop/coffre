import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { listen } from '@tauri-apps/api/event'
import { isTauriRuntime } from '../lib/external'
import type { AppSettings } from '../lib/types'
import {
  checkForUpdate,
  discardUpdate,
  downloadUpdate,
  installUpdate,
  isSkippedVersion,
  isUpdateCheckDue,
  setInstallOnExit,
  updateErrorCode,
  updaterInfo,
  UPDATE_PROGRESS_EVENT,
  UPDATE_SCHEDULER_INTERVAL_MS,
  type UpdateDescription,
  type UpdateProgress,
  type UpdaterInfo,
} from '../lib/updates'
import { useSettings } from './SettingsProvider'
import { useVault } from './VaultProvider'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'

interface UpdateContextValue {
  /** Vrai dans l’application desktop. */
  supported: boolean
  info: UpdaterInfo | null
  status: UpdateStatus
  update: UpdateDescription | null
  progress: UpdateProgress | null
  error: string | null
  /** L’utilisateur a choisi « Plus tard » pendant ce lancement. */
  noticeDismissed: boolean
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  later: () => void
  skip: () => Promise<void>
  /** Change de canal et oublie la mise à jour trouvée sur l’autre. */
  changeChannel: (channel: AppSettings['updateChannel']) => void
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

/**
 * État des mises à jour et planificateur. Sur le Web, la PWA se met à jour
 * par son service worker : ce fournisseur reste inactif.
 */
export function UpdateProvider({ children }: { children: ReactNode }) {
  const supported = isTauriRuntime()
  const { settings, updateSettings } = useSettings()
  const { prepareForRestart } = useVault()
  const [info, setInfo] = useState<UpdaterInfo | null>(null)
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [update, setUpdate] = useState<UpdateDescription | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [noticeDismissed, setNoticeDismissed] = useState(false)

  const settingsRef = useRef(settings)
  const statusRef = useRef(status)
  const checkedThisLaunch = useRef(false)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    if (!supported) return
    let active = true
    void updaterInfo()
      .then((value) => {
        if (active) setInfo(value)
      })
      .catch(() => {
        if (active) setInfo({ configured: false, currentVersion: '' })
      })
    return () => {
      active = false
    }
  }, [supported])

  useEffect(() => {
    if (!supported) return
    let unlisten: (() => void) | undefined
    let active = true
    void listen<UpdateProgress>(UPDATE_PROGRESS_EVENT, (event) => {
      setProgress(event.payload)
    }).then((stop) => {
      if (active) unlisten = stop
      else stop()
    })
    return () => {
      active = false
      unlisten?.()
    }
  }, [supported])

  const download = useCallback(async () => {
    if (!supported) return
    if (statusRef.current !== 'available' && statusRef.current !== 'error') return
    setStatus('downloading')
    setProgress(null)
    setError(null)
    try {
      await downloadUpdate()
      setStatus('ready')
      if (settingsRef.current.updateInstallMode === 'on-quit') {
        await setInstallOnExit(true).catch(() => undefined)
      }
    } catch (reason) {
      setError(updateErrorCode(reason))
      setStatus('error')
    }
  }, [supported])

  const runCheck = useCallback(
    async (manual: boolean) => {
      if (!supported) return
      const busy = ['checking', 'downloading', 'installing'].includes(
        statusRef.current,
      )
      if (busy) return
      // Une mise à jour déjà téléchargée n’est pas remplacée en silence.
      if (!manual && statusRef.current === 'ready') return
      checkedThisLaunch.current = true
      setStatus('checking')
      setError(null)
      try {
        const found = await checkForUpdate(settingsRef.current.updateChannel)
        updateSettings({ updateLastCheckAt: new Date().toISOString() })
        if (!found) {
          setUpdate(null)
          setStatus('up-to-date')
          return
        }
        if (!manual && isSkippedVersion(settingsRef.current, found.version)) {
          setUpdate(null)
          setStatus('idle')
          await discardUpdate().catch(() => undefined)
          return
        }
        setUpdate(found)
        setNoticeDismissed(false)
        statusRef.current = 'available'
        setStatus('available')
        if (settingsRef.current.updateAutoDownload) await download()
      } catch (reason) {
        setError(updateErrorCode(reason))
        setStatus(manual ? 'error' : 'idle')
      }
    },
    [supported, updateSettings, download],
  )

  const check = useCallback(() => runCheck(true), [runCheck])

  const install = useCallback(async () => {
    if (!supported || statusRef.current !== 'ready') return
    setStatus('installing')
    setError(null)
    try {
      // Le coffre est verrouillé et les écritures en cours terminées avant que
      // l’application soit remplacée et redémarrée.
      await prepareForRestart()
      await installUpdate()
    } catch (reason) {
      setError(updateErrorCode(reason))
      setStatus('error')
    }
  }, [supported, prepareForRestart])

  const later = useCallback(() => setNoticeDismissed(true), [])

  const skip = useCallback(async () => {
    if (!update) return
    updateSettings({ updateSkippedVersion: update.version })
    await setInstallOnExit(false).catch(() => undefined)
    await discardUpdate().catch(() => undefined)
    setUpdate(null)
    setProgress(null)
    setStatus('idle')
  }, [update, updateSettings])

  // Planificateur : au lancement, puis toutes les heures selon la fréquence.
  useEffect(() => {
    if (!supported || !info?.configured) return
    const tick = () => {
      if (
        isUpdateCheckDue(settingsRef.current, new Date(), checkedThisLaunch.current)
      ) {
        void runCheck(false)
      }
    }
    tick()
    const timer = window.setInterval(tick, UPDATE_SCHEDULER_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [supported, info?.configured, settings.updateCheck, runCheck])

  // Changer de canal oublie la mise à jour trouvée sur l’autre canal.
  const changeChannel = useCallback(
    (channel: AppSettings['updateChannel']) => {
      if (channel === settingsRef.current.updateChannel) return
      updateSettings({ updateChannel: channel })
      if (!supported) return
      void setInstallOnExit(false).catch(() => undefined)
      void discardUpdate().catch(() => undefined)
      setUpdate(null)
      setProgress(null)
      setError(null)
      setStatus('idle')
    },
    [supported, updateSettings],
  )

  // Le mode d’installation peut changer après le téléchargement.
  useEffect(() => {
    if (!supported || status !== 'ready') return
    void setInstallOnExit(settings.updateInstallMode === 'on-quit').catch(
      () => undefined,
    )
  }, [supported, status, settings.updateInstallMode])

  const value = useMemo<UpdateContextValue>(
    () => ({
      supported,
      info,
      status,
      update,
      progress,
      error,
      noticeDismissed,
      check,
      download,
      install,
      later,
      skip,
      changeChannel,
    }),
    [
      supported,
      info,
      status,
      update,
      progress,
      error,
      noticeDismissed,
      check,
      download,
      install,
      later,
      skip,
      changeChannel,
    ],
  )

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}

export function useUpdates(): UpdateContextValue {
  const context = useContext(UpdateContext)
  if (!context) throw new Error('useUpdates doit être utilisé dans UpdateProvider')
  return context
}
