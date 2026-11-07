/**
 * Presse-papiers avec effacement automatique.
 * L’effacement n’a lieu que si le contenu est toujours celui copié par Coffre.
 */

let clearTimer: ReturnType<typeof setTimeout> | null = null
let lastCopied: string | null = null

export async function copyToClipboard(text: string): Promise<boolean> {
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

export function scheduleClipboardClear(
  expected: string,
  seconds: number,
  onCleared?: () => void,
): void {
  if (clearTimer) clearTimeout(clearTimer)
  if (!seconds || seconds <= 0) return

  clearTimer = setTimeout(async () => {
    clearTimer = null
    lastCopied = null
    try {
      if (!navigator.clipboard?.readText) return
      const current = await navigator.clipboard.readText()
      if (current === expected) {
        await navigator.clipboard.writeText('')
        onCleared?.()
      }
    } catch {
      // La lecture du presse-papiers peut être refusée : on ne fait rien.
    }
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
 * toujours celui copié par Coffre. Lecture au mieux : le navigateur peut
 * refuser l’accès.
 */
export async function clearClipboardIfLastCopied(): Promise<void> {
  const expected = lastCopied
  if (!expected) return
  lastCopied = null
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  try {
    if (!navigator.clipboard?.readText) return
    const current = await navigator.clipboard.readText()
    if (current === expected) await navigator.clipboard.writeText('')
  } catch {
    // Rien à faire : l’effacement est au mieux.
  }
}
