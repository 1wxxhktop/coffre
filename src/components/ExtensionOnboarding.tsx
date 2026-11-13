import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  CheckCircle2,
  FolderOpen,
  LoaderCircle,
  Puzzle,
} from 'lucide-react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { useVault } from '../state/VaultProvider'
import {
  extensionInstallInfo,
  revealExtensionFolder,
  type ExtensionInstallInfo,
} from '../lib/extensionInstall'
import { loadBridgeKey } from '../lib/keychain'
import { isMobileRuntime } from '../lib/platform'
import {
  completeExtensionOnboarding,
  dismissExtensionOnboarding,
  extensionOnboardingState,
  shouldShowExtensionOnboarding,
} from '../lib/extensionOnboarding'

type Step = 'install' | 'pair' | 'done'

/**
 * Assistant d’installation de l’extension navigateur.
 *
 * Il s’ouvre après la création d’un coffre, ou après un déverrouillage tant que
 * l’extension n’a jamais été associée. L’utilisateur peut le rouvrir depuis les
 * réglages avec l’événement `coffre:extension-onboarding`.
 */
export function ExtensionOnboarding() {
  const { t } = useI18n()
  const { toast } = useToast()
  const { status } = useVault()
  const [info, setInfo] = useState<ExtensionInstallInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('install')
  const [checking, setChecking] = useState(false)

  const openAssistant = useCallback(async () => {
    if (isMobileRuntime()) return
    const next = await extensionInstallInfo()
    setInfo(next)
    if (!next.available) {
      setStep('install')
      setOpen(true)
      return
    }
    const paired = Boolean(await loadBridgeKey())
    setStep(paired ? 'done' : 'install')
    setOpen(true)
  }, [])

  useEffect(() => {
    const handler = () => {
      void openAssistant()
    }
    window.addEventListener('coffre:extension-onboarding', handler)
    return () =>
      window.removeEventListener('coffre:extension-onboarding', handler)
  }, [openAssistant])

  useEffect(() => {
    if (status !== 'unlocked' || isMobileRuntime()) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void Promise.all([extensionInstallInfo(), loadBridgeKey()]).then(
        ([next, key]) => {
          if (cancelled || !next.available) return
          setInfo(next)
          if (key) {
            completeExtensionOnboarding()
            return
          }
          if (
            !shouldShowExtensionOnboarding({
              available: next.available,
              paired: false,
              state: extensionOnboardingState(),
            })
          ) {
            return
          }
          // Laisser la priorité à une éventuelle fenêtre d’appairage déjà
          // ouverte par l’extension.
          if (document.querySelector('.modal-overlay')) return
          setStep('install')
          setOpen(true)
        },
      )
    }, 900)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [status])

  useEffect(() => {
    if (!open || step !== 'pair') return
    let cancelled = false
    const check = async () => {
      const key = await loadBridgeKey()
      if (!cancelled && key) {
        setStep('done')
        setChecking(false)
        completeExtensionOnboarding()
      }
    }
    const paired = () => {
      setStep('done')
      setChecking(false)
      completeExtensionOnboarding()
    }
    window.addEventListener('coffre:bridge-paired', paired)
    const timer = window.setInterval(() => void check(), 2000)
    void check()
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('coffre:bridge-paired', paired)
    }
  }, [open, step])

  if (!open || !info || status !== 'unlocked') return null

  const close = () => {
    if (step === 'done') completeExtensionOnboarding()
    else dismissExtensionOnboarding()
    setOpen(false)
  }

  const installed = () => {
    setStep('pair')
  }

  const checkAgain = async () => {
    setChecking(true)
    const key = await loadBridgeKey()
    if (key) {
      setStep('done')
      completeExtensionOnboarding()
    }
    setChecking(false)
  }

  const reveal = () =>
    void revealExtensionFolder().then((opened) => {
      if (!opened) {
        toast(t('onboarding.extension.revealFailed'), 'error')
      }
    })

  const footer =
    step === 'done' ? (
      <button
        type="button"
        className="button button--primary"
        onClick={close}
      >
        {t('onboarding.extension.finish')}
      </button>
    ) : !info.available ? (
      <button type="button" className="button button--primary" onClick={close}>
        {t('common.close')}
      </button>
    ) : step === 'install' ? (
      <>
        <button type="button" className="button button--ghost" onClick={close}>
          {t('onboarding.extension.later')}
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={installed}
        >
          {t('onboarding.extension.installed')}
        </button>
      </>
    ) : (
      <>
        <button type="button" className="button button--ghost" onClick={close}>
          {t('onboarding.extension.later')}
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void checkAgain()}
          disabled={checking}
        >
          {checking ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Check size={15} />
          )}
          {checking
            ? t('common.loading')
            : t('onboarding.extension.pairCheck')}
        </button>
      </>
    )

  return (
    <Modal
      title={
        step === 'done'
          ? t('onboarding.extension.pairDoneTitle')
          : t('onboarding.extension.title')
      }
      description={
        step === 'done'
          ? undefined
          : t('onboarding.extension.description')
      }
      size="md"
      onClose={close}
      footer={footer}
    >
      {!info.available ? (
        <p className="settings-copy">{t('onboarding.extension.unavailable')}</p>
      ) : step === 'done' ? (
        <div className="onboarding-success">
          <CheckCircle2 size={34} />
          <p>{t('onboarding.extension.pairDoneCopy')}</p>
        </div>
      ) : (
        <>
          <ol className="onboarding-steps">
            <li
              className={`onboarding-step ${step === 'install' ? 'is-active' : 'is-done'}`}
            >
              <span className="onboarding-step__number">
                {step === 'pair' ? <Check size={14} /> : '1'}
              </span>
              <div>
                <h3>{t('onboarding.extension.stepInstall')}</h3>
                <p>{t('onboarding.extension.installCopy')}</p>
              </div>
            </li>
            <li
              className={`onboarding-step ${step === 'pair' ? 'is-active' : ''}`}
            >
              <span className="onboarding-step__number">2</span>
              <div>
                <h3>{t('onboarding.extension.stepPair')}</h3>
                <p>{t('onboarding.extension.pairCopy')}</p>
              </div>
            </li>
          </ol>

          {step === 'install' ? (
            <div className="onboarding-extension">
              <div className="onboarding-extension__head">
                <Puzzle size={18} />
                <strong>{t('onboarding.extension.stepInstall')}</strong>
              </div>
              {info.path && (
                <dl className="onboarding-extension__path">
                  <dt>{t('onboarding.extension.path')}</dt>
                  <dd className="mono">{info.path}</dd>
                </dl>
              )}
              <button
                type="button"
                className="button button--secondary"
                onClick={reveal}
              >
                <FolderOpen size={16} />
                {t('onboarding.extension.reveal')}
              </button>
              <p>{t('onboarding.extension.chrome')}</p>
              <p>{t('onboarding.extension.firefox')}</p>
            </div>
          ) : (
            <div className="onboarding-wait" role="status">
              <LoaderCircle size={18} className="spin" />
              <span>{t('onboarding.extension.pairWaiting')}</span>
            </div>
          )}

          <p className="settings-copy onboarding-hint">
            {t('onboarding.extension.settingsHint')}
          </p>
        </>
      )}
    </Modal>
  )
}
