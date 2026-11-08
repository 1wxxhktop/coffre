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
  MoreHorizontal,
  ShieldCheck,
  Trash2,
  Upload,
  WifiOff,
} from 'lucide-react'
import { Brand } from './Brand'
import { Menu } from './Menu'
import { PasswordStrength } from './PasswordStrength'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { RecoveryUnlockDialog } from './RecoveryUnlockDialog'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useSettings } from '../state/SettingsProvider'
import { useToast } from '../state/ToastProvider'
import { estimateEntropy } from '../lib/strength'
import { biometricSupported } from '../lib/biometrics'
import { pluralKey } from '../lib/i18n'
import { formatDateTime } from '../lib/settings'

export function AuthScreen() {
  const {
    status,
    file,
    create,
    unlock,
    unlockWithBiometrics,
    unlockWithPrf,
    importVault,
    reset,
    error,
    recordActivity,
  } = useVault()
  const { settings } = useSettings()
  const { t, intl } = useI18n()
  const { toast } = useToast()
  const isSetup = status === 'empty'

  const [vaultName, setVaultName] = useState('Personnel')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bioBusy, setBioBusy] = useState(false)
  const [prfBusy, setPrfBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const bioBusyRef = useRef(false)
  const prfBusyRef = useRef(false)
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
        setFormError(t('auth.error.passwordWeak'))
        return
      }
      if (!passwordsMatch) {
        setFormError(t('auth.error.passwordMismatch'))
        return
      }
      if (!acknowledged) {
        setFormError(t('auth.error.acknowledge'))
        return
      }
    }

    setBusy(true)
    try {
      if (isSetup) {
        await create(password, vaultName.trim() || 'Personnel')
      } else {
        await unlock(password)
        void recordActivity('unlock', 'Déverrouillage par mot de passe')
      }
      setPassword('')
      setConfirmPassword('')
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t('auth.error.generic'))
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
        void recordActivity('unlock', 'Déverrouillage biométrique')
        setPassword('')
        setConfirmPassword('')
      }
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : t('auth.error.biometric'),
      )
    } finally {
      bioBusyRef.current = false
      // Empêche un nouveau dialogue dans la foulée de la fermeture du précédent.
      lastAutoBioRef.current = Date.now()
      setBioBusy(false)
    }
  }

  const runPrfUnlock = async () => {
    if (prfBusyRef.current || busyRef.current) return
    prfBusyRef.current = true
    setPrfBusy(true)
    setFormError(null)
    try {
      const unlocked = await unlockWithPrf()
      if (unlocked) {
        void recordActivity('unlock', 'Déverrouillage par clé de sécurité')
        setPassword('')
        setConfirmPassword('')
      }
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : t('auth.error.prf'),
      )
    } finally {
      setPrfBusy(false)
      prfBusyRef.current = false
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
    toast(t('auth.erase.success'), 'info')
  }

  return (
    <div className="auth">
      <div className="auth__glow auth__glow--one" aria-hidden="true" />
      <div className="auth__glow auth__glow--two" aria-hidden="true" />

      <header className="auth__header" data-tauri-drag-region>
        <Brand subtitle={t('sidebar.localFirst')} />
        <span className="pill pill--quiet">
          <span className="pill__dot" />
          {t('auth.noConnection')}
        </span>
      </header>

      <main className="auth__main">
        <section className="auth__pitch" aria-labelledby="pitch-title">
          <span className="eyebrow">{t('auth.eyebrow')}</span>
          <h1 id="pitch-title" className="auth__headline">
            {t('auth.headline.line1')}
            <br />
            {t('auth.headline.line2')} <em>{t('auth.headline.em')}</em>
          </h1>
          <p className="auth__lead">{t('auth.lead')}</p>

          <ul className="auth__features">
            <li>
              <span className="auth__feature-icon">
                <ShieldCheck size={20} />
              </span>
              <span>
                <strong>{t('auth.feature.encryption.title')}</strong>
                <small>{t('auth.feature.encryption.copy')}</small>
              </span>
            </li>
            <li>
              <span className="auth__feature-icon">
                <WifiOff size={20} />
              </span>
              <span>
                <strong>{t('auth.feature.offline.title')}</strong>
                <small>{t('auth.feature.offline.copy')}</small>
              </span>
            </li>
            <li>
              <span className="auth__feature-icon">
                <HardDriveDownload size={20} />
              </span>
              <span>
                <strong>{t('auth.feature.portable.title')}</strong>
                <small>{t('auth.feature.portable.copy')}</small>
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
              <ShieldCheck size={14} /> {t('auth.visual.encrypted')}
            </span>
            <span className="auth__visual-chip auth__visual-chip--bottom">
              <WifiOff size={14} /> {t('auth.visual.local')}
            </span>
          </div>
        </section>

        <section className="auth__panel" aria-labelledby="auth-title">
          <div className="auth__panel-inner">
            <span className="eyebrow">
              {isSetup ? t('auth.setupEyebrow') : t('auth.lockedEyebrow')}
            </span>
            <h2 id="auth-title" className="auth__title">
              {isSetup ? t('auth.createTitle') : t('auth.unlockTitle')}
            </h2>
            <p className="auth__subtitle">
              {isSetup ? t('auth.createSubtitle') : t('auth.unlockSubtitle')}
            </p>

            {!isSetup && file && (
              <div className="auth__vault-meta">
                <span>
                  {t(
                    pluralKey(
                      file.vaults.length,
                      'auth.vaultCount.one',
                      'auth.vaultCount.other',
                    ),
                    { count: file.vaults.length },
                  )}
                </span>
                <span className="auth__vault-meta-sep" />
                <span>
                  {file.items.length === 0
                    ? t('auth.noItems')
                    : t(
                        pluralKey(
                          file.items.length,
                          'auth.itemCount.one',
                          'auth.itemCount.other',
                        ),
                        { count: file.items.length },
                      )}
                </span>
                <span className="auth__vault-meta-sep" />
                <span>
                  {t('auth.modifiedAt', {
                    date: formatDateTime(file.updatedAt, intl),
                  })}
                </span>
              </div>
            )}

            {!isSetup && file?.prf && (
              <div className="auth__biometric">
                <button
                  type="button"
                  className="button button--secondary button--full"
                  onClick={() => void runPrfUnlock()}
                  disabled={prfBusy || busy}
                >
                  {prfBusy ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : (
                    <KeyRound size={18} />
                  )}
                  {prfBusy ? t('auth.prf.checking') : t('auth.prf.unlock')}
                </button>
                <div className="auth__separator">
                  <span>{t('auth.prf.orPassword')}</span>
                </div>
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
                  {bioBusy ? t('auth.biometric.checking') : t('auth.biometric.unlock')}
                </button>
                <div className="auth__separator">
                  <span>{t('auth.biometric.orPassword')}</span>
                </div>
              </div>
            )}

            <form className="form" onSubmit={(event) => void submit(event)}>
              {isSetup && (
                <label className="field">
                  <span className="field__label">{t('auth.field.vaultName')}</span>
                  <input
                    className="input"
                    value={vaultName}
                    onChange={(event) => setVaultName(event.target.value)}
                    maxLength={80}
                    placeholder={t('auth.placeholder.vaultName')}
                    autoComplete="off"
                  />
                </label>
              )}

              <label className="field">
                <span className="field__label">
                  {isSetup ? t('auth.field.masterPassword') : t('auth.field.password')}
                </span>
                <span className="input-group">
                  <input
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={isSetup ? 'new-password' : 'current-password'}
                    placeholder={
                      isSetup
                        ? t('auth.placeholder.passwordCreate')
                        : t('auth.placeholder.passwordUnlock')
                    }
                    autoFocus
                    data-autofocus
                  />
                  <button
                    type="button"
                    className="input-group__action"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={
                      showPassword ? t('auth.password.hide') : t('auth.password.show')
                    }
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
                {isSetup && password.length > 0 && <PasswordStrength entropy={entropy} />}
              </label>

              {isSetup && (
                <label className="field">
                  <span className="field__label">{t('auth.field.confirmPassword')}</span>
                  <input
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder={t('auth.placeholder.confirm')}
                  />
                  {confirmPassword.length > 0 && !passwordsMatch && (
                    <span className="field__hint field__hint--error">
                      {t('auth.mismatchHint')}
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
                    <strong>{t('auth.acknowledge.bold')}</strong>{' '}
                    {t('auth.acknowledge.copy')}
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

              {isSetup && !canCreate && !busy && (
                <p className="auth__requirements">
                  {!passwordStrongEnough
                    ? t('auth.requirement.password')
                    : !passwordsMatch
                      ? t('auth.requirement.confirm')
                      : !acknowledged
                        ? t('auth.requirement.acknowledge')
                        : ''}
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
                    {isSetup ? t('auth.busy.creating') : t('auth.busy.decrypting')}
                  </>
                ) : (
                  <>
                    {isSetup ? t('auth.action.create') : t('auth.action.unlock')}
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>

            <div className="auth__actions">
              <button type="button" className="link-button" onClick={() => setShowRestore(true)}>
                <Upload size={15} />
                {t('auth.action.restore')}
              </button>
              {!isSetup && file?.recovery && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setShowRecovery(true)}
                >
                  <KeyRound size={15} />
                  {t('auth.action.recovery')}
                </button>
              )}
              {!isSetup && (
                <Menu
                  label={t('auth.action.more')}
                  title={t('auth.action.more')}
                  align="left"
                  triggerClassName="link-button"
                  trigger={
                    <>
                      <MoreHorizontal size={15} />
                      {t('auth.action.more')}
                    </>
                  }
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__item menu__item--danger"
                    onClick={() => setShowReset(true)}
                  >
                    <Trash2 size={15} />
                    {t('auth.action.erase')}
                  </button>
                </Menu>
              )}
            </div>

            <p className="auth__fineprint">{t('auth.fineprint')}</p>
          </div>
        </section>
      </main>

      <footer className="auth__footer">
        <span>{t('auth.footer.local')}</span>
        <span className="auth__footer-dot" />
        <span>{t('auth.footer.offline')}</span>
      </footer>

      {showRestore && (
        <RestoreDialog
          replacing={!isSetup}
          onClose={() => setShowRestore(false)}
          onImport={async (text, importPassword) => {
            await importVault(text, importPassword)
            toast(t('auth.restore.success'), 'success')
            setShowRestore(false)
          }}
        />
      )}

      {showRecovery && <RecoveryUnlockDialog onClose={() => setShowRecovery(false)} />}

      {showReset && (
        <ConfirmDialog
          title={t('auth.erase.title')}
          description={t('auth.erase.description')}
          confirmLabel={t('auth.erase.confirm')}
          requireText={t('auth.erase.require')}
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
  const { t } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [acknowledged, setAcknowledged] = useState(!replacing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!file || !password || !acknowledged || busy) return
    if (file.size > 100_000_000) {
      setError(t('auth.restore.tooLarge'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const text = await file.text()
      await onImport(text, password)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('auth.restore.error'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('auth.restore.title')}
      description={t('auth.restore.description')}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void submit()}
            disabled={!file || !password || !acknowledged || busy}
          >
            {busy ? t('auth.restore.busy') : t('auth.restore.action')}
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
          <span>{file ? file.name : t('auth.restore.choose')}</span>
          <small>
            {file
              ? `${Math.ceil(file.size / 1024)} Ko`
              : t('auth.restore.local')}
          </small>
        </label>

        <label className="field">
          <span className="field__label">{t('auth.restore.password')}</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            placeholder={t('auth.restore.passwordPlaceholder')}
          />
        </label>

        {replacing && (
          <label className="checkbox checkbox--warning">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>{t('auth.restore.replace')}</span>
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
