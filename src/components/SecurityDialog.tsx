import { useMemo } from 'react'
import {
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  KeyRound,
  Link2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { Modal } from './Modal'
import {
  incompleteReason,
  securityTone,
  weakPasswordReason,
  type DuplicateUrlGroup,
  type ReusedPasswordGroup,
  type SecurityReport,
  type SimilarPasswordGroup,
} from '../lib/security'
import {
  itemSubtitle,
  type LoginItem,
  type VaultItem,
  type VaultSummary,
} from '../lib/types'

interface SecurityDialogProps {
  report: SecurityReport
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
  detail,
  onOpen,
}: {
  item: VaultItem
  vaultName: string
  detail?: string
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
          {detail ? ` · ${detail}` : ''}
        </span>
      </span>
      <ChevronRight size={16} className="security-item__chevron" aria-hidden="true" />
    </button>
  )
}

function ItemList({
  items,
  vaultNames,
  detailFor,
  onOpen,
}: {
  items: VaultItem[]
  vaultNames: Map<string, string>
  detailFor?: (item: VaultItem) => string | undefined
  onOpen: (itemId: string) => void
}) {
  return (
    <div className="security-list">
      {items.map((item) => (
        <ItemButton
          key={item.id}
          item={item}
          vaultName={vaultNames.get(item.vaultId) ?? 'Coffre'}
          detail={detailFor?.(item)}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

function GroupList({
  groups,
  vaultNames,
  label,
  icon,
  onOpen,
}: {
  groups: Array<ReusedPasswordGroup | SimilarPasswordGroup>
  vaultNames: Map<string, string>
  label: (count: number) => string
  icon: 'copy' | 'key'
  onOpen: (itemId: string) => void
}) {
  const Icon = icon === 'copy' ? Copy : KeyRound
  return (
    <div className="security-list">
      {groups.map((group) => (
        <div key={group.items.map((item) => item.id).join('-')} className="security-group">
          <p className="security-group__label">
            <Icon size={13} />
            {label(group.items.length)}
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

export function SecurityDialog({ report, vaults, onClose, onOpenItem }: SecurityDialogProps) {
  const vaultNames = useVaultNames(vaults)
  const tone = securityTone(report.score)

  const reusedCount = report.reused.reduce((total, group) => total + group.items.length, 0)
  const similarCount = report.similar.reduce((total, group) => total + group.items.length, 0)
  const duplicateCount = report.duplicates.reduce(
    (total, group) => total + group.items.length,
    0,
  )

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
                ? 'Excellent — aucun problème détecté'
                : `${report.scoreLabel} · ${report.affected} élément${
                    report.affected > 1 ? 's' : ''
                  } à revoir`}
          </strong>
          <p>
            {report.total === 0
              ? 'Ajoutez une connexion pour commencer l’analyse.'
              : `${report.total - report.affected}/${report.total} connexion${
                  report.total > 1 ? 's' : ''
                } sans problème · ${report.strongCount} solide${
                  report.strongCount > 1 ? 's' : ''
                }, ${report.mediumCount} moyenne${report.mediumCount > 1 ? 's' : ''}, ${
                  report.weak.length
                } faible${report.weak.length > 1 ? 's' : ''}.`}
          </p>
          {report.total > 0 && (
            <>
              <div
                className="security-distribution"
                role="img"
                aria-label={`${report.strongCount} mots de passe solides, ${report.mediumCount} moyens, ${report.weak.length} faibles`}
              >
                <span
                  className="security-distribution__strong"
                  style={{ flex: Math.max(report.strongCount, 0.001) }}
                />
                <span
                  className="security-distribution__medium"
                  style={{ flex: Math.max(report.mediumCount, 0.001) }}
                />
                <span
                  className="security-distribution__weak"
                  style={{ flex: Math.max(report.weak.length, 0.001) }}
                />
              </div>
              <div className="security-distribution__legend">
                <span>
                  <i className="security-dot security-dot--strong" /> Solides
                </span>
                <span>
                  <i className="security-dot security-dot--medium" /> Moyens
                </span>
                <span>
                  <i className="security-dot security-dot--weak" /> Faibles
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {report.affected === 0 && report.total > 0 && (
        <div className="security-empty">
          <ShieldCheck size={22} />
          <p>
            Mots de passe solides, aucun doublon, aucune réutilisation et pas de connexion
            incomplète. Continuez à utiliser des mots de passe uniques et la double
            authentification.
          </p>
        </div>
      )}

      {report.total > 0 && (
        <div className="security-summary" aria-label="Résumé des problèmes">
          <div>
            <strong>{report.weak.length}</strong>
            <span>Faibles</span>
          </div>
          <div>
            <strong>{reusedCount}</strong>
            <span>Réutilisés</span>
          </div>
          <div>
            <strong>{similarCount}</strong>
            <span>Variantes</span>
          </div>
          <div>
            <strong>{report.no2fa.length}</strong>
            <span>Sans 2FA</span>
          </div>
          <div>
            <strong>{report.old.length}</strong>
            <span>Anciens</span>
          </div>
          <div>
            <strong>{report.incomplete.length}</strong>
            <span>Incomplets</span>
          </div>
          <div>
            <strong>{duplicateCount}</strong>
            <span>Doublons</span>
          </div>
        </div>
      )}

      {report.weak.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <ShieldAlert size={16} />
            Mots de passe faibles
            <span>{report.weak.length}</span>
          </h3>
          <p className="security-section__hint">
            Utilisez le générateur de Coffre pour créer un mot de passe long et unique.
          </p>
          <ItemList
            items={report.weak}
            vaultNames={vaultNames}
            detailFor={(item) => weakPasswordReason(item as LoginItem) ?? undefined}
            onOpen={onOpenItem}
          />
        </section>
      )}

      {report.reused.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <Copy size={16} />
            Mots de passe réutilisés
            <span>{reusedCount}</span>
          </h3>
          <p className="security-section__hint">
            Un mot de passe compromis sur un site ne doit pas ouvrir les autres.
          </p>
          <GroupList
            groups={report.reused}
            vaultNames={vaultNames}
            label={(count) => `Mot de passe partagé par ${count} éléments`}
            icon="copy"
            onOpen={onOpenItem}
          />
        </section>
      )}

      {report.similar.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <KeyRound size={16} />
            Variantes proches
            <span>{similarCount}</span>
          </h3>
          <p className="security-section__hint">
            Des mots de passe qui ne diffèrent que par quelques chiffres ou symboles sont
            faciles à deviner ensemble.
          </p>
          <GroupList
            groups={report.similar}
            vaultNames={vaultNames}
            label={(count) => `Variantes partagées par ${count} éléments`}
            icon="key"
            onOpen={onOpenItem}
          />
        </section>
      )}

      {report.no2fa.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <KeyRound size={16} />
            Sans double authentification
            <span>{report.no2fa.length}</span>
          </h3>
          <p className="security-section__hint">
            Ajoutez un code TOTP pour protéger le compte même si le mot de passe fuit.
          </p>
          <ItemList
            items={report.no2fa}
            vaultNames={vaultNames}
            detailFor={() => 'Aucun code TOTP configuré'}
            onOpen={onOpenItem}
          />
        </section>
      )}

      {report.incomplete.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <CircleHelp size={16} />
            Connexions incomplètes
            <span>{report.incomplete.length}</span>
          </h3>
          <p className="security-section__hint">
            Complétez les champs manquants pour que le remplissage et l’analyse soient
            fiables.
          </p>
          <ItemList
            items={report.incomplete}
            vaultNames={vaultNames}
            detailFor={(item) => incompleteReason(item as LoginItem)}
            onOpen={onOpenItem}
          />
        </section>
      )}

      {report.old.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <Clock3 size={16} />
            Non modifiés depuis un an
            <span>{report.old.length}</span>
          </h3>
          <p className="security-section__hint">
            Vérifiez ces comptes et changez le mot de passe s’il a été exposé.
          </p>
          <ItemList
            items={report.old}
            vaultNames={vaultNames}
            detailFor={() => 'Dernière modification > 1 an'}
            onOpen={onOpenItem}
          />
        </section>
      )}

      {report.duplicates.length > 0 && (
        <section className="security-section">
          <h3 className="security-section__title">
            <Link2 size={16} />
            Sites en doublon
            <span>{duplicateCount}</span>
          </h3>
          <p className="security-section__hint">
            Vérifiez s’il s’agit de comptes distincts ou d’éléments à fusionner.
          </p>
          <DuplicateList groups={report.duplicates} vaultNames={vaultNames} onOpen={onOpenItem} />
        </section>
      )}

      <p className="security-footnote">
        Analyse effectuée localement sur les connexions actives. Les notes, cartes,
        identités, pièces jointes et éléments en corbeille ne sont pas inclus.
      </p>
    </Modal>
  )
}
