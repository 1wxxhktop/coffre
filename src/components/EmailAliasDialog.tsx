import { useMemo, useState } from 'react'
import { AtSign, Check, LoaderCircle, RefreshCw } from 'lucide-react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'
import { useVault } from '../state/VaultProvider'
import {
  aliasTagFromSite,
  generateEmailAlias,
  getAliasDefaults,
  setAliasDefaults,
  type EmailAliasMode,
} from '../lib/emailAlias'
import { createRemoteAlias, type AliasService } from '../lib/aliasServices'
import type { LoginItem } from '../lib/types'

interface EmailAliasDialogProps {
  item: LoginItem
  onApply: (alias: string) => void
  onClose: () => void
}

export function EmailAliasDialog({ item, onApply, onClose }: EmailAliasDialogProps) {
  const { tt } = useI18n()
  const { aliasKeys, setAliasKey } = useVault()
  const defaults = getAliasDefaults()
  const [baseEmail, setBaseEmail] = useState(defaults.baseEmail)
  const [mode, setMode] = useState<EmailAliasMode>(defaults.mode)
  const [tag, setTag] = useState(aliasTagFromSite(item.urls[0] || item.title))
  const [error, setError] = useState<string | null>(null)
  const [service, setService] = useState<AliasService>('simplelogin')
  const [apiKey, setApiKey] = useState('')
  const [serviceAlias, setServiceAlias] = useState('')
  const [serviceBusy, setServiceBusy] = useState(false)
  const [rememberKey, setRememberKey] = useState(false)

  const preview = useMemo(() => {
    if (!baseEmail.trim()) return ''
    try {
      return generateEmailAlias({ baseEmail, site: item.urls[0] || item.title, mode, tag }).alias
    } catch {
      return ''
    }
  }, [baseEmail, item.title, item.urls, mode, tag])

  const generateRemote = async () => {
    setServiceBusy(true)
    setError(null)
    try {
      const effectiveKey = aliasKeys[service] || apiKey
      const alias = await createRemoteAlias({
        service,
        apiKey: effectiveKey,
        description: `${item.title} ${tag}`.trim(),
        domain: mode === 'catch-all' ? baseEmail.split('@')[1] : undefined,
      })
      if (rememberKey && apiKey.trim()) await setAliasKey(service, apiKey)
      setServiceAlias(alias)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tt('Service d’alias indisponible'))
    } finally {
      setServiceBusy(false)
    }
  }

  const apply = () => {
    const chosen = serviceAlias || preview
    if (!chosen) {
      setError(tt('Adresse e-mail de base invalide'))
      return
    }
    setAliasDefaults({ baseEmail, mode })
    onApply(chosen)
    onClose()
  }

  return (
    <Modal
      title={tt('Alias e-mail')}
      description={tt(
        'Génère une adresse « plus » ou catch-all sans contacter de service.',
      )}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            {tt('Annuler')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={apply}
            disabled={!preview && !serviceAlias}
          >
            <Check size={16} />
            {tt('Utiliser cet alias')}
          </button>
        </>
      }
    >
      <div className="form">
        <label className="field field--full">
          <span className="field__label">{tt('Adresse e-mail de base')}</span>
          <input
            className="input"
            type="email"
            value={baseEmail}
            onChange={(event) => setBaseEmail(event.target.value)}
            placeholder={tt('prenom@domaine.fr')}
            autoFocus
          />
        </label>

        <label className="field field--full">
          <span className="field__label">{tt('Mode')}</span>
          <select
            className="input"
            value={mode}
            onChange={(event) => setMode(event.target.value as EmailAliasMode)}
          >
            <option value="plus">{tt('Adresse « plus » (prenom+site@domaine)')}</option>
            <option value="catch-all">{tt('Catch-all sur mon domaine (site@domaine)')}</option>
          </select>
        </label>

        <label className="field field--full">
          <span className="field__label">{tt('Étiquette du site')}</span>
          <div className="alias-tag">
            <input
              className="input"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              maxLength={40}
            />
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setTag(aliasTagFromSite(item.urls[0] || item.title))}
              aria-label={tt('Régénérer l’étiquette')}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </label>

        {(serviceAlias || preview) && (
          <p className="alias-preview">
            <AtSign size={15} />
            <code>{serviceAlias || preview}</code>
          </p>
        )}

        <div className="form-grid">
          <label className="field">
            <span className="field__label">{tt('Service d’alias (optionnel)')}</span>
            <select
              className="input"
              value={service}
              onChange={(event) => setService(event.target.value as AliasService)}
            >
              <option value="simplelogin">{tt('SimpleLogin')}</option>
              <option value="addy">{tt('addy.io')}</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">{tt('Clé API')}</span>
            <input
              className="input"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
            />
          </label>
        </div>
        <div className="settings-actions settings-actions--start">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void generateRemote()}
            disabled={serviceBusy || (!apiKey.trim() && !aliasKeys[service])}
          >
            {serviceBusy ? <LoaderCircle size={14} className="spin" /> : <AtSign size={14} />}
            {tt('Générer via le service')}
          </button>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rememberKey}
            onChange={(event) => setRememberKey(event.target.checked)}
          />
          <span>{tt('Enregistrer la clé chiffrée dans le coffre')}</span>
        </label>
        <p className="field__hint">
          {aliasKeys[service]
            ? tt('Une clé est déjà enregistrée pour ce service.')
            : tt('La clé n’est pas enregistrée sauf si vous cochez la case.')}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
