import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldOff,
} from 'lucide-react'
import { Modal } from './Modal'
import { useVault } from '../state/VaultProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'
import { copySensitive } from '../lib/clipboard'
import { formatDateTime } from '../lib/settings'
import { generateRecoveryPhrase, isRecoveryPhrase } from '../lib/recovery'

interface RecoveryDialogProps {
  onClose: () => void
}

type Step = 'intro' | 'phrase' | 'remove'

/**
 * Gestion de la phrase de récupération optionnelle. La phrase est générée dans
 * le navigateur, affichée une seule fois, puis seule son enveloppe chiffrée est
 * enregistrée dans le fichier.
 */
export function RecoveryDialog({ onClose }: RecoveryDialogProps) {
  const { file, setRecoveryPhrase } = useVault()
  const { settings } = useSettings()
  const { toast } = useToast()

  const hasRecovery = Boolean(file?.recovery)
  const [step, setStep] = useState<Step>('intro')
  const [phrase, setPhrase] = useState('')
  const [copied, setCopied] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startGeneration = () => {
    setPhrase(generateRecoveryPhrase())
    setAcknowledged(false)
    setCopied(false)
    setError(null)
    setStep('phrase')
  }

  const copy = async () => {
    const success = await copySensitive(
      phrase,
      settings.clipboardClearSeconds,
      () => setCopied(false),
    )
    if (success) {
      setCopied(true)
      toast('Phrase copiée', 'success')
    } else {
      setError('La copie automatique a échoué ; notez la phrase manuellement.')
    }
  }

  const save = async () => {
    if (!isRecoveryPhrase(phrase) || !acknowledged) return
    setBusy(true)
    setError(null)
    try {
      await setRecoveryPhrase(phrase)
      toast(
        hasRecovery ? 'Phrase de récupération remplacée' : 'Phrase de récupération activée',
        'success',
      )
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Enregistrement impossible')
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await setRecoveryPhrase(null)
      toast('Phrase de récupération supprimée', 'info')
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Suppression impossible')
      setBusy(false)
    }
  }

  const footer =
    step === 'phrase' ? (
      <>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setStep('intro')}
          disabled={busy}
        >
          Retour
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void save()}
          disabled={!acknowledged || busy}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
          {hasRecovery ? 'Remplacer la phrase' : 'Activer la récupération'}
        </button>
      </>
    ) : step === 'remove' ? (
      <>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setStep('intro')}
          disabled={busy}
        >
          Annuler
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={() => void remove()}
          disabled={busy}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <ShieldOff size={16} />}
          Supprimer la phrase
        </button>
      </>
    ) : (
      <button type="button" className="button button--ghost" onClick={onClose}>
        Fermer
      </button>
    )

  return (
    <Modal
      title="Phrase de récupération"
      description="Une seconde clé, optionnelle, pour retrouver l’accès sans le mot de passe maître."
      size="md"
      onClose={onClose}
      footer={footer}
    >
      {step === 'intro' && (
        <div className="recovery">
          {hasRecovery ? (
            <>
              <p className="settings-copy">
                Une phrase de récupération est configurée depuis le{' '}
                <strong>{formatDateTime(file?.recovery?.createdAt ?? '')}</strong>. Elle permet
                de rouvrir le coffre et d’imposer un nouveau mot de passe maître.
              </p>
              <p className="settings-copy">
                La phrase elle-même n’est stockée nulle part. Si vous l’avez perdue, remplacez-la
                par une nouvelle phrase : l’ancienne deviendra inutilisable.
              </p>
              <div className="settings-actions settings-actions--start">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={startGeneration}
                >
                  <RefreshCw size={16} />
                  Remplacer la phrase
                </button>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => setStep('remove')}
                >
                  <ShieldOff size={16} />
                  Supprimer
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="settings-copy">
                Sans phrase de récupération, perdre le mot de passe maître revient à perdre les
                données. Une phrase générée ici permet de rouvrir le coffre et de choisir un
                nouveau mot de passe.
              </p>
              <p className="settings-copy">
                Elle est composée de dix mots EFF, soit environ 129 bits d’entropie. Notez-la
                sur papier et conservez-la séparément de vos exports <code>.coffre</code>.
              </p>
              <div className="settings-actions settings-actions--start">
                <button type="button" className="button button--primary" onClick={startGeneration}>
                  <KeyRound size={16} />
                  Générer une phrase
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'phrase' && (
        <div className="recovery">
          <p className="settings-copy">
            Notez ces dix mots dans l’ordre. Ils ne seront plus affichés ensuite.
          </p>
          <div className="recovery-phrase" aria-label="Phrase de récupération">
            {phrase.split(' ').map((word, index) => (
              <span key={`${word}-${index}`} className="recovery-phrase__word">
                <small>{index + 1}</small>
                {word}
              </span>
            ))}
          </div>
          <div className="settings-actions settings-actions--start">
            <button type="button" className="button button--secondary" onClick={() => void copy()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copiée' : 'Copier la phrase'}
            </button>
          </div>
          <label className="checkbox checkbox--warning">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              <strong>J’ai noté la phrase.</strong> Je comprends qu’elle ne peut pas être
              retrouvée et qu’elle donne accès à tout le coffre.
            </span>
          </label>
          {hasRecovery && (
            <p className="field__hint">
              L’ancienne phrase sera remplacée immédiatement.
            </p>
          )}
        </div>
      )}

      {step === 'remove' && (
        <div className="recovery">
          <p className="settings-copy">
            La phrase actuelle cessera immédiatement de fonctionner. Le mot de passe maître
            restera le seul moyen d’ouvrir le coffre.
          </p>
          <p className="form-error" role="alert">
            <AlertTriangle size={16} />
            Cette action ne supprime aucune donnée du coffre.
          </p>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </p>
      )}
    </Modal>
  )
}
