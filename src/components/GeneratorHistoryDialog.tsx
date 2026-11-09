import { useState } from 'react'
import {
  Copy,
  Eye,
  EyeOff,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'
import { useVault } from '../state/VaultProvider'
import { copySensitive } from '../lib/clipboard'
import { formatDateTime } from '../lib/settings'
import { emptyDraft, type GeneratorHistoryEntry } from '../lib/types'

interface GeneratorHistoryDialogProps {
  /** Ferme l’historique et revient au générateur. */
  onClose: () => void
  /** Ferme aussi le générateur après la création d’une connexion. */
  onCreated?: () => void
}

/**
 * Écran séparé et chargé à la demande : il utilise le provider du coffre sans
 * alourdir le générateur ni le chunk principal.
 */
export function GeneratorHistoryDialog({
  onClose,
  onCreated,
}: GeneratorHistoryDialogProps) {
  const { settings, updateSettings } = useSettings()
  const { tt, intl } = useI18n()
  const { toast } = useToast()
  const {
    generatorHistory,
    markGeneratorHistoryUsed,
    deleteGeneratorHistoryEntry,
    clearGeneratorHistory,
    purgeGeneratorHistory,
    addItem,
    vaults,
  } = useVault()
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  const visible = generatorHistory.filter((entry) => entry.state === 'available')

  const toggleReveal = (id: string) => {
    setRevealed((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copy = async (entry: GeneratorHistoryEntry) => {
    const success = await copySensitive(
      entry.password,
      settings.clipboardClearSeconds,
      () => toast(tt('Presse-papiers effacé'), 'info'),
    )
    toast(
      success ? tt('Valeur copiée') : tt('Impossible de copier'),
      success ? 'success' : 'error',
    )
  }

  const updateRetention = (days: number) => {
    updateSettings({ generatorHistoryRetentionDays: days })
    void purgeGeneratorHistory(days)
      .then(() =>
        toast(
          days === 0
            ? tt('Historique du générateur effacé')
            : tt('Historique du générateur purgé'),
          'success',
        ),
      )
      .catch(() => undefined)
  }

  const createLogin = async (entry: GeneratorHistoryEntry) => {
    const vaultId = vaults[0]?.id
    if (!vaultId) {
      toast(tt('Aucun coffre disponible'), 'error')
      return
    }
    try {
      const item = await addItem({
        ...emptyDraft('login', vaultId),
        type: 'login',
        title: entry.domain || tt('Connexion générée'),
        username: '',
        password: entry.password,
        urls: entry.domain ? [`https://${entry.domain}`] : [''],
        totp: '',
      })
      await markGeneratorHistoryUsed(entry.id, item.id)
      toast(tt('Connexion créée depuis l’historique'), 'success')
      if (onCreated) onCreated()
      else onClose()
    } catch {
      toast(tt('Création impossible'), 'error')
    }
  }

  const clear = async () => {
    await clearGeneratorHistory()
    toast(tt('Historique du générateur effacé'), 'success')
  }

  return (
    <Modal
      title={tt('Historique du générateur')}
      description={tt('Secrets générés localement, jamais en clair.')}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void clear()}
            disabled={visible.length === 0}
          >
            <Trash2 size={16} />
            {tt('Tout effacer')}
          </button>
          <div className="modal__footer-actions">
            <button type="button" className="button button--secondary" onClick={onClose}>
              {tt('Fermer')}
            </button>
          </div>
        </>
      }
    >
      <div className="generator-history">
        <p className="settings-copy">
          {tt(
            'Les 50 derniers mots de passe générés restent chiffrés dans le coffre.',
          )}
        </p>
        <label className="field">
          <span className="field__label">{tt('Conservation')}</span>
          <select
            className="input"
            value={settings.generatorHistoryRetentionDays}
            onChange={(event) => updateRetention(Number(event.target.value))}
          >
            <option value={0}>{tt('Désactivé')}</option>
            <option value={1}>{tt('1 jour')}</option>
            <option value={7}>{tt('7 jours')}</option>
            <option value={30}>{tt('30 jours')}</option>
          </select>
        </label>

        {visible.length === 0 ? (
          <p className="field__hint">{tt('Aucun mot de passe généré récemment.')}</p>
        ) : (
          <ul className="generator-history__list">
            {visible.map((entry) => {
              const isRevealed = revealed.has(entry.id)
              return (
                <li key={entry.id} className="generator-history__item">
                  <div className="generator-history__meta">
                    <strong>{entry.domain || tt('Sans domaine')}</strong>
                    <span>{formatDateTime(entry.createdAt, intl)}</span>
                  </div>
                  <code className="generator-history__value">
                    {isRevealed ? entry.password : '••••••••'}
                  </code>
                  <div className="generator-history__actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => toggleReveal(entry.id)}
                      aria-label={tt(isRevealed ? 'Masquer' : 'Afficher')}
                    >
                      {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => void copy(entry)}
                      aria-label={tt('Copier')}
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => void createLogin(entry)}
                      aria-label={tt('Créer une connexion')}
                    >
                      <UserPlus size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => void deleteGeneratorHistoryEntry(entry.id)}
                      aria-label={tt('Supprimer')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
