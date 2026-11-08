/**
 * Notifications locales d’échéance.
 *
 * Aucun serveur de notification : le navigateur ou le système affiche le
 * rappel, et l’application ne conserve qu’une trace locale des éléments déjà
 * signalés pour éviter les répétitions. Rien n’est envoyé sur le réseau.
 */

import {
  expiryDescription,
  type ExpiryEvent,
} from './expiry'

const NOTIFIED_KEY = 'coffre:expiry-notified:v1'
const KEEP_DAYS = 90

type NotifiedRecord = Record<string, string>

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function dateStamp(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function notificationKey(event: ExpiryEvent): string {
  return `${event.item.id}:${event.kind}:${event.date}`
}

function loadRecord(): NotifiedRecord {
  const store = storage()
  if (!store) return {}
  try {
    const raw = store.getItem(NOTIFIED_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const cutoff = dateStamp(new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000))
    const record: NotifiedRecord = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value >= cutoff) record[key] = value
    }
    return record
  } catch {
    return {}
  }
}

function saveRecord(record: NotifiedRecord): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(NOTIFIED_KEY, JSON.stringify(record))
  } catch {
    // Le stockage local peut être indisponible ; le rappel reste ponctuel.
  }
}

/** Vérifie si les notifications système sont disponibles dans cet environnement. */
export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** Demande l’autorisation, à appeler depuis une action explicite de l’utilisateur. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

/** Échéances qui n’ont pas encore été signalées aujourd’hui. */
export function dueExpiryNotifications(
  events: ExpiryEvent[],
  now: Date = new Date(),
): ExpiryEvent[] {
  const today = dateStamp(now)
  const record = loadRecord()
  return events.filter((event) => record[notificationKey(event)] !== today)
}

/** Marque des échéances comme signalées pour la journée en cours. */
export function markExpiryNotified(events: ExpiryEvent[], now: Date = new Date()): void {
  const today = dateStamp(now)
  const record = loadRecord()
  for (const event of events) record[notificationKey(event)] = today
  saveRecord(record)
}

/**
 * Affiche une notification système regroupée pour les échéances du jour.
 * Retourne les événements effectivement signalés ; aucun marquage n’a lieu si
 * les notifications ne sont pas autorisées ou si l’API échoue.
 */
export function notifyExpiringItems(
  events: ExpiryEvent[],
  now: Date = new Date(),
): ExpiryEvent[] {
  const due = dueExpiryNotifications(events, now)
  if (due.length === 0) return []
  if (!notificationsSupported() || Notification.permission !== 'granted') return []

  const preview = due.slice(0, 3).map(
    (event) => `${event.item.title} — ${expiryDescription(event.daysLeft)}`,
  )
  if (due.length > preview.length) {
    preview.push(`et ${due.length - preview.length} autre${due.length - preview.length > 1 ? 's' : ''}`)
  }

  try {
    new Notification(
      due.length === 1 ? 'Coffre — échéance proche' : `Coffre — ${due.length} échéances proches`,
      {
        body: preview.join('\n'),
        tag: 'coffre-expiry',
        silent: false,
      },
    )
  } catch {
    return []
  }

  markExpiryNotified(due, now)
  return due
}
