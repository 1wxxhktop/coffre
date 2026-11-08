import { useMemo } from 'react'
import {
  ChevronRight,
  Clock3,
  Copy,
  KeyRound,
  Link2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { Modal } from './Modal'
import { analyzeSecurity, securityTone, type DuplicateUrlGroup, type ReusedPasswordGroup } from '../lib/security'
import { itemSubtitle, type VaultItem, type VaultSummary } from '../lib/types'

interface SecurityDialogProps {
  items: VaultItem[]
  vaults: VaultSummary[]
  onClose: () => void
  onOpenItem: (itemId: string) => void
}

function useVaultNames(vaults: VaultSummary[]): Map<string, string> {
  return useMemo(() => new Map(vaults.map((vault) => [vault.id, vault.name])), [vaults])
}

function ItemButton({
  item,
  vaultName,
  onOpen,
}: {
  item: VaultItem
  vaultName: string
  onOpen: (itemId: string) => void
}) {
  return (
    <button type="button" className="security-item" onClick={() => onOpen(item.id)}>
      <span className="security-item__icon">
        <KeyRound size={15} />
      </span>
      <span className="security-item__body">
        <span className="security-item__title">{item.title}</span>
        <span className="security-item__meta">
          {vaultName}
          {itemSubtitle(item) ? ` · ${itemSubtitle(item)}` : ''}
        </span>
      </span>
      <ChevronRight size={16} className="security-item__chevron" aria-hidden="true" />
    </button>
  )
}

function ItemList({
  items,
  vaultNames,
  onOpen,
}: {
  items: VaultItem[]
  vaultNames: Map<string, string>
  onOpen: (itemId: string) => void
}) {
  return (
    <div className="security-list">
      {items.map((item) => (
        <ItemButton
          key={item.id}
          item={item}
          vaultName={vaultNames.get(item.vaultId) ?? 'Coffre'}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

function ReusedList({
  groups,
  vaultNames,
  onOpen,
}: {
  groups: ReusedPasswordGroup[]
  vaultNames: Map<string, string>
  onOpen: (itemId: string) => void
}) {
  return (
    <div className="security-list">
      {groups.map((group) => (
        <div key={group.items.map((item) => item.id).join('-')} className="security-group">
          <p className="security-group__label">
            <Copy size={13} />
            Mot de passe partagé par {group.items.length} éléments
          </p>
          {group.items.map((item) => (
            <ItemButton
              key={item.id}
              item={item}
              vaultName={vaultNames.get(item.vaultId) ?? 'Coffre'}
              onOpen={onOpen}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function DuplicateList({
  groups,
  vaultNames,
  onOpen,
}: {
  groups: DuplicateUrlGroup[]
  vaultNames: Map<string, string>
  onOpen: (itemId: string) => void
}) {
  return (
    <div className="security-list">
      {groups.map((group) => (
        <div key={group.url} className="security-group">
          <p className="security-group__label">
            <Link2 size={13} />
            {group.url} · {group.items.length} éléments
          </p>
          {group.items.map((item) => (
            <ItemButton
              key={item.id}
              item={item}
              vaultName={vaultNames.get(item.vaultId) ?? 'Coffre'}
              onOpen={onOpen}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SecurityDialog({ items, vaults, onClose, onOpenItem }: SecurityDialogProps) {
  const vaultNames = useVaultNames(vaults)
  const report = useMemo(() => analyzeSecurity(items), [items])
  const tone = securityTone(report.score)

  const open = (itemId: string) => {
    onOpenItem(itemId)
  }

  return (
    <Modal
      title="Sécurité du coffre"
      description="Analyse locale des connexions actives. Aucun mot de passe ne quitte l’appareil."
      size="lg"
      onClose={onClose}
      footer={
        <button type="button" className="button button--secondary" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <div className={`security-score security-score--${tone}`}>
        <div className="security-score__value">
          {report.total === 0 ? '—' : report.score}
          {report.total > 0 && <small>/100</small>}
        </div>
        <div className="security-score__body">
          <strong>
            {report.total === 0
              ? 'Aucune connexion à analyser'
              : report.affected === 0
                ? 'Aucun problème détecté'
                : `${report.affected} élément${report.affected > 1 ? 's' : ''} à revoir`}
          </strong>
          <p>
            {report.total === 0
              ? 'Ajoutez une connexion pour commencer l’analyse.'
              : `${report.total} connexion${report.total > 1 ? 's' : ''} active${
                  report.total > 1 ? 's' : ''
                } analysée${report.total > 1 ? 's' : ''} localement.`}
          </p>
        </div>
      </div>

      {report.affected === 0 && report.total > 0 && (
        <div className="security-empty">
          <ShieldCheck size={22} />
          <p>
            Mots de passe solides, aucun doublon détecté et pas de réutilisation. Continuez
            à utiliser des mots de passe uniques et activez la double authentification.
          </p>
        </div>
      )}

      {report.weak.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <ShieldAlert size={16} />
            Mots de passe faibles
            <span>{report.weak.length}</span>
          </h3>
          <ItemList items={report.weak} vaultNames={vaultNames} onOpen={open} />
        </section>
      )}

      {report.reused.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <Copy size={16} />
            Mots de passe réutilisés
            <span>{report.reused.reduce((total, group) => total + group.items.length, 0)}</span>
          </h3>
          <ReusedList groups={report.reused} vaultNames={vaultNames} onOpen={open} />
        </section>
      )}

      {report.old.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <Clock3 size={16} />
            Mots de passe non modifiés depuis un an
            <span>{report.old.length}</span>
          </h3>
          <ItemList items={report.old} vaultNames={vaultNames} onOpen={open} />
        </section>
      )}

      {report.no2fa.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <KeyRound size={16} />
            Sans double authentification
            <span>{report.no2fa.length}</span>
          </h3>
          <ItemList items={report.no2fa} vaultNames={vaultNames} onOpen={open} />
        </section>
      )}

      {report.duplicates.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <Link2 size={16} />
            Sites en doublon
            <span>{report.duplicates.reduce((total, group) => total + group.items.length, 0)}</span>
          </h3>
          <DuplicateList groups={report.duplicates} vaultNames={vaultNames} onOpen={open} />
        </section>
      )}
    </Modal>
  )
}
