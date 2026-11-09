import { useState } from 'react'
import { AlertTriangle, Check, LoaderCircle, Plane, ShieldCheck } from 'lucide-react'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { getSyncConfig } from '../lib/syncConfig'
import { SyncEpochRequiredError } from '../lib/syncService'
import { getTravelMode } from '../lib/travelMode'
import { isTauriRuntime } from '../lib/external'

/**
 * Mode voyage (F6) : retire du fichier local les coffres qui ne sont pas
 * marqués sûrs. La désactivation restaure depuis la synchronisation par
 * dossier ; aucune suppression n’est propagée aux autres appareils.
 */
export function TravelModeSettings() {
  const { file, vaults, enableTravelMode, disableTravelMode } = useVault()
  const { tt } = useI18n()
  const { toast } = useToast()
  // Le mode voyage est stocké localement : il est relu à chaque rendu.
  const travel = file ? getTravelMode(file.id) : null
  const [safeVaultIds, setSafeVaultIds] = useState<string[]>(() =>
    file ? (getTravelMode(file.id)?.safeVaultIds ?? vaults.map((vault) => vault.id)) : [],
  )
  const [password, setPassword] = useState('')
  const [remotePassword, setRemotePassword] = useState('')
  const [needsRemotePassword, setNeedsRemotePassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!file || !isTauriRuntime()) return null

  const syncConfig = getSyncConfig(file.id)
  const enabled = travel?.enabled === true
  const safeVaults = vaults.filter((vault) => travel?.safeVaultIds.includes(vault.id))

  const toggleVault = (id: string) => {
    setSafeVaultIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    )
  }

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      await enableTravelMode(safeVaultIds, password)
      setPassword('')
      toast(tt('Mode voyage activé.'), 'success')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : tt('Activation impossible.'),
      )
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await disableTravelMode(password, remotePassword || undefined)
      setPassword('')
      setRemotePassword('')
      setNeedsRemotePassword(false)
      toast(
        result.conflicts > 0
          ? tt('Mode voyage désactivé avec des conflits archivés.')
          : tt('Mode voyage désactivé, coffres restaurés.'),
        'success',
      )
      if (result.warnings.length > 0) {
        toast(result.warnings.slice(0, 3).join(' '), 'info')
      }
    } catch (caught) {
      if (caught instanceof SyncEpochRequiredError) {
        setNeedsRemotePassword(true)
        setError(caught.message)
      } else {
        setError(
          caught instanceof Error ? caught.message : tt('Désactivation impossible.'),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section__head">
        <span className="settings-section__icon">
          <Plane size={18} />
        </span>
        <div>
          <h3>{tt('Mode voyage')}</h3>
          <p>
            {tt(
              'Retire de cet appareil les coffres qui ne sont pas sûrs pour le voyage. Ils seront restaurés depuis la synchronisation à la désactivation.',
            )}
          </p>
        </div>
      </div>

      {!enabled ? (
        <>
          <p className="settings-copy">
            {tt(
              'Cochez les coffres à conserver pendant le voyage. Les autres seront retirés du fichier local, pas seulement masqués.',
            )}
          </p>
          <ul className="travel-vaults">
            {vaults.map((vault) => (
              <li key={vault.id}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={safeVaultIds.includes(vault.id)}
                    onChange={() => toggleVault(vault.id)}
                  />
                  <span>
                    <strong>{vault.name}</strong>{' '}
                    <small>
                      {vault.itemCount} {tt('élément(s)')}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="form-grid">
            <label className="field field--full">
              <span className="field__label">{tt('Mot de passe maître')}</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
          </div>
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void enable()}
              disabled={busy || !password || safeVaultIds.length === 0}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <Plane size={16} />}
              {tt('Activer le mode voyage')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="settings-copy">
            <ShieldCheck size={15} />{' '}
            {tt('Coffres conservés sur cet appareil :')}{' '}
            {safeVaults.map((vault) => vault.name).join(', ') || '—'}
          </p>
          <p className="field__hint">
            {tt(
              'Les autres coffres ne sont plus dans le fichier local. Cette protection vise l’inspection de l’appareil, pas une contrainte exercée sur la personne.',
            )}
          </p>
          {!syncConfig && (
            <p className="form-error" role="alert">
              <AlertTriangle size={16} />
              {tt(
                'Configurez une synchronisation par dossier avant de désactiver le mode voyage.',
              )}
            </p>
          )}
          <div className="form-grid">
            <label className="field field--full">
              <span className="field__label">{tt('Mot de passe maître actuel')}</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            {needsRemotePassword && (
              <label className="field field--full">
                <span className="field__label">
                  {tt('Mot de passe maître de l’autre appareil')}
                </span>
                <input
                  className="input"
                  type="password"
                  value={remotePassword}
                  onChange={(event) => setRemotePassword(event.target.value)}
                  autoComplete="off"
                />
              </label>
            )}
          </div>
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void disable()}
              disabled={busy || !password || !syncConfig}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
              {tt('Désactiver et restaurer les coffres')}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="form-error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </p>
      )}
    </section>
  )
}
