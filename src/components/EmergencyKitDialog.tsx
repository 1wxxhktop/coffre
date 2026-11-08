import { useEffect, useState } from 'react'
import { qrDataUrl } from '../lib/qr'
import {
  AlertTriangle,
  Check,
  Copy,
  FileKey2,
  LoaderCircle,
  Printer,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { Modal } from './Modal'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { copySensitive } from '../lib/clipboard'
import { formatDateTime } from '../lib/settings'
import { groupShareWords, type RecoveryShare } from '../lib/shamir'

interface EmergencyKitDialogProps {
  onClose: () => void
}

/**
 * Kit d’urgence imprimable : instructions, identifiant du coffre, emplacement
 * des sauvegardes et parts Shamir de la clé de récupération (mots + QR).
 *
 * Tout est généré localement. Les parts ne sont conservées qu’en mémoire tant
 * que la boîte de dialogue est ouverte.
 */
export function EmergencyKitDialog({ onClose }: EmergencyKitDialogProps) {
  const { file, createRecoveryShares } = useVault()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [threshold, setThreshold] = useState(3)
  const [total, setTotal] = useState(5)
  const [shares, setShares] = useState<RecoveryShare[]>([])
  const [qrCodes, setQrCodes] = useState<Record<number, string>>({})
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  const hasRecovery = Boolean(file?.recovery)
  const ready = shares.length > 0
  const printReady = ready && shares.every((share) => Boolean(qrCodes[share.index]))

  useEffect(() => {
    if (shares.length === 0) {
      setQrCodes({})
      return
    }
    const next: Record<number, string> = {}
    for (const share of shares) {
      try {
        next[share.index] = qrDataUrl(share.payload)
      } catch {
        // La part reste imprimable sous forme de mots.
      }
    }
    setQrCodes(next)
  }, [shares])

  const reset = () => {
    setShares([])
    setQrCodes({})
    setGeneratedAt(null)
    setError(null)
    setCopied(null)
  }

  const changeThreshold = (value: number) => {
    setThreshold(value)
    if (value > total) setTotal(value)
    reset()
  }

  const changeTotal = (value: number) => {
    setTotal(Math.max(value, threshold))
    reset()
  }

  const generate = async () => {
    setBusy(true)
    setError(null)
    setCopied(null)
    try {
      const next = await createRecoveryShares(threshold, total)
      setQrCodes({})
      setShares(next)
      setGeneratedAt(new Date())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Génération impossible')
    } finally {
      setBusy(false)
    }
  }

  const copyShare = async (share: RecoveryShare) => {
    const success = await copySensitive(share.words, 60, () => setCopied(null))
    if (success) {
      setCopied(share.index)
      toast(`Part ${share.index} copiée`, 'success')
    } else {
      toast(
        tt('La copie automatique a échoué ; recopiez les mots à la main.'),
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
        {ready && (
          <button type="button" className="button button--secondary" onClick={reset}>
            <RefreshCw size={16} />
            Recommencer
          </button>
        )}
        <button
          type="button"
          className="button button--primary"
          onClick={() => window.print()}
          disabled={!printReady}
        >
          <Printer size={16} />
          Imprimer / Enregistrer en PDF
        </button>
      </div>
    </>
  )

  return (
    <Modal
      title={tt('Kit d’urgence')}
      description={tt(
        'Un document papier pour reconstituer la clé de récupération avec plusieurs personnes de confiance.',
      )}
      size="xl"
      className="emergency-kit-modal"
      onClose={onClose}
      footer={footer}
    >
      {!hasRecovery ? (
        <div className="recovery">
          <p className="settings-copy">
            <AlertTriangle size={16} /> Aucune phrase de récupération n’est configurée.
            Configurez-en une depuis les réglages avant de créer un kit d’urgence.
          </p>
        </div>
      ) : (
        <div className="emergency-kit">
          <div className="emergency-kit__intro no-print">
            <p className="settings-copy">
              <ShieldCheck size={16} /> Le kit contient des parts de la clé de
              récupération. Chaque part, seule, ne révèle rien ; {threshold} parts sont
              nécessaires pour rouvrir le coffre. Confiez-les à des personnes différentes
              et conservez le document dans un lieu sûr.
            </p>
            <div className="form-grid">
              <label className="field">
                <span className="field__label">{tt('Parts nécessaires (k)')}</span>
                <select
                  className="input"
                  value={threshold}
                  onChange={(event) => changeThreshold(Number(event.target.value))}
                  disabled={busy || ready}
                >
                  {[2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">{tt('Nombre total de parts (n)')}</span>
                <select
                  className="input"
                  value={total}
                  onChange={(event) => changeTotal(Number(event.target.value))}
                  disabled={busy || ready}
                >
                  {Array.from({ length: 9 }, (_, index) => index + 2)
                    .filter((value) => value >= threshold)
                    .map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="settings-actions settings-actions--start">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void generate()}
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <FileKey2 size={16} />
                )}
                {ready ? 'Régénérer les parts' : 'Générer les parts'}
              </button>
            </div>
            {error && (
              <p className="form-error" role="alert">
                <AlertTriangle size={16} />
                {error}
              </p>
            )}
          </div>

          {ready && (
            <div className="emergency-kit__sheet">
              <header className="emergency-kit__header">
                <div>
                  <span className="eyebrow">{tt('Coffre local')}</span>
                  <h2>{tt('Kit d’urgence')}</h2>
                  <p>
                    À conserver hors ligne. Ce document permet de rouvrir le coffre avec{' '}
                    {threshold} parts sur {total}, sans le mot de passe maître d’origine.
                  </p>
                </div>
                <div className="emergency-kit__meta">
                  <span>{tt('Identifiant du coffre')}</span>
                  <code>{file?.id}</code>
                  <span>{tt('Généré le')}</span>
                  <strong>{generatedAt ? formatDateTime(generatedAt.toISOString()) : '—'}</strong>
                </div>
              </header>

              <section className="emergency-kit__instructions">
                <h3>{tt('Mode d’emploi')}</h3>
                <ol>
                  <li>
                    Confiez chaque part à une personne différente. Une part seule ne permet
                    pas de retrouver la clé.
                  </li>
                  <li>
                    Pour restaurer l’accès, réunissez au moins {threshold} parts et saisissez
                    leurs mots dans Coffre, écran « Déverrouiller avec une phrase de
                    récupération ».
                  </li>
                  <li>
                    Un nouveau mot de passe maître sera demandé. L’ancien cessera de
                    fonctionner ; les éléments, versions et pièces jointes sont conservés.
                  </li>
                  <li>
                    Conservez aussi une sauvegarde récente du fichier <code>.coffre</code> :
                    les parts ne remplacent pas la sauvegarde.
                  </li>
                </ol>
              </section>

              <section className="emergency-kit__fields">
                <div>
                  <span>{tt('Mot de passe maître actuel (à écrire à la main)')}</span>
                  <div className="emergency-kit__line" />
                  <small className="emergency-kit__warning">
                    Facultatif. Ne l’écrivez ici que si ce document est conservé aussi
                    soigneusement que le mot de passe lui-même ; les parts suffisent pour
                    récupérer l’accès.
                  </small>
                </div>
                <div>
                  <span>{tt('Emplacement des sauvegardes')}</span>
                  <div className="emergency-kit__line" />
                </div>
                <div>
                  <span>{tt('Personnes dépositaires des parts')}</span>
                  <div className="emergency-kit__line" />
                </div>
              </section>

              <div className="emergency-kit__shares">
                {shares.map((share) => (
                  <article className="emergency-kit__share" key={share.index}>
                    <header>
                      <h3>
                        Part {share.index} / {share.total}
                      </h3>
                      <span>
                        Seuil : {share.threshold} parts — conserver séparément
                      </span>
                    </header>
                    <div className="emergency-kit__share-body">
                      <div className="emergency-kit__qr">
                        {qrCodes[share.index] ? (
                          <img
                            src={qrCodes[share.index]}
                            alt={`QR code de la part ${share.index}`}
                          />
                        ) : (
                          <span className="no-print">{tt('QR en cours…')}</span>
                        )}
                      </div>
                      <div className="emergency-kit__words">
                        <span className="no-print">{tt('Mots à recopier ou à scanner :')}</span>
                        <div className="emergency-kit__word-groups">
                          {groupShareWords(share.words).map((group, index) => (
                            <code key={index}>{group}</code>
                          ))}
                        </div>
                        <div className="emergency-kit__share-actions no-print">
                          <button
                            type="button"
                            className="button button--secondary button--sm"
                            onClick={() => void copyShare(share)}
                          >
                            {copied === share.index ? <Check size={14} /> : <Copy size={14} />}
                            {copied === share.index ? 'Copiée' : 'Copier les mots'}
                          </button>
                        </div>
                      </div>
                    </div>
                    <footer>
                      <span>{tt('À remettre à :')}</span>
                      <div className="emergency-kit__line" />
                    </footer>
                  </article>
                ))}
              </div>

              <footer className="emergency-kit__footer">
                <ShieldCheck size={14} />
                Généré localement par Coffre. Aucune part, aucune clé et aucune donnée n’a
                été envoyée sur le réseau.
              </footer>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
