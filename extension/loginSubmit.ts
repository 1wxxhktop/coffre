/**
 * Valide automatiquement le formulaire de connexion après un remplissage.
 *
 * Le délai laisse aux frameworks le temps de traiter les événements
 * `input`/`change` avant de cliquer sur le bouton de connexion. La fonction est
 * autonome pour pouvoir être sérialisée par `scripting.executeScript`.
 */
export function submitLoginForm(delay = 220): void {
  window.setTimeout(() => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element as HTMLElement)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }

    const password = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
    ).find(visible)
    if (!password) return

    const form = password.closest('form')
    const scope: ParentNode =
      form ??
      password.closest('section, article, main, div') ??
      document
    const controls = Array.from(
      scope.querySelectorAll<HTMLElement>(
        'button, input[type="submit"], input[type="button"], [role="button"]',
      ),
    ).filter(visible)
    const explicit = controls.find((control) => {
      if (control instanceof HTMLButtonElement) return control.type === 'submit'
      if (control instanceof HTMLInputElement) return control.type === 'submit'
      return false
    })
    const textMatch =
      /(sign in|log ?in|continue|next|submit|se connecter|connexion|continuer|suivant|valider)/i
    const control =
      explicit ??
      controls.find((candidate) =>
        textMatch.test(
          `${candidate.textContent ?? ''} ${
            candidate instanceof HTMLInputElement ? candidate.value : ''
          }`.trim(),
        ),
      )

    if (
      control &&
      !(control instanceof HTMLButtonElement && control.disabled) &&
      !(control instanceof HTMLInputElement && control.disabled)
    ) {
      control.click()
      return
    }

    if (form) {
      try {
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit()
        } else {
          form.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          )
        }
        return
      } catch {
        // Repli sur la touche Entrée ci-dessous.
      }
    }

    password.focus()
    for (const type of ['keydown', 'keypress', 'keyup']) {
      password.dispatchEvent(
        new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }),
      )
    }
  }, Math.max(0, delay))
}
