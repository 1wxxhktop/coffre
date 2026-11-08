import { useEffect, useState } from 'react'
import { HardDrive, Trash2 } from 'lucide-react'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useToast } from '../state/ToastProvider'
import { formatBytes } from '../lib/settings'
import { listBlobs, removeBlob, type BlobEntry } from '../lib/blobStore'
import { isTauriRuntime } from '../lib/external'

export function BlobStorageSettings() {
  const { items } = useVault()
  const { tt } = useI18n()
  const { toast } = useToast()
  const [blobs, setBlobs] = useState<BlobEntry[]>([])

  const reload = () => {
    if (!isTauriRuntime()) return
    void listBlobs().then(setBlobs).catch(() => setBlobs([]))
  }

  useEffect(() => {
    reload()
  }, [])

  if (!isTauriRuntime()) return null

  const referenced = new Set(
    items.flatMap((item) =>
      item.attachments
        .filter((attachment) => attachment.storage === 'blob' && attachment.blobId)
        .map((attachment) => attachment.blobId as string),
    ),
  )
  const orphans = blobs.filter((blob) => !referenced.has(blob.id))
  const total = blobs.reduce((sum, blob) => sum + blob.size, 0)

  const clean = async () => {
    try {
      for (const blob of orphans) await removeBlob(blob.id)
      reload()
      toast(tt('Blobs orphelins supprimés.'), 'success')
    } catch {
      toast(tt('Nettoyage impossible.'), 'error')
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section__head">
        <span className="settings-section__icon">
          <HardDrive size={18} />
        </span>
        <div>
          <h3>{tt('Documents chiffrés')}</h3>
          <p>
            {blobs.length} {tt('blob(s)')} · {formatBytes(total)}
          </p>
        </div>
      </div>
      {orphans.length > 0 && (
        <div className="settings-actions settings-actions--start">
          <button type="button" className="button button--secondary" onClick={() => void clean()}>
            <Trash2 size={16} />
            {tt('Supprimer {count} blob(s) orphelin(s)').replace(
              '{count}',
              String(orphans.length),
            )}
          </button>
        </div>
      )}
    </section>
  )
}
