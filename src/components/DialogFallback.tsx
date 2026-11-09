import { LoaderCircle } from 'lucide-react'
import { Modal } from './Modal'
import { useI18n } from '../state/I18nProvider'

/**
 * Fallbacks des dialogues chargés à la demande.
 *
 * Le dialogue de chargement occupe immédiatement le rôle `dialog` : Échap et
 * les tests d’interface n’attendent pas le chunk pour pouvoir fermer.
 */
export function DialogLoading({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  return (
    <Modal title={t('common.loading')} size="sm" onClose={onClose}>
      <div className="history-empty" role="status">
        <LoaderCircle size={22} className="spin" />
      </div>
    </Modal>
  )
}

/** Attente discrète dans le panneau de détail, sans modale. */
export function PanelLoading() {
  const { t } = useI18n()
  return (
    <div className="history-empty" role="status">
      <LoaderCircle size={22} className="spin" />
      <p>{t('common.loading')}</p>
    </div>
  )
}
