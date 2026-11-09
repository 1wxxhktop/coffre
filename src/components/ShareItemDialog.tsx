import { useMemo, useState } from 'react'
import { qrDataUrl } from '../lib/qr'
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  LoaderCircle,
  Share2,
  ShieldCheck,
} from 'lucide-react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { useVault } from '../state/VaultProvider'
import { copySensitive } from '../lib/clipboard'
import { downloadFile, formatDateTime } from '../lib/settings'
import { groupShareWords } from '../lib/shamir'
import {
  createOfflineShare,
  type CreatedOfflineShare,
} from '../lib/offlineShare'
import type { VaultItem } from '../lib/types'

interface ShareItemDialogProps {
  item: VaultItem
  onClose: () => void
}

const EXPIRY_CHOICES = [
  { days: 1, label: '1 jour' },
  { days: 7, label: '7 jours' },
  { days: 30, label: '30 jours' },
  { days: 0, label: 'Sans expiration' },
]

/**
 * Partage ponctuel hors ligne : l’élément est chiffré avec une clé aléatoire,
 * le fichier `.coffre-share` et la clé sont remis séparément. Aucun réseau.
 */
export function ShareItemDialog({ item, onClose }: ShareItemDialogProps) {
  const { recordActivity } = useVault()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [days, setDays] = useState(7)
  const [share, setShare] = useState<CreatedOfflineShare | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Le QR code est dérivé de la clé : aucun état intermédiaire à maintenir.
  const qrCode = useMemo(() => {
    if (!share) return null
    try {
      return qrDataUrl(share.keyPayload)
    } catch {
      return null
    }
  }, [share])

  const generate = async () => {
    setBusy(true)
    setError(null)
    setCopied(false)
    setShare(null)
    try {
      const expiresAt =
        days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : undefined
      setShare(await createOfflineShare(item, expiresAt))
      void recordActivity('share', item.title)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Génération impossible')
    } finally {
      setBusy(false)
    }
  }

  const copyKey = async () => {
    if (!share) return
    const success = await copySensitive(share.keyWords, 60, () => setCopied(false))
    if (success) {
      setCopied(true)
      toast(tt('Clé de partage copiée'), 'success')
    } else {
      toast(
        tt('La copie automatique a échoué ; notez les mots à la main.'),
        'error',
      )
    }
  }

  const footer = (
    <>
      <button type="button" className="button button--ghost" onClick={onClose}>
        Fermer
      </button>
      <div className="modal__footer-actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void generate()}
          disabled={busy}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <Share2 size={16} />}
          {share ? 'Régénérer le partage' : 'Générer le partage'}
        </button>
      </div>
    </>
  )

  return (
    <Modal
      title={tt('Partager hors ligne')}
      description={tt(
        'Un fichier chiffré et une clé séparée, à transmettre par deux canaux différents.',
      )}
      size="md"
      onClose={onClose}
      footer={footer}
    >
      <div className="offline-share">
        <p className="settings-copy">
          <ShieldCheck size={15} /> Le fichier <code>.coffre-share</code> contient
          l’élément chiffré. La clé affichée après génération est indispensable pour
          l’ouvrir : ne l’envoyez pas dans le même message que le fichier. Aucun serveur
          n’est contacté.
        </p>

        <label className="field field--full">
          <span className="field__label">{tt('Expiration du partage')}</span>
          <select
            className="input"
            value={days}
            onChange={(event) => {
              setDays(Number(event.target.value))
              setShare(null)
            }}
            disabled={busy}
          >
            {EXPIRY_CHOICES.map((choice) => (
              <option key={choice.days} value={choice.days}>
                {choice.label}
              </option>
            ))}
          </select>
          <span className="field__hint">
            L’application Coffre refuse un partage expiré. Un tiers peut modifier cette
            date dans le fichier : elle ne peut pas être imposée hors ligne.
          </span>
        </label>

        {error && (
          <p className="form-error" role="alert">
            <AlertTriangle size={16} />
            {error}
          </p>
        )}

        {share && (
          <div className="offline-share__result">
            <div className="offline-share__file">
              <FileSummary share={share} />
            </div>

            <div className="offline-share__key">
              <span className="field__label">
                {tt('Clé de partage (à dicter ou scanner)')}
              </span>
              <div className="offline-share__word-groups">
                {groupShareWords(share.keyWords).map((group, index) => (
                  <code key={index}>{group}</code>
                ))}
              </div>
              <div className="settings-actions settings-actions--start">
                <button
                  type="button"
                  className="button button--secondary button--sm"
                  onClick={() => void copyKey()}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copiée' : 'Copier la clé'}
                </button>
                <button
                  type="button"
                  className="button button--secondary button--sm"
                  onClick={() =>
                    downloadFile(share.content, share.filename, 'application/json')
                  }
                >
                  <Download size={14} />
                  Télécharger le fichier
                </button>
              </div>
            </div>

            {qrCode && (
              <div className="offline-share__qr">
                <img src={qrCode} alt="QR code de la clé de partage" />
                <span>
                  {tt('Second QR code : la clé, à transmettre séparément.')}
                </span>
              </div>
            )}

            <p className="offline-share__warning">
              <AlertTriangle size={15} /> Toute personne qui possède le fichier et la clé
              peut lire l’élément. Le destinataire l’importe depuis Réglages → Importer un
              partage.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

function FileSummary({ share }: { share: CreatedOfflineShare }) {
  const { tt } = useI18n()
  return (
    <>
      <span className="field__label">{tt('Fichier à transmettre')}</span>
      <code>{share.filename}</code>
      <span className="field__hint">
        {share.file.expiresAt
          ? `Expire le ${formatDateTime(share.file.expiresAt)}.`
          : 'Sans expiration.'}{' '}
        Les pièces jointes ne sont pas incluses.
      </span>
    </>
  )
}
