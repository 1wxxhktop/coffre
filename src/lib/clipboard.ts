/**
 * Presse-papiers avec effacement automatique.
 *
 * Desktop (Tauri) : la copie et l’effacement passent par des commandes natives.
 * Le secret est marqué pour être ignoré par les historiques de presse-papiers,
 * et l’effacement différé fonctionne sans geste de l’utilisateur.
 *
 * Web : l’effacement n’a lieu que si le contenu est toujours celui copié par
 * Coffre. Si le navigateur refuse la lecture (Safari, Chromium sans
 * permission), le presse-papiers est vidé quand la page a le focus : un
 * secret ne doit pas y rester indéfiniment. Sans focus, le navigateur refuse
 * aussi l’écriture et l’effacement n’est pas possible.
 */

import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './external'

let clearTimer: ReturnType<typeof setTimeout> | null = null
let lastCopied: string | null = null

async function webCopy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // On tente le repli ci-dessous (permissions refusées, contexte non sécurisé…)
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    const success = document.execCommand('copy')
    textarea.remove()
    return success
  } catch {
    return false
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      await invoke('clipboard_copy_secret', { text })
      return true
    } catch {
      // Repli sur l’API Web si la commande native échoue.
    }
  }
  return webCopy(text)
}

/**
 * Efface le presse-papiers s’il contient encore `expected`. Renvoie vrai si
 * l’effacement a eu lieu (ou a été tenté faute de pouvoir lire).
 */
export async function clearClipboardIfMatches(expected: string): Promise<boolean> {
  if (!expected) return false

  if (isTauriRuntime()) {
    try {
      return await invoke<boolean>('clipboard_clear_if', { expected })
    } catch {
      // Repli sur l’API Web ci-dessous.
    }
  }

  if (!navigator.clipboard) return false
  try {
    const current = await navigator.clipboard.readText()
    if (current !== expected) return false
    await navigator.clipboard.writeText('')
    return true
  } catch {
    // Lecture refusée : on vide quand même si la page a le focus, seul cas où
    // le navigateur autorise l’écriture sans geste.
  }
  try {
    if (typeof document !== 'undefined' && document.hasFocus()) {
      await navigator.clipboard.writeText('')
      return true
    }
  } catch {
    // Écriture refusée : rien d’autre à tenter.
  }
  return false
}

export function scheduleClipboardClear(
  expected: string,
  seconds: number,
  onCleared?: () => void,
): void {
  if (clearTimer) clearTimeout(clearTimer)
  if (!seconds || seconds <= 0) return

  clearTimer = setTimeout(async () => {
    clearTimer = null
    if (lastCopied === expected) lastCopied = null
    if (await clearClipboardIfMatches(expected)) onCleared?.()
  }, seconds * 1000)
}

export async function copySensitive(
  text: string,
  clearSeconds: number,
  onCleared?: () => void,
): Promise<boolean> {
  const success = await copyToClipboard(text)
  if (success) {
    lastCopied = text
    scheduleClipboardClear(text, clearSeconds, onCleared)
  }
  return success
}

/**
 * Efface immédiatement le presse-papiers au verrouillage, si son contenu est
 * toujours celui copié par Coffre.
 */
export async function clearClipboardIfLastCopied(): Promise<void> {
  const expected = lastCopied
  if (!expected) return
  lastCopied = null
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  await clearClipboardIfMatches(expected)
}
