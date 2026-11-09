import { useEffect, useState } from 'react'
import {
  Copy,
  Fingerprint,
  FolderOpen,
  LoaderCircle,
  Package,
  RefreshCw,
  Users,
} from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import { copyToClipboard } from '../lib/clipboard'
import { downloadFile, formatDateTime } from '../lib/settings'
import { isTauriRuntime } from '../lib/external'
import {
  pickWebSharedDirectory,
  webSyncAvailable,
} from '../lib/syncWebStorage'
import { publicSharingIdentity, type SharingIdentity } from '../lib/sharing'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { useVault } from '../state/VaultProvider'

export function SharingSettings() {
  const {
    vaults,
    getSharingIdentity,
    createSharingIdentity,
    createSharingPackage,
    createSharingBundle,
    importSharingPackage,
    getVaultSharing,
    revokeSharingMember,
    syncRevision,
    configureSharedFolder,
    configureWebSharedFolder,
    disableSharedSync,
    syncSharedVault,
    getSharedSyncStatus,
  } = useVault()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [identity, setIdentity] = useState<SharingIdentity | null>(null)
  const [busy, setBusy] = useState<'identity' | 'package' | 'bundle' | 'import' | 'revoke' | null>(null)
  const [copied, setCopied] = useState<'identity' | 'package' | null>(null)
  const [shareVaultId, setShareVaultId] = useState(vaults[0]?.id ?? '')
  const [memberText, setMemberText] = useState('')
  const [packageText, setPackageText] = useState('')
  const [importText, setImportText] = useState('')
  const [importName, setImportName] = useState('')
  const [members, setMembers] = useState<
    import('../lib/types').VaultSharingMember[]
  >([])
  const [adminFingerprint, setAdminFingerprint] = useState<string | undefined>()
  const [hasPackage, setHasPackage] = useState(false)
  const [sharedStatus, setSharedStatus] = useState<
    import('../lib/sharedSyncConfig').SharedSyncConfig | null
  >(null)
  const [sharedBusy, setSharedBusy] = useState<
    'choose' | 'sync' | 'disable' | null
  >(null)

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

  useEffect(() => {
    if (!vaults.some((vault) => vault.id === shareVaultId)) {
      setShareVaultId(vaults[0]?.id ?? '')
    }
  }, [shareVaultId, vaults])

  const loadMembers = async (vaultId: string) => {
    if (!vaultId) {
      setMembers([])
      setAdminFingerprint(undefined)
      setHasPackage(false)
      return
    }
    try {
      const sharing = await getVaultSharing(vaultId)
      setMembers(sharing.members)
      setAdminFingerprint(sharing.adminFingerprint)
      setHasPackage(Boolean(sharing.package))
    } catch {
      setMembers([])
      setAdminFingerprint(undefined)
      setHasPackage(false)
    }
  }

  useEffect(() => {
    void loadMembers(shareVaultId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareVaultId])

  useEffect(() => {
    setSharedStatus(getSharedSyncStatus(shareVaultId))
  }, [getSharedSyncStatus, shareVaultId, syncRevision])

  const create = async () => {
    if (busy) return
    setBusy('identity')
    try {
      setIdentity(await createSharingIdentity())
      toast(tt('Identité de partage créée'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : tt('Création de l’identité impossible'),
        'error',
      )
    } finally {
      setBusy(null)
    }
  }

  const publicIdentity = identity ? publicSharingIdentity(identity) : null
  const identityJson = publicIdentity ? JSON.stringify(publicIdentity) : ''
  const copyIdentity = async () => {
    if (!identityJson) return
    if (await copyToClipboard(identityJson)) {
      setCopied('identity')
      window.setTimeout(() => setCopied(null), 1_500)
    }
  }

  const generatePackage = async () => {
    if (!shareVaultId || busy) return
    setBusy('package')
    try {
      const pkg = await createSharingPackage(
        shareVaultId,
        memberText.split('\n'),
      )
      setPackageText(JSON.stringify(pkg, null, 2))
      await loadMembers(shareVaultId)
      toast(tt('Paquet de partage généré'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : tt('Génération du paquet impossible'),
        'error',
      )
    } finally {
      setBusy(null)
    }
  }

  const generateBundle = async () => {
    if (!shareVaultId || busy) return
    setBusy('bundle')
    try {
      const bundle = await createSharingBundle(
        shareVaultId,
        memberText.split('\n'),
      )
      setPackageText(JSON.stringify(bundle, null, 2))
      await loadMembers(shareVaultId)
      toast(tt('Paquet complet généré'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : tt('Génération du paquet impossible'),
        'error',
      )
    } finally {
      setBusy(null)
    }
  }

  const copyPackage = async () => {
    if (!packageText) return
    if (await copyToClipboard(packageText)) {
      setCopied('package')
      window.setTimeout(() => setCopied(null), 1_500)
    }
  }

  const chooseSharedFolder = async () => {
    if (!shareVaultId || sharedBusy) return
    setSharedBusy('choose')
    try {
      if (isTauriRuntime()) {
        const selected = await open({
          directory: true,
          multiple: false,
          title: tt('Choisir un dossier de partage'),
        })
        if (typeof selected !== 'string') return
        await configureSharedFolder(shareVaultId, selected)
      } else if (webSyncAvailable()) {
        const handle = await pickWebSharedDirectory()
        await configureWebSharedFolder(shareVaultId, handle)
      } else {
        throw new Error(
          'Ce navigateur ne permet pas de choisir un dossier. Utilisez l’échange manuel.',
        )
      }
      setSharedStatus(getSharedSyncStatus(shareVaultId))
      toast(tt('Dossier de partage configuré.'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error
          ? caught.message
          : tt('Configuration du dossier impossible.'),
        'error',
      )
    } finally {
      setSharedBusy(null)
    }
  }

  const runSharedSync = async () => {
    if (!shareVaultId || sharedBusy) return
    setSharedBusy('sync')
    try {
      const report = await syncSharedVault(shareVaultId)
      setSharedStatus(getSharedSyncStatus(shareVaultId))
      if (report.warnings.length > 0) {
        toast(report.warnings.slice(0, 2).join(' '), 'info')
      } else {
        toast(tt('Synchronisation terminée.'), 'success')
      }
    } catch (caught) {
      toast(
        caught instanceof Error
          ? caught.message
          : tt('Synchronisation impossible.'),
        'error',
      )
    } finally {
      setSharedBusy(null)
    }
  }

  const disableShared = async () => {
    if (!shareVaultId || sharedBusy) return
    setSharedBusy('disable')
    try {
      await disableSharedSync(shareVaultId)
      setSharedStatus(null)
      toast(tt('Synchronisation du partage désactivée.'), 'info')
    } catch (caught) {
      toast(
        caught instanceof Error
          ? caught.message
          : tt('Désactivation impossible.'),
        'error',
      )
    } finally {
      setSharedBusy(null)
    }
  }

  const revoke = async (fingerprint: string) => {
    if (busy) return
    setBusy('revoke')
    try {
      const pkg = await revokeSharingMember(shareVaultId, fingerprint)
      setPackageText(JSON.stringify(pkg, null, 2))
      await loadMembers(shareVaultId)
      toast(tt('Membre révoqué, nouveau paquet généré.'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : tt('Révocation impossible.'),
        'error',
      )
    } finally {
      setBusy(null)
    }
  }

  const importPackage = async () => {
    if (!importText.trim() || !importName.trim() || busy) return
    setBusy('import')
    try {
      await importSharingPackage(importText, importName)
      setImportText('')
      setImportName('')
      await loadMembers(shareVaultId)
      toast(tt('Coffre partagé importé'), 'success')
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : tt('Import du coffre impossible'),
        'error',
      )
    } finally {
      setBusy(null)
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
            rows={4}
            readOnly
            value={JSON.stringify(publicIdentity, null, 2)}
            aria-label={tt('Identité publique')}
          />
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void copyIdentity()}
            >
              <Copy size={16} />
              {copied === 'identity' ? tt('Identité copiée') : tt('Copier l’identité publique')}
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
              disabled={busy !== null}
            >
              {busy === 'identity' ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Users size={16} />
              )}
              {tt('Créer mon identité')}
            </button>
          </div>
        </>
      )}

      <details className="settings-help">
        <summary>{tt('Créer un paquet de partage')}</summary>
        <div className="form-grid">
          <label className="field field--full">
            <span className="field__label">{tt('Coffre à partager')}</span>
            <select
              className="input"
              value={shareVaultId}
              onChange={(event) => setShareVaultId(event.target.value)}
            >
              {vaults.map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--full">
            <span className="field__label">
              {tt('Identités des membres (une par ligne)')}
            </span>
            <textarea
              className="input input--mono"
              rows={3}
              value={memberText}
              onChange={(event) => setMemberText(event.target.value)}
              placeholder={tt('Collez une identité publique JSON par ligne')}
              spellCheck={false}
            />
          </label>
        </div>
        <div className="settings-actions settings-actions--start">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void generatePackage()}
            disabled={busy !== null || !shareVaultId}
          >
            {busy === 'package' ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Package size={16} />
            )}
            {tt('Générer le paquet')}
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void generateBundle()}
            disabled={busy !== null || !shareVaultId}
          >
            {busy === 'bundle' ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Package size={16} />
            )}
            {tt('Générer le paquet complet')}
          </button>
        </div>
        {packageText && (
          <>
            <textarea
              className="input input--mono"
              rows={6}
              readOnly
              value={packageText}
              aria-label={tt('Paquet de partage')}
            />
            <div className="settings-actions settings-actions--start">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void copyPackage()}
              >
                <Copy size={16} />
                {copied === 'package' ? tt('Paquet copié') : tt('Copier le paquet')}
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={() =>
                  downloadFile(
                    packageText,
                    `partage-${shareVaultId}.coffre-shared.json`,
                    'application/json',
                  )
                }
              >
                <Package size={16} />
                {tt('Télécharger le paquet')}
              </button>
            </div>
          </>
        )}
        <p className="settings-copy">
          {tt(
            'Les rôles sont vérifiés à l’import ; l’écriture n’est pas encore restreinte par le rôle.',
          )}
        </p>
      </details>

      <details className="settings-help">
        <summary>{tt('Membres du coffre')}</summary>
        {members.length === 0 ? (
          <p className="settings-copy">{tt('Aucun membre enregistré.')}</p>
        ) : (
          <div className="detail-list">
            {members.map((member) => (
              <div className="detail-row" key={member.fingerprint}>
                <span className="detail-row__label">
                  <span className="mono">{member.fingerprint}</span>
                </span>
                <span className="detail-row__value">
                  <span className="detail-row__text">
                    {member.role === 'write' ? tt('Écriture') : tt('Lecture')}
                    {member.fingerprint === adminFingerprint
                      ? ` · ${tt('Administrateur')}`
                      : ''}
                  </span>
                  {member.fingerprint === adminFingerprint ||
                  adminFingerprint !== identity?.fingerprint ? null : (
                    <span className="detail-row__actions">
                      <button
                        type="button"
                        className="button button--danger-text"
                        onClick={() => void revoke(member.fingerprint)}
                        disabled={busy !== null}
                      >
                        {tt('Révoquer')}
                      </button>
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="settings-copy">
          {tt(
            'Un membre révoqué conserve l’ancienne clé pour les contenus déjà reçus.',
          )}
        </p>
      </details>

      {(members.length > 0 || adminFingerprint) && hasPackage && (
        <details className="settings-help" open={Boolean(sharedStatus)}>
          <summary>{tt('Synchronisation par dossier')}</summary>
        <p className="settings-copy">
          {tt(
            'Chaque membre dépose un bundle signé dans un dossier commun. Les fichiers restent chiffrés ; choisissez un dossier déjà synchronisé (iCloud Drive, Dropbox, Syncthing…).',
          )}
        </p>
        {sharedStatus ? (
          <>
            <p className="settings-copy">
              <FolderOpen size={15} />{' '}
              <span className="mono">{sharedStatus.dir}</span>
            </p>
            <p className="settings-copy">
              {tt('Dernière synchronisation :')}{' '}
              {sharedStatus.lastSyncAt
                ? formatDateTime(sharedStatus.lastSyncAt)
                : tt('jamais')}
            </p>
            {sharedStatus.lastWarning && (
              <p className="form-error" role="alert">
                {sharedStatus.lastWarning}
              </p>
            )}
            <div className="settings-actions settings-actions--start">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void runSharedSync()}
                disabled={sharedBusy !== null}
              >
                {sharedBusy === 'sync' ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                {tt('Synchroniser maintenant')}
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void chooseSharedFolder()}
                disabled={sharedBusy !== null}
              >
                <FolderOpen size={16} />
                {tt('Changer de dossier')}
              </button>
              <button
                type="button"
                className="button button--danger-text"
                onClick={() => void disableShared()}
                disabled={sharedBusy !== null}
              >
                {tt('Désactiver')}
              </button>
            </div>
            <p className="field__hint">
              {tt(
                'Synchronisation automatique toutes les 60 secondes lorsque le coffre est déverrouillé.',
              )}
            </p>
          </>
        ) : (
          <div className="settings-actions settings-actions--start">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void chooseSharedFolder()}
              disabled={sharedBusy !== null}
            >
              {sharedBusy === 'choose' ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <FolderOpen size={16} />
              )}
              {tt('Choisir un dossier')}
            </button>
          </div>
        )}
        </details>
      )}

      <details className="settings-help">
        <summary>{tt('Importer un coffre partagé')}</summary>
        <label className="field field--full">
          <span className="field__label">{tt('Fichier de partage')}</span>
          <input
            className="input"
            type="file"
            accept=".json,.coffre-shared,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              void file.text().then((text) => setImportText(text))
            }}
          />
        </label>
        <label className="field field--full">
          <span className="field__label">{tt('Paquet de partage')}</span>
          <textarea
            className="input input--mono"
            rows={5}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={tt('Collez le paquet JSON reçu')}
            spellCheck={false}
          />
        </label>
        <p className="settings-copy">
          {tt('Le paquet complet contient les éléments chiffrés du coffre. Le paquet de clé seule n’ajoute que le coffre vide.')}
        </p>
        <label className="field field--full">
          <span className="field__label">{tt('Nom du coffre importé')}</span>
          <input
            className="input"
            value={importName}
            onChange={(event) => setImportName(event.target.value)}
            maxLength={80}
          />
        </label>
        <div className="settings-actions settings-actions--start">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void importPackage()}
            disabled={busy !== null || !importText.trim() || !importName.trim()}
          >
            {busy === 'import' ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Package size={16} />
            )}
            {tt('Importer le coffre')}
          </button>
        </div>
      </details>
    </section>
  )
}
