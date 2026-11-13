/**
 * Assistant d’installation de l’extension navigateur.
 *
 * L’état est local et sans secret : il mémorise seulement si l’assistant a été
 * terminé, reporté, ou rendu obligatoire après la création d’un coffre.
 */

export type ExtensionOnboardingState = 'pending' | 'dismissed' | 'done' | null

const STORAGE_KEY = 'coffre:onboarding:extension:v1'

function read(): ExtensionOnboardingState {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'pending' || value === 'dismissed' || value === 'done') {
      return value
    }
  } catch {
    // Stockage indisponible : l’assistant reste utilisable pour la session.
  }
  return null
}

function write(value: 'pending' | 'dismissed' | 'done'): void {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Le stockage local peut être refusé ; on ne bloque jamais l’application.
  }
}

export function extensionOnboardingState(): ExtensionOnboardingState {
  return read()
}

/** Après la création d’un coffre : l’assistant repasse au premier plan. */
export function markExtensionOnboardingPending(): void {
  write('pending')
}

/** L’utilisateur a terminé l’assistant ou l’extension est déjà associée. */
export function completeExtensionOnboarding(): void {
  write('done')
}

/** L’utilisateur a choisi « Plus tard ». */
export function dismissExtensionOnboarding(): void {
  write('dismissed')
}

/**
 * Faut-il ouvrir l’assistant ?
 *
 * Il est masqué si l’extension est déjà associée, si le build ne l’embarque pas
 * ou si l’utilisateur a terminé/reporté l’étape. L’état `pending` force
 * l’ouverture après la création d’un coffre.
 */
export function shouldShowExtensionOnboarding(input: {
  available: boolean
  paired: boolean
  state: ExtensionOnboardingState
}): boolean {
  if (!input.available || input.paired) return false
  if (input.state === 'done' || input.state === 'dismissed') return false
  return true
}
