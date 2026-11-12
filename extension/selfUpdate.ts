/**
 * Rechargement automatique de l’extension.
 *
 * L’application desktop tient une copie à jour de l’extension dans un dossier
 * fixe et annonce sa version à chaque échange d’état. Si cette version est plus
 * récente que celle qui tourne, l’extension se recharge : le navigateur relit
 * alors les fichiers du dossier. Aucune requête réseau n’est faite.
 *
 * Le rechargement n’est tenté qu’une fois par version. S’il ne change rien
 * (extension chargée depuis un autre dossier, ou installée depuis un magasin),
 * l’extension le note et le popup invite à la recharger depuis le bon dossier.
 */

import { selfUpdateDecision } from '../src/lib/extensionVersion'

const api = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome

export const SELF_UPDATE_STORAGE_KEY = 'coffre-self-update'
/** Laisse l’opération en cours se terminer avant de recharger. */
const RELOAD_DELAY_MS = 1500

export interface SelfUpdateState {
  /** Version pour laquelle un rechargement a déjà été tenté. */
  attempted: string
  /** Vrai si ce rechargement n’a pas suffi : action manuelle requise. */
  manual: boolean
}

let scheduled = false

export async function readSelfUpdateState(): Promise<SelfUpdateState | null> {
  try {
    const stored = await api.storage.local.get(SELF_UPDATE_STORAGE_KEY)
    const value = stored[SELF_UPDATE_STORAGE_KEY] as Partial<SelfUpdateState> | undefined
    if (value && typeof value.attempted === 'string') {
      return { attempted: value.attempted, manual: value.manual === true }
    }
  } catch {
    // Stockage indisponible : on se comporte comme sans état.
  }
  return null
}

/** À appeler avec la version annoncée par l’application desktop. */
export async function considerSelfUpdate(diskVersion: unknown): Promise<void> {
  if (scheduled || typeof diskVersion !== 'string') return
  const running = api.runtime.getManifest().version
  const state = await readSelfUpdateState()
  const decision = selfUpdateDecision(running, diskVersion, state?.attempted)

  if (decision === 'none') {
    if (state) await api.storage.local.remove(SELF_UPDATE_STORAGE_KEY).catch(() => undefined)
    return
  }
  if (decision === 'manual') {
    if (!state?.manual) {
      await api.storage.local
        .set({ [SELF_UPDATE_STORAGE_KEY]: { attempted: diskVersion, manual: true } })
        .catch(() => undefined)
    }
    return
  }

  scheduled = true
  try {
    await api.storage.local.set({
      [SELF_UPDATE_STORAGE_KEY]: { attempted: diskVersion, manual: false },
    })
  } catch {
    // Sans mémoire de la tentative, on ne recharge pas : risque de boucle.
    scheduled = false
    return
  }
  setTimeout(() => api.runtime.reload(), RELOAD_DELAY_MS)
}
