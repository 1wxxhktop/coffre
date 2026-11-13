import { useEffect, useState } from 'react'
import { FolderOpen, Puzzle } from 'lucide-react'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import {
  extensionInstallInfo,
  revealExtensionFolder,
  type ExtensionInstallInfo,
} from '../lib/extensionInstall'

/**
 * Réglages → Mises à jour : dossier de l’extension tenu à jour par
 * l’application. L’utilisateur le charge une fois dans son navigateur ; ensuite
 * l’extension suit les mises à jour de Coffre sans autre manipulation.
 */
export function ExtensionSettings() {
  const { t, tt } = useI18n()
  const { toast } = useToast()
  const [info, setInfo] = useState<ExtensionInstallInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    void extensionInstallInfo().then((next) => {
      if (!cancelled) setInfo(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!info) return null

  return (
    <section className="settings-section" aria-labelledby="settings-extension">
      <div className="settings-section__head">
        <span className="settings-section__icon">
          <Puzzle size={18} />
        </span>
        <div>
          <h3 id="settings-extension">{tt('Extension navigateur')}</h3>
          <p>
            {tt(
              'Coffre garde une copie à jour de l’extension dans un dossier fixe. Chargez ce dossier une fois dans votre navigateur : l’extension se rechargera ensuite d’elle-même après chaque mise à jour de Coffre.',
            )}
          </p>
        </div>
      </div>

      {info.available && info.path ? (
        <>
          <dl className="update-facts">
            <div>
              <dt>{tt('Version de l’extension')}</dt>
              <dd>{info.version}</dd>
            </div>
            <div>
              <dt>{tt('Dossier à charger')}</dt>
              <dd className="mono extension-path">{info.path}</dd>
            </div>
          </dl>
          <div className="settings-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() =>
                void revealExtensionFolder().then((opened) => {
                  if (!opened) toast(tt('Impossible d’ouvrir le dossier'), 'error')
                })
              }
            >
              <FolderOpen size={16} />
              {tt('Afficher le dossier')}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() =>
                window.dispatchEvent(new Event('coffre:extension-onboarding'))
              }
            >
              <Puzzle size={16} />
              {t('onboarding.extension.reopen')}
            </button>
          </div>
          <ol className="settings-copy extension-steps">
            <li>{tt('Ouvrez la page des extensions du navigateur (chrome://extensions).')}</li>
            <li>{tt('Activez le « Mode développeur ».')}</li>
            <li>
              {tt('Cliquez sur « Charger l’extension non empaquetée » et choisissez ce dossier.')}
            </li>
          </ol>
          <p className="settings-copy">
            {tt(
              'Si l’extension était déjà chargée depuis un autre dossier, retirez-la puis chargez celui-ci : c’est le seul que Coffre tient à jour.',
            )}
          </p>
        </>
      ) : (
        <p className="settings-copy">
          {tt(
            'Ce build n’embarque pas l’extension (build local ou de développement). Utilisez une version publiée de Coffre.',
          )}
        </p>
      )}
    </section>
  )
}
