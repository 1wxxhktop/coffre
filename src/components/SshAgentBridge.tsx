import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'
import { useVault } from '../state/VaultProvider'
import { isTauriRuntime } from '../lib/external'
import {
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
  const { status } = useVault()
  const { t } = useI18n()
  const [requests, setRequests] = useState<SshAgentApproval[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isTauriRuntime()) return
    let unlisten: (() => void) | undefined
    void onSshAgentApproval((payload) => {
      setRequests((previous) => [...previous, payload])
    }).then((cleanup) => {
      unlisten = cleanup
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) return
    if (status !== 'unlocked') {
      setRequests([])
      void stopSshAgent()
    }
  }, [status])

  useEffect(
    () => () => {
      void stopSshAgent()
    },
    [],
  )

  const request = requests[0] ?? null
  const decide = async (approved: boolean) => {
    if (!request || busy) return
    setBusy(true)
    try {
      await respondSshAgent(request.id, approved)
    } finally {
      setBusy(false)
      setRequests((previous) => previous.slice(1))
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
      </div>
    </Modal>
  )
}
