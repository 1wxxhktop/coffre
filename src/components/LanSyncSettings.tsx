import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  AlertTriangle,
  Check,
  Copy,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Wifi,
} from 'lucide-react'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import {
  formatFingerprint,
  lanForgetPeer,
  lanIdentity,
  lanPairJoin,
  lanPairStart,
  lanDiscover,
  lanPeers,
  lanSyncAvailable,
  lanUpdatePeerHost,
  type LanDiscovery,
  lanSyncPull,
  lanSyncServe,
  type LanIdentityInfo,
  type LanPairCode,
  type LanPeer,
} from '../lib/lanSync'
import { qrDataUrl } from '../lib/qr'
import { copySensitive } from '../lib/clipboard'
import { serializeVault } from '../lib/vault'
import { SyncEpochRequiredError } from '../lib/syncService'

/**
 * Synchronisation directe sur le réseau local (F2). Le port n’est ouvert que
 * pendant une réception demandée ; l’appairage et le transport utilisent Noise.
 */
export function LanSyncSettings() {
  const { file, items, lanSync, recordActivity } = useVault()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [identity, setIdentity] = useState<LanIdentityInfo | null>(null)
  const [peers, setPeers] = useState<LanPeer[]>([])
  const [pairing, setPairing] = useState<LanPairCode | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [discovered, setDiscovered] = useState<LanDiscovery[]>([])
  const [deviceName, setDeviceName] = useState('Coffre')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [pendingRemote, setPendingRemote] = useState<string | null>(null)

  useEffect(() => {
    if (!lanSyncAvailable()) return
    let cancelled = false
    void Promise.all([lanIdentity(), lanPeers()])
      .then(([nextIdentity, nextPeers]) => {
        if (cancelled) return
        setIdentity(nextIdentity)
        setPeers(nextPeers)
        setDeviceName((current) =>
          current === 'Coffre'
            ? `Coffre ${nextIdentity.fingerprint.slice(0, 4)}`
            : current,
        )
      })
      .catch((caught) => {
        if (cancelled) return
        setError(
          caught instanceof Error ? caught.message : tt('Réseau local indisponible.'),
        )
      })
    return () => {
      cancelled = true
    }
  }, [tt])

  useEffect(() => {
    if (!lanSyncAvailable()) return
    const paired = listen<LanPeer>('coffre:lan-paired', (event) => {
      setPeers((current) => [
        ...current.filter((peer) => peer.id !== event.payload.id),
        event.payload,
      ])
      setPairing(null)
      void recordActivity('pairing', event.payload.name || event.payload.host, event.payload.host)
      toast(tt('Appareil appairé.'), 'success')
    })
    const failed = listen<string>('coffre:lan-pair-failed', (event) => {
      setPairing(null)
      setError(event.payload || tt('Appairage impossible.'))
    })
    return () => {
      void paired.then((unlisten) => unlisten())
      void failed.then((unlisten) => unlisten())
    }
  }, [recordActivity, tt, toast])

  if (!lanSyncAvailable()) return null

  const referencedBlobIds = () =>
    items.flatMap((item) =>
      item.attachments
        .filter((attachment) => attachment.storage === 'blob' && attachment.blobId)
        .map((attachment) => attachment.blobId as string),
    )

  const startPairing = async () => {
    setBusy('pair')
    setError(null)
    try {
      const code = await lanPairStart(deviceName.trim() || 'Coffre')
      setPairing(code)
      toast(tt('Code d’appairage prêt. Il expire dans deux minutes.'), 'info')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tt('Appairage impossible.'))
    } finally {
      setBusy(null)
    }
  }

  const discover = async () => {
    setBusy('discover')
    setError(null)
    try {
      setDiscovered(await lanDiscover())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tt('Découverte impossible.'))
    } finally {
      setBusy(null)
    }
  }

  const applyDiscovered = async (entry: LanDiscovery) => {
    const peer = peers.find((candidate) => candidate.id === entry.id)
    if (!peer) return
    try {
      const updated = await lanUpdatePeerHost(peer.id, entry.host)
      setPeers((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      )
      toast(tt('Adresse du pair mise à jour.'), 'success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tt('Mise à jour impossible.'))
    }
  }

  const joinPairing = async () => {
    if (!joinCode.trim()) return
    setBusy('join')
    setError(null)
    try {
      const peer = await lanPairJoin(joinCode.trim(), deviceName.trim() || 'Coffre')
      setPeers((current) => [...current.filter((entry) => entry.id !== peer.id), peer])
      setJoinCode('')
      void recordActivity('pairing', peer.name || peer.host, peer.host)
      toast(tt('Appareil appairé.'), 'success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tt('Appairage impossible.'))
    } finally {
      setBusy(null)
    }
  }

  const applyRemote = async (remote: string, newPassword?: string) => {
    try {
      const result = await lanSync(remote, newPassword)
      setNeedsPassword(false)
      setPassword('')
      setPendingRemote(null)
      toast(
        result.conflicts > 0
          ? tt('Synchronisation locale terminée avec des conflits archivés.')
          : tt('Synchronisation locale terminée.'),
        result.conflicts > 0 ? 'info' : 'success',
      )
      if (result.warnings.length > 0) {
        toast(result.warnings.slice(0, 3).join(' '), 'info')
      }
    } catch (caught) {
      if (caught instanceof SyncEpochRequiredError) {
        setPendingRemote(remote)
        setNeedsPassword(true)
        setError(caught.message)
      } else {
        setError(
          caught instanceof Error ? caught.message : tt('Synchronisation locale impossible.'),
        )
      }
    }
  }

  const receive = async () => {
    if (!file) return
    setBusy('serve')
    setError(null)
    try {
      const result = await lanSyncServe(serializeVault(file, false), referencedBlobIds())
      await applyRemote(result.file)
      toast(
        tt('Fichier reçu de {name} ({count} blob(s)).')
          .replace('{name}', result.peer.name)
          .replace('{count}', String(result.blobsReceived)),
        'info',
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : tt('Réception impossible.'),
      )
    } finally {
      setBusy(null)
    }
  }

  const pull = async (peer: LanPeer) => {
    if (!file) return
    setBusy(peer.id)
    setError(null)
    try {
      const result = await lanSyncPull(peer.id, serializeVault(file, false), referencedBlobIds())
      await applyRemote(result.file)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : tt('Synchronisation locale impossible.'),
      )
    } finally {
      setBusy(null)
    }
  }

  const forget = async (peer: LanPeer) => {
    try {
      await lanForgetPeer(peer.id)
      setPeers((current) => current.filter((entry) => entry.id !== peer.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tt('Suppression impossible.'))
    }
  }

  const copyCode = async () => {
    if (!pairing) return
    try {
      if (!(await copySensitive(pairing.code, 120))) {
        throw new Error('copie refusée')
      }
      toast(tt('Code copié.'), 'success')
    } catch {
      setError(tt('Copie impossible.'))
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section__head">
        <span className="settings-section__icon">
          <Wifi size={18} />
        </span>
        <div>
          <h3>{tt('Synchronisation locale')}</h3>
          <p>
            {tt(
              'Appareils sur le même réseau Wi-Fi, sans serveur ni Internet. Le port n’est ouvert que pendant une réception.',
            )}
          </p>
        </div>
      </div>

      {identity && (
        <p className="field__hint">
          {tt('Empreinte de cet appareil')} :{' '}
          <code>{formatFingerprint(identity.fingerprint)}</code>
        </p>
      )}

      <div className="form-grid">
        <label className="field field--full">
          <span className="field__label">{tt('Nom de cet appareil')}</span>
          <input
            className="input"
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            maxLength={80}
          />
        </label>
      </div>

      <div className="settings-actions settings-actions--start">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void startPairing()}
          disabled={busy !== null || pairing !== null}
        >
          {busy === 'pair' ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Wifi size={16} />
          )}
          {tt('Créer un code d’appairage')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void discover()}
          disabled={busy !== null}
        >
          {busy === 'discover' ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Wifi size={16} />
          )}
          {tt('Découvrir les appareils')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void receive()}
          disabled={busy !== null || !file}
        >
          {busy === 'serve' ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          {tt('Recevoir une synchronisation')}
        </button>
      </div>

      {pairing && (
        <div className="lan-pair">
          <div className="lan-pair__qr">
            <img src={qrDataUrl(pairing.code)} alt={tt('Code d’appairage')} />
          </div>
          <div className="lan-pair__code">
            <code>{pairing.code}</code>
            <p className="field__hint">
              {tt('Scannez ce code ou copiez-le sur l’autre appareil.')}
            </p>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void copyCode()}
            >
              <Copy size={14} />
              {tt('Copier le code')}
            </button>
          </div>
        </div>
      )}

      <div className="form-grid">
        <label className="field field--full">
          <span className="field__label">{tt('Rejoindre avec un code')}</span>
          <textarea
            className="input"
            rows={3}
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder={tt('coffre-lan://pair/…')}
            spellCheck={false}
          />
        </label>
      </div>
      <div className="settings-actions settings-actions--start">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void joinPairing()}
          disabled={busy !== null || !joinCode.trim()}
        >
          {busy === 'join' ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Check size={16} />
          )}
          {tt('Appairer cet appareil')}
        </button>
      </div>

      {discovered.length > 0 && (
        <ul className="lan-peers">
          {discovered.map((entry) => {
            const known = peers.some((peer) => peer.id === entry.id)
            return (
              <li key={`${entry.id}-${entry.host}`} className="lan-peer">
                <div className="lan-peer__text">
                  <strong>{entry.name || tt('Appareil sans nom')}</strong>
                  <span>
                    {entry.host}:{entry.port}
                  </span>
                </div>
                {known && (
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => void applyDiscovered(entry)}
                  >
                    {tt('Mettre à jour l’adresse')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {peers.length > 0 && (
        <ul className="lan-peers">
          {peers.map((peer) => (
            <li key={peer.id} className="lan-peer">
              <div className="lan-peer__text">
                <strong>{peer.name || tt('Appareil sans nom')}</strong>
                <span>
                  {peer.host} · {formatFingerprint(peer.id).slice(0, 14)}
                </span>
              </div>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void pull(peer)}
                disabled={busy !== null}
              >
                {busy === peer.id ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {tt('Synchroniser')}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void forget(peer)}
                aria-label={tt('Oublier cet appareil')}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {needsPassword && pendingRemote && (
        <div className="form-grid">
          <label className="field field--full">
            <span className="field__label">{tt('Mot de passe maître de l’autre appareil')}</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void applyRemote(pendingRemote, password)}
              disabled={!password}
            >
              <Check size={16} />
              {tt('Adopter le nouveau mot de passe')}
            </button>
          </div>
        </div>
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
