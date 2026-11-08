import { useState } from 'react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'

interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  tone?: 'danger' | 'primary'
  requireText?: string
  busyLabel?: string
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  tone = 'danger',
  requireText,
  busyLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = !requireText || value.trim() === requireText

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.error'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      description={description}
      size="sm"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`button ${tone === 'danger' ? 'button--danger' : 'button--primary'}`}
            onClick={() => void submit()}
            disabled={!valid || busy}
          >
            {busy ? busyLabel ?? t('common.processing') : confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        {requireText && (
          <label className="field">
            <span className="field__label">
              {t('common.typeToConfirm', { text: requireText })}
            </span>
            <input
              className="input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              data-autofocus
            />
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    </Modal>
  )
}
