import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AlertTriangle, Keyboard, LoaderCircle } from 'lucide-react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { useVault } from '../state/VaultProvider'
import { generateTotp, isTotpUri, parseTotpUri } from '../lib/totp'
import {
  autotypeActiveWindow,
  autotypeAvailable,
  DEFAULT_AUTOTYPE_SEQUENCE,
  runAutoType,
} from '../lib/autotype'
import type { LoginItem } from '../lib/types'
import type { ActiveWindowInfo } from '../lib/autotype'

interface AutoTypeDialogProps {
  item: LoginItem
  targetWindow?: ActiveWindowInfo
  onClose: () => void
}

export function AutoTypeDialog({ item, targetWindow, onClose }: AutoTypeDialogProps) {
  const { tt } = useI18n()
  const { toast } = useToast()
  const { recordActivity } = useVault()
  const [countdown, setCountdown] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!running) return
    if (countdown > 0) {
      const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000)
      return () => window.clearTimeout(timer)
    }
    void typeIntoActiveWindow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, running])

  if (!autotypeAvailable()) return null

  const start = () => {
    setRunning(true)
    setCountdown(targetWindow ? 0 : 3)
    setBusy(true)
    setError(null)
  }

  const typeIntoActiveWindow = async () => {
    try {
      const current = getCurrentWindow()
      await current.hide()
      await new Promise((resolve) => window.setTimeout(resolve, 650))
      const target = targetWindow ?? (await autotypeActiveWindow())
      if (target.appName.toLowerCase().includes('coffre')) {
        throw new Error(tt('Activez la fenêtre cible avant la fin du compte à rebours.'))
      }
      let totp = ''
      if (item.totp && isTotpUri(item.totp)) {
        try {
          totp = await generateTotp(parseTotpUri(item.totp))
        } catch {
          totp = ''
        }
      }
      await runAutoType({
        sequence: item.autotypeSequence || DEFAULT_AUTOTYPE_SEQUENCE,
        username: item.username,
        password: item.password,
        totp,
        expectedWindowId: target.windowId,
        expectedProcessId: target.processId,
      })
      void recordActivity('autotype', item.title, target.appName)
      await current.show()
      await current.setFocus()
      toast(tt('Saisie automatique effectuée.'), 'success')
      onClose()
    } catch (caught) {
      try {
        await getCurrentWindow().show()
        await getCurrentWindow().setFocus()
      } catch {
        // La fenêtre peut déjà être visible.
      }
      setError(
        caught instanceof Error ? caught.message : tt('Saisie automatique impossible.'),
      )
      setBusy(false)
    }
  }

  return (
    <Modal
      title={tt('Saisie automatique')}
      description={tt(
        'Coffre va masquer sa fenêtre puis taper la séquence dans l’application active.',
      )}
      size="sm"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="button button--primary"
          onClick={start}
          disabled={busy}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <Keyboard size={16} />}
          {busy
            ? targetWindow
              ? tt('Saisie…')
              : `${countdown}…`
            : tt('Démarrer')}
        </button>
      }
    >
      <div className="form">
        <p className="settings-copy">
          {tt('Séquence')} : <code>{item.autotypeSequence || DEFAULT_AUTOTYPE_SEQUENCE}</code>
        </p>
        <p className="field__hint">
          {tt(
            'Après le démarrage, activez la fenêtre cible. La saisie est annulée si le focus change en cours de route.',
          )}
        </p>
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
