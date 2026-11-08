import { useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Keyboard } from 'lucide-react'
import { Modal } from './Modal'
import { AutoTypeDialog } from './AutoTypeDialog'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { autotypeAvailable, type ActiveWindowInfo } from '../lib/autotype'
import { hostFromUrl } from '../lib/extensionProtocol'
import type { LoginItem } from '../lib/types'

/**
 * Raccourci global de saisie automatique : Rust capture la fenêtre active,
 * l’application propose les connexions correspondantes, puis tape la séquence
 * après masquage de Coffre.
 */
export function AutoTypePicker() {
  const { items } = useVault()
  const { tt } = useI18n()
  const [request, setRequest] = useState<ActiveWindowInfo | null>(null)
  const [selected, setSelected] = useState<LoginItem | null>(null)

  useEffect(() => {
    if (!autotypeAvailable()) return
    const unlisten = listen<ActiveWindowInfo>('coffre:autotype-request', (event) => {
      setSelected(null)
      setRequest(event.payload)
    })
    return () => {
      void unlisten.then((cleanup) => cleanup())
    }
  }, [])

  const candidates = useMemo(() => {
    if (!request) return []
    const text = `${request.title} ${request.appName} ${request.processPath}`.toLowerCase()
    const logins = items.filter(
      (item): item is LoginItem => item.type === 'login' && !item.deletedAt,
    )
    const scored = logins.map((item) => {
      const hosts = item.urls.map(hostFromUrl).filter(Boolean)
      const score =
        (item.title && text.includes(item.title.toLowerCase()) ? 2 : 0) +
        (hosts.some((host) => text.includes(host)) ? 2 : 0) +
        (item.username && text.includes(item.username.toLowerCase()) ? 1 : 0)
      return { item, score }
    })
    return scored
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.item.title.localeCompare(b.item.title, 'fr', { sensitivity: 'base' }),
      )
      .map(({ item }) => item)
  }, [items, request])

  if (!request || !autotypeAvailable()) return null

  if (selected) {
    return (
      <AutoTypeDialog
        item={selected}
        targetWindow={request}
        onClose={() => {
          setSelected(null)
          setRequest(null)
        }}
      />
    )
  }

  return (
    <Modal
      title={tt('Saisie automatique')}
      description={`${request.appName} · ${request.title}`}
      size="sm"
      onClose={() => setRequest(null)}
    >
      {candidates.length === 0 ? (
        <p className="field__hint">{tt('Aucune connexion disponible.')}</p>
      ) : (
        <ul className="autotype-picker">
          {candidates.slice(0, 12).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="autotype-picker__item"
                onClick={() => setSelected(item)}
              >
                <Keyboard size={16} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.username || item.urls[0] || ''}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
