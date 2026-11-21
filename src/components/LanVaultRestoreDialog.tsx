import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, LoaderCircle, RefreshCw, Wifi } from 'lucide-react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { useVault } from '../state/VaultProvider'
import {
  formatFingerprint,
  lanPairJoin,
  lanSyncPull,
  type LanPeer,
} from '../lib/lanSync'
import { isMobileRuntime } from '../lib/platform'
import {
  FirstVaultEmptyError,
  pullFirstVault,
} from '../lib/lanBootstrap'

/**
 * Premier coffre sur un nouvel appareil : appairage avec un appareil déjà
 * configuré, réception du fichier chiffré par le réseau local, puis import.
 * Aucun fichier n’est nécessaire au départ ; les pièces jointes blob sont
 * demandées en même temps que le coffre.
 */
export function LanVaultRestoreDialog({ onClose }: { onClose: () => void }) {
  const { importVault } = useVault()
  const { t } = useI18n()
  const { toast } = useToast()
  const [code, setCode] = useState('')
  const [peer, setPeer] = useState<LanPeer | null>(null)
  const [fileText, setFileText] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [blobs, setBlobs] = useState(0)
  const [busy, setBusy] = useState<'pair' | 'pull' | 'import' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)
  const deviceName = isMobileRuntime() ? 'Coffre Android' : 'Coffre'

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const close = () => {
    cancelledRef.current = true
    onClose()
  }

  const receive = async (target: LanPeer) => {
    setBusy('pull')
    setError(null)
    try {
      const result = await pullFirstVault(
        () => lanSyncPull(target.id, '', []),
        { cancelled: () => cancelledRef.current },
      )
      if (cancelledRef.current) return
      setFileText(result.file)
      setBlobs(result.blobsReceived)
      setBusy(null)
      toast(t('auth.lan.receivedToast'), 'success')
    } catch (caught) {
      if (cancelledRef.current) return
      setError(
        caught instanceof FirstVaultEmptyError
          ? t('auth.lan.empty')
          : caught instanceof Error && caught.message
            ? caught.message
            : t('auth.lan.receiveError'),
      )
      setBusy(null)
    }
  }

  const pair = async () => {
    if (!code.trim()) return
    setBusy('pair')
    setError(null)
    try {
      const joined = await lanPairJoin(code.trim(), deviceName)
      if (cancelledRef.current) return
      setPeer(joined)
      setCode('')
      setBusy(null)
      void receive(joined)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t('auth.lan.pairError'),
      )
      setBusy(null)
    }
  }

  const importVaultFile = async () => {
    if (!fileText || !password) return
    setBusy('import')
    setError(null)
    try {
      await importVault(fileText, password)
      toast(t('auth.lan.success'), 'success')
      onClose()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t('auth.lan.importError'),
      )
      setBusy(null)
    }
  }

  const canClose = busy !== 'import'
  const footer = fileText ? (
    <>
      <button
        type="button"
        className="button button--secondary"
        onClick={close}
        disabled={!canClose}
      >
        {t('common.cancel')}
      </button>
      <button
        type="button"
        className="button button--primary"
        onClick={() => void importVaultFile()}
        disabled={!password || busy !== null}
      >
        {busy === 'import' ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Check size={16} />
        )}
        {t('auth.lan.import')}
      </button>
    </>
  ) : peer ? (
    <>
      <button
        type="button"
        className="button button--secondary"
        onClick={close}
        disabled={!canClose}
      >
        {t('common.cancel')}
      </button>
      {error && busy === null && (
        <button
          type="button"
          className="button button--primary"
          onClick={() => void receive(peer)}
        >
          <RefreshCw size={16} />
          {t('auth.lan.retry')}
        </button>
      )}
    </>
  ) : (
    <>
      <button type="button" className="button button--secondary" onClick={close}>
        {t('common.cancel')}
      </button>
      <button
        type="button"
        className="button button--primary"
        onClick={() => void pair()}
        disabled={!code.trim() || busy !== null}
      >
        {busy === 'pair' ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Wifi size={16} />
        )}
        {t('auth.lan.pair')}
      </button>
    </>
  )

  return (
    <Modal
      title={t('auth.lan.title')}
      description={t('auth.lan.description')}
      size="sm"
      onClose={close}
      footer={footer}
    >
      <div className="stack">
        {!peer && (
          <label className="field">
            <span className="field__label">{t('auth.lan.code')}</span>
            <input
              className="input input--mono"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="coffre-lan://pair/…"
              autoComplete="off"
              spellCheck={false}
              data-autofocus
            />
            <span className="field__hint">{t('auth.lan.codeHint')}</span>
          </label>
        )}

        {peer && !fileText && (
          <>
            <p className="settings-copy">
              {t('auth.lan.paired').replace(
                '{name}',
                peer.name || formatFingerprint(peer.id).slice(0, 14),
              )}
            </p>
            <p className="settings-copy">{t('auth.lan.instructions')}</p>
            {busy === 'pull' && (
              <p className="field__hint auth__lan-waiting" role="status">
                <LoaderCircle size={16} className="spin" />
                {t('auth.lan.waiting')}
              </p>
            )}
          </>
        )}

        {fileText && (
          <>
            <p className="settings-copy">
              {t('auth.lan.received')}
              {blobs > 0
                ? ` ${t('auth.lan.blobs').replace('{count}', String(blobs))}`
                : ''}
            </p>
            <label className="field">
              <span className="field__label">{t('auth.lan.password')}</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
                data-autofocus
              />
            </label>
          </>
        )}

        {error && (
          <p className="form-error" role="alert">
            <AlertTriangle size={16} />
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

