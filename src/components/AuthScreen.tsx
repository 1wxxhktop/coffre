import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  Fingerprint,
  HardDriveDownload,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Trash2,
  Upload,
  WifiOff,
} from 'lucide-react'
import { Brand } from './Brand'
import { PasswordStrength } from './PasswordStrength'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { RecoveryUnlockDialog } from './RecoveryUnlockDialog'
import { useVault } from '../state/VaultProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'
import { estimateEntropy } from '../lib/crypto'
import { biometricSupported } from '../lib/biometrics'
import { formatDateTime } from '../lib/settings'

export function AuthScreen() {
  const {
    status,
    file,
    create,
    unlock,
    unlockWithBiometrics,
    importVault,
    reset,
    error,
  } = useVault()
  const { settings } = useSettings()
  const { toast } = useToast()
  const isSetup = status === 'empty'

  const [vaultName, setVaultName] = useState('Personnel')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bioBusy, setBioBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const bioBusyRef = useRef(false)
  const busyRef = useRef(false)
  const passwordRef = useRef('')
  const lastAutoBioRef = useRef(0)
  const biometricUnlockRef = useRef<() => Promise<void>>(async () => undefined)
  const [showRestore, setShowRestore] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)

  const entropy = useMemo(() => estimateEntropy(password), [password])
  const passwordStrongEnough = password.length >= 12 && entropy >= 50
  const passwordsMatch = password.length > 0 && password === confirmPassword
  const canCreate =
    isSetup && passwordStrongEnough && passwordsMatch && acknowledged && !busy
  const canUnlock = !isSetup && password.length > 0 && !busy

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setFormError(null)

    if (isSetup) {
      if (!passwordStrongEnough) {
        setFormError('Choisissez un mot de passe de 12 caractères minimum, moins devinable.')
        return
      }
      if (!passwordsMatch) {
        setFormError('Les deux mots de passe ne correspondent pas.')
        return
      }
      if (!acknowledged) {
        setFormError('Confirmez avoir compris que la récupération est optionnelle.')
        return
      }
    }

    setBusy(true)
    try {
      if (isSetup) {
        await create(password, vaultName.trim() || 'Personnel')
      } else {
        await unlock(password)
      }
      setPassword('')
      setConfirmPassword('')
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Une erreur est survenue')
    } finally {
      setBusy(false)
    }
  }

  const runBiometricUnlock = async () => {
    if (bioBusyRef.current || busyRef.current) return
    bioBusyRef.current = true
    setBioBusy(true)
    setFormError(null)
    try {
      const unlocked = await unlockWithBiometrics()
      if (unlocked) {
        setPassword('')
        setConfirmPassword('')
      }
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : 'Déverrouillage par empreinte impossible',
      )
    } finally {
      bioBusyRef.current = false
      // Empêche un nouveau dialogue dans la foulée de la fermeture du précédent.
      lastAutoBioRef.current = Date.now()
      setBioBusy(false)
    }
  }

  useEffect(() => {
    bioBusyRef.current = bioBusy
    busyRef.current = busy
    passwordRef.current = password
  }, [bioBusy, busy, password])

  useEffect(() => {
    biometricUnlockRef.current = runBiometricUnlock
  })

  const autoBiometric =
    !isSetup && settings.biometricUnlock && biometricSupported()

  // Touch ID s’ouvre dès que la fenêtre Coffre est activée sur l’écran de
  // verrouillage. Le délai évite de combattre l’animation d’ouverture, et le
  // refroidissement empêche une boucle après une annulation.
  useEffect(() => {
    if (!autoBiometric) return
    let disposed = false

    const attempt = () => {
      if (disposed || !document.hasFocus()) return
      if (bioBusyRef.current || busyRef.current) return
      if (passwordRef.current.length > 0) return
      if (document.querySelector('.modal-overlay')) return
      if (Date.now() - lastAutoBioRef.current < 2_000) return
      lastAutoBioRef.current = Date.now()
      void biometricUnlockRef.current()
    }

    const onFocus = () => attempt()
    window.addEventListener('focus', onFocus)
    const timers = [window.setTimeout(attempt, 300), window.setTimeout(attempt, 1_200)]

    return () => {
      disposed = true
      for (const timer of timers) window.clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [autoBiometric])

  const resetVault = async () => {
    await reset()
    setShowReset(false)
    setPassword('')
    toast('Coffre local effacé', 'info')
  }

  return (
    <div className="auth">
      <div className="auth__glow auth__glow--one" aria-hidden="true" />
      <div className="auth__glow auth__glow--two" aria-hidden="true" />

      <header className="auth__header" data-tauri-drag-region>
        <Brand subtitle="local-first" />
        <span className="pill pill--quiet">
          <span className="pill__dot" />
          Aucune connexion
        </span>
      </header>

      <main className="auth__main">
        <section className="auth__pitch" aria-labelledby="pitch-title">
          <span className="eyebrow">Gestionnaire de mots de passe</span>
          <h1 id="pitch-title" className="auth__headline">
            Vos secrets
            <br />
            restent <em>chez vous.</em>
          </h1>
          <p className="auth__lead">
            Un coffre chiffré, stocké uniquement sur cet appareil. Pas de compte, pas de
            serveur, pas de trace.
          </p>

          <ul className="auth__features">
            <li>
              <span className="auth__feature-icon">
                <ShieldCheck size={20} />
              </span>
              <span>
                <strong>Chiffrement authentifié</strong>
                <small>AES-256-GCM, clé dérivée par Argon2id</small>
              </span>
            </li>
            <li>
              <span className="auth__feature-icon">
                <WifiOff size={20} />
              </span>
              <span>
                <strong>Hors ligne par défaut</strong>
                <small>Zéro requête réseau, zéro télémétrie</small>
              </span>
            </li>
            <li>
              <span className="auth__feature-icon">
                <HardDriveDownload size={20} />
              </span>
              <span>
                <strong>Portable et lisible</strong>
                <small>Exportez un fichier .coffre chiffré</small>
              </span>
            </li>
          </ul>

          <div className="auth__visual" aria-hidden="true">
            <div className="auth__visual-ring auth__visual-ring--outer" />
            <div className="auth__visual-ring auth__visual-ring--inner" />
            <div className="auth__visual-lock">
              <KeyRound size={38} />
            </div>
            <span className="auth__visual-chip auth__visual-chip--top">
              <ShieldCheck size={14} /> chiffré
            </span>
            <span className="auth__visual-chip auth__visual-chip--bottom">
              <WifiOff size={14} /> local
            </span>
          </div>
        </section>

        <section className="auth__panel" aria-labelledby="auth-title">
          <div className="auth__panel-inner">
            <span className="eyebrow">{isSetup ? 'Première utilisation' : 'Coffre local'}</span>
            <h2 id="auth-title" className="auth__title">
              {isSetup ? 'Créer votre coffre' : 'Déverrouiller'}
            </h2>
            <p className="auth__subtitle">
              {isSetup
                ? 'Un seul mot de passe protège tout. Choisissez-le solide et mémorisable.'
                : 'Saisissez votre mot de passe maître pour déchiffrer vos données.'}
            </p>

            {!isSetup && file && (
              <div className="auth__vault-meta">
                <span>
                  <strong>{file.vaults.length}</strong> coffre
                  {file.vaults.length > 1 ? 's' : ''}
                </span>
                <span className="auth__vault-meta-sep" />
                <span>
                  <strong>{file.items.length}</strong> élément
                  {file.items.length > 1 ? 's' : ''}
                </span>
                <span className="auth__vault-meta-sep" />
                <span>modifié le {formatDateTime(file.updatedAt)}</span>
              </div>
            )}

            {!isSetup && settings.biometricUnlock && biometricSupported() && (
              <div className="auth__biometric">
                <button
                  type="button"
                  className="button button--secondary button--full"
                  onClick={() => void runBiometricUnlock()}
                  disabled={bioBusy || busy}
                >
                  {bioBusy ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : (
                    <Fingerprint size={18} />
                  )}
                  {bioBusy ? 'Vérification…' : 'Déverrouiller avec Touch ID'}
                </button>
                <div className="auth__separator">
                  <span>ou avec le mot de passe</span>
                </div>
              </div>
            )}

            <form className="form" onSubmit={(event) => void submit(event)}>
              {isSetup && (
                <label className="field">
                  <span className="field__label">Nom du coffre</span>
                  <input
                    className="input"
                    value={vaultName}
                    onChange={(event) => setVaultName(event.target.value)}
                    maxLength={80}
                    placeholder="Personnel"
                    autoComplete="off"
                  />
                </label>
              )}

              <label className="field">
                <span className="field__label">
                  {isSetup ? 'Mot de passe maître' : 'Mot de passe'}
                </span>
                <span className="input-group">
                  <input
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={isSetup ? 'new-password' : 'current-password'}
                    placeholder={isSetup ? '12 caractères minimum' : '••••••••••••'}
                    autoFocus
                    data-autofocus
                  />
                  <button
                    type="button"
                    className="input-group__action"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
                {isSetup && password.length > 0 && <PasswordStrength entropy={entropy} />}
              </label>

              {isSetup && (
                <label className="field">
                  <span className="field__label">Confirmer le mot de passe</span>
                  <input
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="Répétez le mot de passe"
                  />
                  {confirmPassword.length > 0 && !passwordsMatch && (
                    <span className="field__hint field__hint--error">
                      Les mots de passe ne correspondent pas.
                    </span>
                  )}
                </label>
              )}

              {isSetup && (
                <label className="checkbox checkbox--warning">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  <span>
                    <strong>Aucune récupération par défaut.</strong> Si j’oublie ce mot de
                    passe et que je n’ai pas configuré de phrase de récupération, mes
                    données seront définitivement inaccessibles.
                  </span>
                </label>
              )}

              {formError && (
                <p className="form-error" role="alert">
                  <AlertTriangle size={16} />
                  {formError}
                </p>
              )}
              {!formError && error && (
                <p className="form-error" role="alert">
                  <AlertTriangle size={16} />
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="button button--primary button--lg button--full"
                disabled={isSetup ? !canCreate : !canUnlock}
              >
                {busy ? (
                  <>
                    <LoaderCircle size={18} className="spin" />
                    {isSetup ? 'Création du coffre…' : 'Déchiffrement…'}
                  </>
                ) : (
                  <>
                    {isSetup ? 'Créer mon coffre' : 'Déverrouiller'}
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>

            <div className="auth__actions">
              <button type="button" className="link-button" onClick={() => setShowRestore(true)}>
                <Upload size={15} />
                Restaurer un fichier .coffre
              </button>
              {!isSetup && file?.recovery && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setShowRecovery(true)}
                >
                  <KeyRound size={15} />
                  Déverrouiller avec une phrase de récupération
                </button>
              )}
              {!isSetup && (
                <button
                  type="button"
                  className="link-button link-button--danger"
                  onClick={() => setShowReset(true)}
                >
                  <Trash2 size={15} />
                  Effacer le coffre local
                </button>
              )}
            </div>

            <p className="auth__fineprint">
              Modèle de chiffrement inspiré du projet open source Proton Pass. Coffre
              sous licence GPL-3.0, sans aucun service distant.
            </p>
          </div>
        </section>
      </main>

      <footer className="auth__footer">
        <span>Fait pour rester hors ligne.</span>
        <span className="auth__footer-dot" />
        <span>Format de coffre v3</span>
      </footer>

      {showRestore && (
        <RestoreDialog
          replacing={!isSetup}
          onClose={() => setShowRestore(false)}
          onImport={async (text, importPassword) => {
            await importVault(text, importPassword)
            toast('Coffre restauré et déverrouillé', 'success')
            setShowRestore(false)
          }}
        />
      )}

      {showRecovery && <RecoveryUnlockDialog onClose={() => setShowRecovery(false)} />}

      {showReset && (
        <ConfirmDialog
          title="Effacer le coffre local ?"
          description="Cette action supprime définitivement le coffre stocké dans ce navigateur. Elle est irréversible. Pensez à exporter une sauvegarde avant de continuer."
          confirmLabel="Effacer définitivement"
          requireText="SUPPRIMER"
          onClose={() => setShowReset(false)}
          onConfirm={resetVault}
        />
      )}
    </div>
  )
}

interface RestoreDialogProps {
  replacing: boolean
  onClose: () => void
  onImport: (text: string, password: string) => Promise<void>
}

function RestoreDialog({ replacing, onClose, onImport }: RestoreDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [acknowledged, setAcknowledged] = useState(!replacing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!file || !password || !acknowledged || busy) return
    if (file.size > 100_000_000) {
      setError('Fichier trop volumineux (100 Mo maximum).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const text = await file.text()
      await onImport(text, password)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import impossible')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Restaurer un coffre"
      description="Choisissez un fichier .coffre exporté depuis Coffre, puis saisissez son mot de passe maître."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void submit()}
            disabled={!file || !password || !acknowledged || busy}
          >
            {busy ? 'Restauration…' : 'Restaurer'}
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="file-drop">
          <input
            type="file"
            accept=".coffre,.json,application/json"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Upload size={22} />
          <span>{file ? file.name : 'Choisir un fichier .coffre'}</span>
          <small>{file ? `${Math.ceil(file.size / 1024)} Ko` : 'Le fichier reste sur cet appareil'}</small>
        </label>

        <label className="field">
          <span className="field__label">Mot de passe maître du fichier</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            placeholder="••••••••••••"
          />
        </label>

        {replacing && (
          <label className="checkbox checkbox--warning">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              Je comprends que le coffre actuellement stocké dans ce navigateur sera remplacé.
            </span>
          </label>
        )}

        {error && (
          <p className="form-error" role="alert">
            <AlertTriangle size={16} />
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
