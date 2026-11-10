/**
 * Vue non sensible d’une proposition d’enregistrement pour l’iframe du
 * bandeau. Le mot de passe et les autres champs du secret ne quittent jamais le
 * service worker : le bandeau ne reçoit qu’un identifiant opaque et des
 * métadonnées d’affichage.
 */

import type { ExtensionAutofillKind } from '../src/lib/extensionProtocol'
import type { StoredPendingSave } from './sessionState'

export interface SaveBannerView {
  offerId: string
  host: string
  label: string
  detail: string
  kind: ExtensionAutofillKind
  update: boolean
  /** Signal anti-hameçonnage (Q1) : l’enregistrement demande une confirmation. */
  risk?: 'phishing'
}

export function saveBannerView(
  pending: StoredPendingSave,
): SaveBannerView | null {
  if (!pending.id || !pending.host) return null
  return {
    offerId: pending.id,
    host: pending.host,
    label: pending.label,
    detail: pending.detail,
    kind: pending.kind,
    update: pending.update === true,
    ...(pending.phishing && pending.phishing.signals.length > 0
      ? { risk: 'phishing' as const }
      : {}),
  }
}

export function saveBannerTitleKey(view: SaveBannerView): string {
  if (view.kind === 'card') return 'saveBanner_titleCard'
  if (view.kind === 'identity') return 'saveBanner_titleIdentity'
  return view.update ? 'saveBanner_titleUpdate' : 'saveBanner_titleLogin'
}

export function saveBannerSubject(view: SaveBannerView): string {
  if (view.kind === 'login' && view.update && view.label) return view.label
  return view.host
}
