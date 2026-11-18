import { useState } from 'react'
import { Check, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { Modal } from './Modal'
import { PasswordStrength } from './PasswordStrength'
import { useVault } from '../state/VaultProvider'
import { useSettings } from '../state/SettingsProvider'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { copySensitive } from '../lib/clipboard'
import { generatePassword } from '../lib/password'
import { loadGeneratorPreferences } from '../lib/generatorOptions'
import { estimateEntropy } from '../lib/strength'
import { defaultExpiryDate } from '../lib/expiry'
import { changePasswordUrl, safeExternalUrl } from '../lib/url'
import { openExternal } from '../lib/external'
import type { LoginItem } from '../lib/types'

interface PasswordChangeDialogProps {
  item: LoginItem
  onClose: () => void
  onSaved: (item: LoginItem) => void
}

/**
 * Assistant de changement de mot de passe : ouvre la page du site, propose un
 * mot de passe fort, puis enregistre la valeur réellement choisie. L’ancien
 * mot de passe reste dans l’historique de l’élément.
 */
export function PasswordChangeDialog({
  item,
  onClose,
  onSaved,
}: PasswordChangeDialogProps) {
  const { updateItem } = useVault()
  const { settings } = useSettings()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [password, setPassword] = useState(() =>
    generatePassword(loadGeneratorPreferences().password),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const siteUrl =
    changePasswordUrl(item.urls) ??
    item.urls
      .map((url) => safeExternalUrl(url))
      .find((url): url is string => url !== null) ??
    null

  const copyPassword = async () => {
    const ok = await copySensitive(password, settings.clipboardClearSeconds)
    if (!ok) {
      setError(tt('Copie impossible.'))
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  const regenerate = () => {
    setPassword(generatePassword(loadGeneratorPreferences().password))
    setError(null)
  }

  const save = async () => {
    if (!password) {
      setError(tt('Le mot de passe ne peut pas être vide.'))
      return
    }
    if (password === item.password) {
      setError(tt('Le nouveau mot de passe doit être différent de l’actuel.'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await updateItem({
        ...item,
        password,
        expiresAt: defaultExpiryDate(),
      })
      toast(tt('Mot de passe mis à jour.'), 'success')
      onSaved(updated as LoginItem)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : tt('Mise à jour impossible.'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={tt('Changer le mot de passe')}
      description={item.title}
      size="md"
      onClose={onClose}
      footer={
        <div className="modal__footer-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={onClose}
          >
            {tt('Annuler')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void save()}
            disabled={busy}
          >
            {busy ? (
              <RefreshCw size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}
            {tt('Enregistrer dans Coffre')}
          </button>
        </div>
      }
    >
      <div className="password-change">
        <ol className="password-change__steps">
          <li>
            <span className="password-change__step" aria-hidden="true">
              1
            </span>
            <div>
              <strong>{tt('Changer sur le site')}</strong>
              <p>
                {tt(
                  'Ouvrez la page de changement de mot de passe du site, puis utilisez le mot de passe proposé ci-dessous.',
                )}
              </p>
              {siteUrl ? (
                <button
                  type="button"
                  className="button button--secondary button--sm"
                  onClick={() => void openExternal(siteUrl)}
                >
                  <ExternalLink size={15} />
                  {tt('Ouvrir la page')}
                </button>
              ) : (
                <p className="field__hint">
                  {tt('Aucune adresse n’est enregistrée pour cet élément.')}
                </p>
              )}
            </div>
          </li>
          <li>
            <span className="password-change__step" aria-hidden="true">
              2
            </span>
            <div>
              <strong>{tt('Mot de passe proposé')}</strong>
              <div className="password-change__generated">
                <input
                  className="input input--mono"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-label={tt('Nouveau mot de passe')}
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="icon-button icon-button--sm"
                  onClick={() => void copyPassword()}
                  aria-label={tt('Copier le mot de passe')}
                  title={tt('Copier le mot de passe')}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--sm"
                  onClick={regenerate}
                  aria-label={tt('Régénérer')}
                  title={tt('Régénérer')}
                >
                  <RefreshCw size={15} />
                </button>
              </div>
              <PasswordStrength entropy={estimateEntropy(password)} />
              <p className="field__hint">
                {tt(
                  'Généré localement selon vos préférences. Copiez-le avant de changer le mot de passe sur le site.',
                )}
              </p>
            </div>
          </li>
          <li>
            <span className="password-change__step" aria-hidden="true">
              3
            </span>
            <div>
              <strong>{tt('Enregistrer dans Coffre')}</strong>
              <p>
                {tt(
                  'Une fois le changement confirmé sur le site, enregistrez le nouveau mot de passe ici. L’ancien reste dans l’historique et un rappel d’échéance est fixé à un an.',
                )}
              </p>
            </div>
          </li>
        </ol>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
