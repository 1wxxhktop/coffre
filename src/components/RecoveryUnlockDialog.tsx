import { useMemo, useState, type KeyboardEvent } from 'react'
import {
  AlertTriangle,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { Modal } from './Modal'
import { PasswordStrength } from './PasswordStrength'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { estimateEntropy } from '../lib/strength'
import { isRecoveryPhrase, RECOVERY_WORDS } from '../lib/recovery'
import { parseShareInput } from '../lib/shamir'
import { nextTabIndex } from '../lib/rovingTabs'

interface RecoveryUnlockDialogProps {
  onClose: () => void
}

type RecoveryMode = 'phrase' | 'shares'

/**
 * Déverrouillage par phrase de récupération ou par parts Shamir. Comme ces
 * méthodes ne permettent pas de retrouver le mot de passe maître d’origine, un
 * nouveau mot de passe est imposé dans la même étape.
 */
export function RecoveryUnlockDialog({ onClose }: RecoveryUnlockDialogProps) {
  const { recoverWithPhrase, recoverWithShares } = useVault()
  const { tt } = useI18n()
  const [mode, setMode] = useState<RecoveryMode>('phrase')
  const [phrase, setPhrase] = useState('')
  const [shareInputs, setShareInputs] = useState<string[]>(['', '', ''])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const entropy = useMemo(() => estimateEntropy(password), [password])
  const strongEnough = password.length >= 12 && entropy >= 50
  const matches = password.length > 0 && password === confirmPassword
  const phraseValid = isRecoveryPhrase(phrase)

  const filledShares = useMemo(
    () => shareInputs.map((value) => value.trim()).filter(Boolean),
    [shareInputs],
  )
  const sharesValid = useMemo(() => {
    if (filledShares.length < 2) return false
    try {
      for (const value of filledShares) parseShareInput(value)
      return true
    } catch {
      return false
    }
  }, [filledShares])

  const methodValid = mode === 'phrase' ? phraseValid : sharesValid
  const canSubmit = methodValid && strongEnough && matches && !busy

  const updateShare = (index: number, value: string) => {
    setShareInputs((previous) =>
      previous.map((entry, position) => (position === index ? value : entry)),
    )
    setError(null)
  }

  const addShare = () => {
    if (shareInputs.length >= 10) return
    setShareInputs((previous) => [...previous, ''])
  }

  const removeShare = (index: number) => {
    if (shareInputs.length <= 2) return
    setShareInputs((previous) => previous.filter((_, position) => position !== index))
  }

  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]:not(:disabled)',
      ),
    )
    const next = nextTabIndex(
      event.key,
      tabs.indexOf(document.activeElement as HTMLButtonElement),
      tabs.length,
    )
    if (next === null) return
    event.preventDefault()
    tabs[next].focus()
    tabs[next].click()
  }

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'phrase') {
        await recoverWithPhrase(phrase, password)
      } else {
        await recoverWithShares(filledShares, password)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Récupération impossible')
      setBusy(false)
    }
  }

  const title =
    mode === 'phrase'
      ? 'Déverrouiller par récupération'
      : 'Déverrouiller avec des parts'
  const description =
    mode === 'phrase'
      ? 'Saisissez votre phrase de récupération, puis choisissez un nouveau mot de passe maître.'
      : 'Saisissez les parts de votre kit d’urgence, puis choisissez un nouveau mot de passe maître.'

  return (
    <Modal
      title={title}
      description={description}
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
        <div
          className="type-picker"
          role="tablist"
          aria-label={tt('Méthode de récupération')}
          onKeyDown={onTabsKeyDown}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'phrase'}
            tabIndex={mode === 'phrase' ? 0 : -1}
            className={`type-picker__item ${mode === 'phrase' ? 'is-active' : ''}`}
            onClick={() => {
              setMode('phrase')
              setError(null)
            }}
          >
            {tt('Phrase de récupération')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'shares'}
            tabIndex={mode === 'shares' ? 0 : -1}
            className={`type-picker__item ${mode === 'shares' ? 'is-active' : ''}`}
            onClick={() => {
              setMode('shares')
              setError(null)
            }}
          >
            Parts de secours
          </button>
        </div>

        {mode === 'phrase' ? (
          <label className="field field--full">
            <span className="field__label">{tt('Phrase de récupération')}</span>
            <textarea
              className="input input--mono"
              rows={3}
              value={phrase}
              onChange={(event) => {
                setPhrase(event.target.value)
                setError(null)
              }}
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
        ) : (
          <div className="recovery-shares">
            <p className="settings-copy">
              <ShieldCheck size={15} /> Chaque part provient de votre kit d’urgence.
              Saisissez au moins le nombre de parts requis (k) ; elles peuvent être
              saisies dans n’importe quel ordre.
            </p>
            {shareInputs.map((value, index) => (
              <div className="field field--full" key={index}>
                <span className="field__label">
                  <label htmlFor={`recovery-share-${index}`}>Part {index + 1}</label>
                  {index >= 2 && (
                    <button
                      type="button"
                      className="link-button link-button--danger recovery-shares__remove"
                      onClick={() => removeShare(index)}
                      disabled={busy}
                    >
                      <Trash2 size={13} />
                      Retirer
                    </button>
                  )}
                </span>
                <textarea
                  id={`recovery-share-${index}`}
                  className="input input--mono"
                  rows={3}
                  value={value}
                  onChange={(event) => updateShare(index, event.target.value)}
                  placeholder={tt('Mots de la part, ou contenu du QR code')}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            ))}
            <button
              type="button"
              className="link-button"
              onClick={addShare}
              disabled={shareInputs.length >= 10 || busy}
            >
              <Plus size={14} />
              Ajouter une part
            </button>
            {filledShares.length > 0 && !sharesValid && (
              <span className="field__hint field__hint--error">
                Chaque part doit contenir ses mots ou le contenu d’un QR code, et au moins
                deux parts sont nécessaires.
              </span>
            )}
          </div>
        )}

        <label className="field">
          <span className="field__label">{tt('Nouveau mot de passe maître')}</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder={tt('12 caractères minimum')}
          />
          {password.length > 0 && <PasswordStrength entropy={entropy} />}
        </label>

        <label className="field">
          <span className="field__label">{tt('Confirmer le mot de passe')}</span>
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            placeholder={tt('Répétez le mot de passe')}
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
