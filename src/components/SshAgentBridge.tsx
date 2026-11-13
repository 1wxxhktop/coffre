import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'
import { isDesktopRuntime } from '../lib/platform'
import { biometricAvailable, biometricSupported } from '../lib/biometrics'
import {
  confirmSshAgentBiometrics,
  onSshAgentApproval,
  respondSshAgent,
  stopSshAgent,
  type SshAgentApproval,
} from '../lib/sshAgent'

/**
 * Relaie les demandes de signature de l’agent SSH vers une modale bloquante.
 * L’agent est arrêté dès que le coffre n’est plus déverrouillé.
 */
export function SshAgentBridge() {
  const { settings } = useSettings()
  const { t } = useI18n()
  const { toast } = useToast()
  const [requests, setRequests] = useState<SshAgentApproval[]>([])
  const [busy, setBusy] = useState(false)
  const [touchIdAvailable, setTouchIdAvailable] = useState(false)
  const [remember, setRemember] = useState(false)
  const graceRef = useRef(new Map<string, number>())
  const touchIdEnabled =
    isDesktopRuntime() && settings.biometricUnlock && biometricSupported()
  // La disponibilité est dérivée des réglages et de la sonde asynchrone : pas
  // de setState synchrone quand les réglages changent.
  const touchIdReady = touchIdEnabled && touchIdAvailable

  useEffect(() => {
    if (!touchIdEnabled) return
    let cancelled = false
    void biometricAvailable().then((available) => {
      if (!cancelled) setTouchIdAvailable(available)
    })
    return () => {
      cancelled = true
    }
  }, [touchIdEnabled])

  useEffect(() => {
    if (!isDesktopRuntime()) return
    let unlisten: (() => void) | undefined
    void onSshAgentApproval((payload) => {
      if ((graceRef.current.get(payload.fingerprint) ?? 0) > Date.now()) {
        void respondSshAgent(payload.id, true).catch(() => {})
        return
      }
      setRequests((previous) => [...previous, payload])
    }).then((cleanup) => {
      unlisten = cleanup
    })
    return () => unlisten?.()
  }, [])

  // `VaultApp` n’est monté que lorsque le coffre est déverrouillé : le
  // démontage arrête l’agent et efface les demandes en attente.
  useEffect(
    () => () => {
      graceRef.current.clear()
      void stopSshAgent()
    },
    [],
  )

  const request = requests[0] ?? null
  const decide = async (approved: boolean) => {
    if (!request || busy) return
    setBusy(true)
    try {
      if (
        approved &&
        touchIdReady &&
        !(await confirmSshAgentBiometrics(t('sshAgent.approval.touchId')))
      ) {
        toast(t('sshAgent.approval.touchIdCancelled'), 'error')
        return
      }
      if (approved && remember) {
        graceRef.current.set(request.fingerprint, Date.now() + 15_000)
      }
      await respondSshAgent(request.id, approved)
      setRequests((previous) => previous.slice(1))
      setRemember(false)
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('sshAgent.error'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!request) return null

  return (
    <Modal
      title={t('sshAgent.approval.title')}
      description={t('sshAgent.approval.description')}
      size="sm"
      onClose={() => void decide(false)}
      footer={
        <>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void decide(false)}
            disabled={busy}
          >
            {t('sshAgent.approval.deny')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void decide(true)}
            disabled={busy}
          >
            {t('sshAgent.approval.approve')}
          </button>
        </>
      }
    >
      <div className="detail-list">
        <div className="detail-row">
          <span className="detail-row__label">{t('sshAgent.approval.key')}</span>
          <span className="detail-row__value">
            <span className="detail-row__text">{request.comment || '—'}</span>
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-row__label">{t('sshAgent.approval.fingerprint')}</span>
          <span className="detail-row__value mono">
            <span className="detail-row__text">{request.fingerprint}</span>
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-row__label">{t('sshAgent.approval.algorithm')}</span>
          <span className="detail-row__value mono">
            <span className="detail-row__text">{request.algorithm}</span>
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-row__label">{t('sshAgent.approval.data')}</span>
          <span className="detail-row__value">
            <span className="detail-row__text">
              {t('sshAgent.approval.bytes', { count: request.dataLen })}
            </span>
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-row__label">{t('sshAgent.approval.digest')}</span>
          <span className="detail-row__value mono">
            <span className="detail-row__text">{request.dataSha256}</span>
          </span>
        </div>
        {request.dataPreview && (
          <div className="detail-row detail-row--multiline">
            <span className="detail-row__label">{t('sshAgent.approval.preview')}</span>
            <span className="detail-row__value mono">
              <span className="detail-row__text">{request.dataPreview}</span>
            </span>
          </div>
        )}
      </div>
      {touchIdReady && (
        <p className="settings-copy">{t('sshAgent.approval.touchIdHint')}</p>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
        <span>{t('sshAgent.approval.remember')}</span>
      </label>
      <p className="settings-copy">{t('sshAgent.approval.rememberHint')}</p>
    </Modal>
  )
}
