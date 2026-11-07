import { useMemo, useState } from 'react'
import { AlertTriangle, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'
import { Modal } from './Modal'
import { PasswordStrength } from './PasswordStrength'
import { useVault } from '../state/VaultProvider'
import { estimateEntropy } from '../lib/crypto'
import { isRecoveryPhrase, RECOVERY_WORDS } from '../lib/recovery'

interface RecoveryUnlockDialogProps {
  onClose: () => void
}

/**
 * Déverrouillage par phrase de récupération. Comme la phrase ne permet pas de
 * retrouver le mot de passe maître d’origine, un nouveau mot de passe est
 * imposé dans la même étape.
 */
export function RecoveryUnlockDialog({ onClose }: RecoveryUnlockDialogProps) {
  const { recoverWithPhrase } = useVault()
  const [phrase, setPhrase] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const entropy = useMemo(() => estimateEntropy(password), [password])
  const strongEnough = password.length >= 12 && entropy >= 50
  const matches = password.length > 0 && password === confirmPassword
  const phraseValid = isRecoveryPhrase(phrase)
  const canSubmit = phraseValid && strongEnough && matches && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await recoverWithPhrase(phrase, password)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Récupération impossible')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Déverrouiller par récupération"
      description="Saisissez votre phrase de récupération, puis choisissez un nouveau mot de passe maître."
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <KeyRound size={16} />}
            Récupérer le coffre
          </button>
        </>
      }
    >
      <div className="form">
        <label className="field field--full">
          <span className="field__label">Phrase de récupération</span>
          <textarea
            className="input input--mono"
            rows={3}
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            placeholder={`${RECOVERY_WORDS} mots, séparés par des espaces`}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            data-autofocus
          />
          {phrase.length > 0 && !phraseValid && (
            <span className="field__hint field__hint--error">
              La phrase doit contenir {RECOVERY_WORDS} mots.
            </span>
          )}
        </label>

        <label className="field">
          <span className="field__label">Nouveau mot de passe maître</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="12 caractères minimum"
          />
          {password.length > 0 && <PasswordStrength entropy={entropy} />}
        </label>

        <label className="field">
          <span className="field__label">Confirmer le mot de passe</span>
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Répétez le mot de passe"
          />
          {confirmPassword.length > 0 && !matches && (
            <span className="field__hint field__hint--error">
              Les mots de passe ne correspondent pas.
            </span>
          )}
        </label>

        <p className="settings-copy">
          <ShieldCheck size={15} /> L’ancien mot de passe maître ne fonctionnera plus. Vos
          éléments, versions et pièces jointes sont conservés.
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
