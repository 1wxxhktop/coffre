import { useEffect, useRef } from 'react'

/**
 * Verrouille automatiquement le coffre après une période d’inactivité et,
 * si l’option est active, dès que l’onglet passe en arrière-plan.
 *
 * L’horodatage de la dernière activité reste en mémoire. Au retour dans
 * l’onglet, on vérifie aussi le temps passé hors écran : les minuteurs des
 * navigateurs peuvent être ralentis en arrière-plan.
 */
export function useAutoLock(
  minutes: number,
  lockOnHide: boolean,
  onLock: () => void,
): void {
  const onLockRef = useRef(onLock)

  useEffect(() => {
    onLockRef.current = onLock
  }, [onLock])

  useEffect(() => {
    let lastActivity = Date.now()
    let hiddenAt: number | null = null
    const timeout = minutes > 0 ? minutes * 60_000 : 0

    const lock = () => onLockRef.current()

    const touch = () => {
      lastActivity = Date.now()
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (lockOnHide) {
          lock()
          return
        }
        hiddenAt = Date.now()
        return
      }

      if (hiddenAt !== null) {
        const awayFor = Date.now() - hiddenAt
        hiddenAt = null
        if (timeout > 0 && (awayFor >= timeout || Date.now() - lastActivity >= timeout)) {
          lock()
          return
        }
      }

      lastActivity = Date.now()
    }

    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'pointermove',
      'keydown',
      'wheel',
      'touchstart',
      'focus',
    ]

    for (const event of events) {
      window.addEventListener(event, touch, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    // La fermeture de page (`pagehide`) est gérée par VaultProvider : elle
    // verrouille sans retirer la clé du déverrouillage rapide.

    const interval =
      timeout > 0
        ? window.setInterval(() => {
            if (Date.now() - lastActivity >= timeout) {
              lock()
            }
          }, 5_000)
        : null

    return () => {
      for (const event of events) window.removeEventListener(event, touch)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [minutes, lockOnHide])
}
