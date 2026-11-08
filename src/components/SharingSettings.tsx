import { useEffect, useState } from 'react'
import { Copy, Fingerprint, LoaderCircle, Users } from 'lucide-react'
import { copyToClipboard } from '../lib/clipboard'
import { publicSharingIdentity, type SharingIdentity } from '../lib/sharing'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { useVault } from '../state/VaultProvider'

export function SharingSettings() {
  const { getSharingIdentity, createSharingIdentity } = useVault()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [identity, setIdentity] = useState<SharingIdentity | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getSharingIdentity()
      .then((next) => {
        if (!cancelled) setIdentity(next)
      })
      .catch(() => {
        if (!cancelled) setIdentity(null)
      })
    return () => {
      cancelled = true
    }
  }, [getSharingIdentity])

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      setIdentity(await createSharingIdentity())
      toast(tt('Identité de partage créée'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : tt('Création de l’identité impossible'),
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  const publicIdentity = identity ? publicSharingIdentity(identity) : null
  const copy = async () => {
    if (!publicIdentity) return
    if (await copyToClipboard(JSON.stringify(publicIdentity, null, 2))) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section__head">
        <span className="settings-section__icon">
          <Users size={18} />
        </span>
        <div>
          <h3>{tt('Identité de partage')}</h3>
          <p>{tt('Prépare le partage de coffres avec un contact de confiance.')}</p>
        </div>
      </div>

      {identity ? (
        <>
          <p className="settings-copy">
            <Fingerprint size={15} /> <span className="mono">{identity.fingerprint}</span>
          </p>
          <p className="settings-copy">
            {tt(
              'Transmettez cette identité publique hors bande. Elle ne contient aucune clé privée.',
            )}
          </p>
          <textarea
            className="input input--mono"
            rows={6}
            readOnly
            value={publicIdentity ? JSON.stringify(publicIdentity, null, 2) : ''}
            aria-label={tt('Identité publique')}
          />
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void copy()}
            >
              <Copy size={16} />
              {copied ? tt('Identité copiée') : tt('Copier l’identité publique')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="settings-copy">{tt('Aucune identité de partage pour ce coffre.')}</p>
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void create()}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Users size={16} />
              )}
              {tt('Créer mon identité')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
