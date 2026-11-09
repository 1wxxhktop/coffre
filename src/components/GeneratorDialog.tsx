import { useMemo, useState } from 'react'
import { Check, Copy, Dices, RefreshCw, Wand2 } from 'lucide-react'
import { Modal } from './Modal'
import { PasswordStrength } from './PasswordStrength'
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  generatePassphrase,
  generatePassword,
  generatedEntropy,
  passphraseEntropy,
  wordlistSize,
  type PassphraseOptions,
  type PasswordOptions,
} from '../lib/generator'
import { copySensitive } from '../lib/clipboard'
import { generatePasswordForRules, passwordRulesForUrl, sitePasswordEntropy } from '../lib/passwordRules'
import { useI18n } from '../state/I18nProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'

interface GeneratorDialogProps {
  onClose: () => void
  onUse?: (value: string) => void
  /** URL ou hôte permettant d’appliquer les règles du site. */
  url?: string
}

type Mode = 'password' | 'passphrase'

export function GeneratorDialog({ onClose, onUse, url }: GeneratorDialogProps) {
  const { settings } = useSettings()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [mode, setMode] = useState<Mode>('password')
  const [passwordOptions, setPasswordOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS)
  const [passphraseOptions, setPassphraseOptions] =
    useState<PassphraseOptions>(DEFAULT_PASSPHRASE_OPTIONS)
  const [copied, setCopied] = useState(false)

  const siteRules = useMemo(() => passwordRulesForUrl(url ?? ''), [url])
  const password = useMemo(
    () =>
      siteRules
        ? generatePasswordForRules(siteRules.rules, passwordOptions.length)
        : generatePassword(passwordOptions),
    [passwordOptions, siteRules],
  )
  const passphrase = useMemo(
    () => generatePassphrase(passphraseOptions),
    [passphraseOptions],
  )

  const value = mode === 'password' ? password : passphrase
  const entropy =
    mode === 'password'
      ? siteRules
        ? sitePasswordEntropy(siteRules.rules, passwordOptions.length)
        : generatedEntropy(passwordOptions)
      : passphraseEntropy(passphraseOptions)

  const updatePassword = (partial: Partial<PasswordOptions>) => {
    setPasswordOptions((previous) => ({ ...previous, ...partial }))
    setCopied(false)
  }

  const updatePassphrase = (partial: Partial<PassphraseOptions>) => {
    setPassphraseOptions((previous) => ({ ...previous, ...partial }))
    setCopied(false)
  }

  const regenerate = () => {
    // De nouveaux objets d’options forcent la régénération des deux modes.
    setPasswordOptions((previous) => ({ ...previous }))
    setPassphraseOptions((previous) => ({ ...previous }))
    setCopied(false)
  }

  const copy = async () => {
    const success = await copySensitive(value, settings.clipboardClearSeconds, () =>
      toast(tt('Presse-papiers effacé'), 'info'),
    )
    if (!success) {
      toast(tt('Impossible de copier'), 'error')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    toast(tt('Valeur copiée'), 'success')
  }

  const use = () => {
    onUse?.(value)
    onClose()
  }

  return (
    <Modal
      title={tt('Générateur')}
      description={tt(
        'Généré localement avec le générateur cryptographique du navigateur.',
      )}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={regenerate}>
            <RefreshCw size={16} />
            Régénérer
          </button>
          <div className="modal__footer-actions">
            <button type="button" className="button button--secondary" onClick={() => void copy()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copié' : 'Copier'}
            </button>
            {onUse && (
              <button type="button" className="button button--primary" onClick={use}>
                <Wand2 size={16} />
                Utiliser
              </button>
            )}
          </div>
        </>
      }
    >
      <div className="generator">
        {mode === 'password' && siteRules && (
          <p className="settings-copy">
            {tt('Règles du site appliquées :')} <strong>{siteRules.domain}</strong>
          </p>
        )}
        <div className="tabs" role="tablist" aria-label={tt('Type de secret')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'password'}
            className={`tab ${mode === 'password' ? 'is-active' : ''}`}
            onClick={() => setMode('password')}
          >
            Mot de passe
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'passphrase'}
            className={`tab ${mode === 'passphrase' ? 'is-active' : ''}`}
            onClick={() => setMode('passphrase')}
          >
            Phrase de passe
          </button>
        </div>

        <div className="generator__output">
          <code>{value}</code>
          <button
            type="button"
            className="icon-button"
            onClick={() => void copy()}
            aria-label={tt('Copier la valeur générée')}
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>

        <PasswordStrength entropy={entropy} showEntropy />

        {mode === 'password' ? (
          <div className="generator__settings">
            <label className="field">
              <span className="field__label">
                Longueur <strong>{passwordOptions.length}</strong>
              </span>
              <input
                type="range"
                min={8}
                max={64}
                step={1}
                value={passwordOptions.length}
                onChange={(event) =>
                  updatePassword({ length: Number(event.target.value) })
                }
                className="range"
              />
            </label>

            <div className="toggle-grid">
              <Toggle
                label="Minuscules"
                checked={passwordOptions.lowercase}
                onChange={(lowercase) => updatePassword({ lowercase })}
              />
              <Toggle
                label="Majuscules"
                checked={passwordOptions.uppercase}
                onChange={(uppercase) => updatePassword({ uppercase })}
              />
              <Toggle
                label="Chiffres"
                checked={passwordOptions.digits}
                onChange={(digits) => updatePassword({ digits })}
              />
              <Toggle
                label="Symboles"
                checked={passwordOptions.symbols}
                onChange={(symbols) => updatePassword({ symbols })}
              />
            </div>

            <Toggle
              label="Éviter les caractères ambigus (O, 0, I, l, 1…)"
              checked={passwordOptions.excludeAmbiguous}
              onChange={(excludeAmbiguous) => updatePassword({ excludeAmbiguous })}
            />
          </div>
        ) : (
          <div className="generator__settings">
            <label className="field">
              <span className="field__label">
                Nombre de mots <strong>{passphraseOptions.words}</strong>
              </span>
              <input
                type="range"
                min={3}
                max={10}
                step={1}
                value={passphraseOptions.words}
                onChange={(event) =>
                  updatePassphrase({ words: Number(event.target.value) })
                }
                className="range"
              />
            </label>

            <label className="field">
              <span className="field__label">{tt('Séparateur')}</span>
              <select
                className="input"
                value={passphraseOptions.separator}
                onChange={(event) => updatePassphrase({ separator: event.target.value })}
              >
                <option value="-">{tt('Tiret ( - )')}</option>
                <option value=".">{tt('Point ( . )')}</option>
                <option value="_">{tt('Tiret bas ( _ )')}</option>
                <option value=" ">{tt('Espace')}</option>
              </select>
            </label>

            <Toggle
              label="Majuscule au début de chaque mot"
              checked={passphraseOptions.capitalize}
              onChange={(capitalize) => updatePassphrase({ capitalize })}
            />
            <Toggle
              label="Ajouter un nombre à la fin"
              checked={passphraseOptions.includeNumber}
              onChange={(includeNumber) => updatePassphrase({ includeNumber })}
            />

            <p className="generator__note">
              <Dices size={15} />
              Liste EFF de {wordlistSize().toLocaleString('fr-FR')} mots, ~12,9 bits par mot.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span>{label}</span>
    </label>
  )
}
