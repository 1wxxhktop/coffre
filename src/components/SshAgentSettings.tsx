import { useEffect, useState } from 'react'
import { Check, Copy, LoaderCircle, Terminal } from 'lucide-react'
import { copyToClipboard } from '../lib/clipboard'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { useVault } from '../state/VaultProvider'
import {
  sshAgentStatus,
  sshAgentSupported,
  startSshAgent,
  stopSshAgent,
  type SshAgentStatus,
} from '../lib/sshAgent'

export function SshAgentSettings() {
  const { session, items } = useVault()
  const { t } = useI18n()
  const { toast } = useToast()
  const [status, setStatus] = useState<SshAgentStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const available = sshAgentSupported()
  const keyCount = items.filter(
    (item) => (item as { type: string }).type === 'ssh-key' && !item.deletedAt,
  ).length

  useEffect(() => {
    if (!available) return
    let cancelled = false
    void sshAgentStatus()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch(() => {
        if (!cancelled) setStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [available])

  if (!available) return null

  const start = async () => {
    if (!session || busy) return
    setBusy(true)
    try {
      setStatus(await startSshAgent(session.masterKey))
      toast(t('sshAgent.started'), 'success')
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('sshAgent.error'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (busy) return
    setBusy(true)
    try {
      await stopSshAgent()
      setStatus(await sshAgentStatus())
      toast(t('sshAgent.stoppedToast'), 'success')
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('sshAgent.error'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const copySocket = async () => {
    if (!status?.socket) return
    if (await copyToClipboard(status.socket)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section__head">
        <span className="settings-section__icon">
          <Terminal size={18} />
        </span>
        <div>
          <h3>{t('sshAgent.title')}</h3>
          <p>{t('sshAgent.description')}</p>
        </div>
      </div>

      {status?.running ? (
        <>
          <p className="settings-copy">
            {t('sshAgent.running')} ·{' '}
            {t('sshAgent.identities', { count: status.identities })}
          </p>
          <div className="settings-actions settings-actions--start">
            <code className="mono">{status.socket}</code>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void copySocket()}
              aria-label={t('sshAgent.copySocket')}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {t('sshAgent.copySocket')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void stop()}
              disabled={busy}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : null}
              {t('sshAgent.stop')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="settings-copy">
            {keyCount === 0 ? t('sshAgent.noKeys') : t('sshAgent.stopped')}
          </p>
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void start()}
              disabled={busy || !session || keyCount === 0}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <Terminal size={16} />}
              {t('sshAgent.start')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
