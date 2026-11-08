/**
 * Détection des formulaires de connexion.
 *
 * Aucun sélecteur spécifique à un site : uniquement des heuristiques sur les
 * types, attributs `autocomplete`, noms, libellés et positions. Le module est
 * partagé par le content script et les tests de corpus.
 */

export interface DetectedLoginFields {
  form: HTMLFormElement | null
  username: HTMLInputElement | null
  password: HTMLInputElement | null
  otp: HTMLInputElement | null
}

const USERNAME_PATTERN =
  /(user|email|login|ident|account|mail|phone|tel|handle)/i
const OTP_PATTERN = /(otp|totp|one[-_ ]?time|2fa|mfa|two[-_ ]?factor|verification|security[-_ ]?code)/i

function parseOpacity(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 1
}

/** Vrai si l’élément est réellement visible pour l’utilisateur. */
export function isVisible(element: Element): boolean {
  const view = element.ownerDocument.defaultView
  if (!view) return false
  const style = view.getComputedStyle(element)
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse' ||
    parseOpacity(style.opacity) <= 0.05
  ) {
    return false
  }
  if (element.closest('[hidden], [aria-hidden="true"]')) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function inputType(input: HTMLInputElement): string {
  return (input.getAttribute('type') ?? 'text').toLowerCase()
}

function labelText(input: HTMLInputElement): string {
  const id = input.id
  const document = input.ownerDocument
  if (id) {
    const explicit = Array.from(
      document.querySelectorAll<HTMLLabelElement>('label'),
    ).find((label) => label.htmlFor === id)
    if (explicit?.textContent) return explicit.textContent
  }
  const wrapping = input.closest('label')
  return wrapping?.textContent ?? ''
}

function descriptors(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.getAttribute('autocomplete') ?? '',
    input.getAttribute('placeholder') ?? '',
    input.getAttribute('aria-label') ?? '',
    labelText(input),
  ].join(' ')
}

function visiblePasswords(document: Document): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter(isVisible)
}

function choosePassword(
  passwords: HTMLInputElement[],
): HTMLInputElement | null {
  if (passwords.length === 0) return null
  const current = passwords.find(
    (input) =>
      (input.getAttribute('autocomplete') ?? '').toLowerCase() ===
      'current-password',
  )
  if (current) return current
  // Un formulaire avec plusieurs champs mot de passe est généralement une
  // création ou un changement de mot de passe : on ne propose pas le menu.
  const form = passwords[0].form
  if (form) {
    const inForm = passwords.filter((input) => input.form === form)
    if (inForm.length > 1) return null
  }
  return passwords[0]
}

function usernameScore(
  input: HTMLInputElement,
  password: HTMLInputElement,
): number {
  const type = inputType(input)
  const autocomplete = (input.getAttribute('autocomplete') ?? '').toLowerCase()
  const text = descriptors(input)
  let score = 0
  if (autocomplete === 'username') score += 8
  if (autocomplete === 'email') score += 7
  if (type === 'email') score += 5
  if (type === 'text' || type === '' || type === 'tel') score += 2
  if (USERNAME_PATTERN.test(text)) score += 4
  if (/mot de passe|password/i.test(text)) score -= 8

  // Position avant le champ mot de passe.
  const position = password.compareDocumentPosition(input)
  if (position & Node.DOCUMENT_POSITION_PRECEDING) score += 3

  if (input.readOnly || input.disabled) score -= 6
  if (input.value) score += 1
  return score
}

function chooseUsername(
  document: Document,
  password: HTMLInputElement,
): HTMLInputElement | null {
  const scope = password.form ?? document
  const candidates = Array.from(
    scope.querySelectorAll<HTMLInputElement>('input'),
  ).filter((input) => {
    const type = inputType(input)
    return (
      input !== password &&
      ['text', 'email', 'tel', ''].includes(type) &&
      isVisible(input) &&
      !input.readOnly
    )
  })
  let best: HTMLInputElement | null = null
  let bestScore = 0
  for (const candidate of candidates) {
    const score = usernameScore(candidate, password)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return bestScore >= 3 ? best : null
}

function chooseOtp(
  document: Document,
  password: HTMLInputElement,
): HTMLInputElement | null {
  const scope = password.form ?? document
  const candidates = Array.from(
    scope.querySelectorAll<HTMLInputElement>('input'),
  ).filter((input) => {
    if (!isVisible(input) || input.readOnly || input.disabled) return false
    const autocomplete = (input.getAttribute('autocomplete') ?? '').toLowerCase()
    return (
      autocomplete === 'one-time-code' ||
      OTP_PATTERN.test(descriptors(input)) ||
      input.inputMode === 'numeric'
    )
  })
  const exact = candidates.find(
    (input) =>
      (input.getAttribute('autocomplete') ?? '').toLowerCase() ===
      'one-time-code',
  )
  if (exact) return exact
  return (
    candidates.find((input) => OTP_PATTERN.test(descriptors(input))) ??
    candidates.find((input) => input.inputMode === 'numeric') ??
    null
  )
}

/**
 * Détecte les champs d’une page de connexion. Retourne `password: null` sur une
 * page sans formulaire de connexion, un formulaire d’inscription ou un
 * changement de mot de passe.
 */
export function detectLoginFields(document: Document): DetectedLoginFields {
  const password = choosePassword(visiblePasswords(document))
  if (!password) return { form: null, username: null, password: null, otp: null }
  return {
    form: password.form,
    username: chooseUsername(document, password),
    password,
    otp: chooseOtp(document, password),
  }
}

export interface LoginFillValues {
  username: string
  password: string
  totp?: string
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Remplit les champs détectés et renvoie le nombre de champs modifiés. */
export function fillDetectedLogin(
  fields: DetectedLoginFields,
  values: LoginFillValues,
): number {
  let filled = 0
  if (fields.username && values.username) {
    setNativeValue(fields.username, values.username)
    filled += 1
  }
  if (fields.password && values.password) {
    setNativeValue(fields.password, values.password)
    filled += 1
  }
  if (fields.otp && values.totp) {
    setNativeValue(fields.otp, values.totp)
    filled += 1
  }
  if (filled > 0) {
    ;(fields.password ?? fields.username)?.focus()
  }
  return filled
}
