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

/** Champs d’un formulaire d’inscription ou de changement de mot de passe. */
export interface DetectedSignupFields {
  form: HTMLFormElement | null
  username: HTMLInputElement | null
  password: HTMLInputElement
  confirm: HTMLInputElement | null
}

const USERNAME_PATTERN =
  /(user|email|login|ident|account|mail|phone|tel|handle)/i
const OTP_PATTERN = /(otp|totp|one[-_ ]?time|2fa|mfa|two[-_ ]?factor|verification|security[-_ ]?code)/i
// « Mot de passe oublié » et « Sign up » apparaissent très souvent comme liens
// dans un formulaire de connexion : ils ne comptent pas comme contexte
// d’inscription, et les liens sont exclus du texte analysé.
const SIGNUP_CONTEXT_PATTERN =
  /(sign ?up|register|registration|create.{0,24}account|inscription|inscrire|cr[ée]er.{0,24}compte|new password|nouveau mot de passe|change.{0,24}password|changer.{0,24}mot de passe)/i
const LOGIN_ACTION_PATTERN =
  /(log ?in|sign ?in|se connecter|connexion|identifier|s’identifier|s'identifier)/i
const NEW_PASSWORD_PATTERN =
  /(new.?password|nouveau mot de passe|choose.?password|choisir.{0,12}mot de passe|cr[ée]er.{0,12}mot de passe)/i
const CONFIRM_PASSWORD_PATTERN =
  /(confirm|repeat|again|verification|v[ée]rification|confirmer|r[ée]p[ée]ter)/i

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

/**
 * Détecte un formulaire d’inscription ou de changement de mot de passe.
 *
 * Un simple formulaire de connexion avec `current-password` n’est jamais
 * retenu. Les signaux acceptés sont `autocomplete="new-password"`, un second
 * champ de mot de passe, ou un formulaire dont le texte indique explicitement
 * une création de compte (avec un identifiant et sans `current-password`).
 */
export function detectSignupFields(
  document: Document,
): DetectedSignupFields | null {
  const passwords = visiblePasswords(document)
  if (passwords.length === 0) return null
  const form = passwords[0].form
  const scoped = passwords.filter((input) => input.form === form)
  if (scoped.length === 0) return null

  const autocomplete = (input: HTMLInputElement): string =>
    (input.getAttribute('autocomplete') ?? '').toLowerCase()
  const isCurrent = (input: HTMLInputElement): boolean =>
    autocomplete(input) === 'current-password'
  const explicitNew = scoped.find(
    (input) =>
      autocomplete(input) === 'new-password' ||
      NEW_PASSWORD_PATTERN.test(descriptors(input)),
  )
  const current = scoped.filter(isCurrent)
  // Le champ du mot de passe actuel n’est jamais rempli avec un mot de passe
  // généré. Sans aucun indice, un formulaire à trois champs ou plus est un
  // changement de mot de passe : le premier champ est l’actuel.
  let pool = scoped.filter((input) => !isCurrent(input))
  if (!explicitNew && current.length === 0 && scoped.length >= 3) {
    pool = scoped.slice(1)
  }
  if (pool.length === 0) return null

  const primary = explicitNew ?? pool[0]
  const hasUsername = chooseUsername(document, primary) !== null
  const context = signupContext(form)

  if (
    !explicitNew &&
    pool.length < 2 &&
    !(
      SIGNUP_CONTEXT_PATTERN.test(context.text) &&
      !LOGIN_ACTION_PATTERN.test(context.actions) &&
      hasUsername &&
      current.length === 0
    )
  ) {
    return null
  }
  const others = pool.filter((input) => input !== primary)
  const confirm =
    others.find(
      (input) =>
        autocomplete(input) === 'new-password' ||
        CONFIRM_PASSWORD_PATTERN.test(descriptors(input)),
    ) ??
    others[0] ??
    null

  return {
    form,
    username: chooseUsername(document, primary),
    password: primary,
    confirm,
  }
}

/**
 * Texte qui décrit l’intention d’un formulaire : attributs, titres, légende et
 * boutons d’envoi. Les liens (« Mot de passe oublié ? », « Créer un compte »)
 * sont volontairement exclus, car ils accompagnent souvent une connexion.
 */
function signupContext(form: HTMLFormElement | null): {
  text: string
  actions: string
} {
  if (!form) return { text: '', actions: '' }
  const attributes = [
    form.id,
    form.getAttribute('name') ?? '',
    form.getAttribute('action') ?? '',
    form.getAttribute('aria-label') ?? '',
    form.className,
  ].join(' ')
  const headings = Array.from(
    form.querySelectorAll('h1, h2, h3, legend'),
  )
    .map((element) => element.textContent ?? '')
    .join(' ')
  const actions = Array.from(
    form.querySelectorAll(
      'button, input[type="submit"], input[type="button"], [role="button"]',
    ),
  )
    .filter((element) => !element.closest('a'))
    .map((element) =>
      element instanceof HTMLInputElement
        ? element.value
        : (element.textContent ?? ''),
    )
    .join(' ')
  return {
    text: `${attributes} ${headings} ${actions}`,
    actions,
  }
}

/** Remplit le champ nouveau mot de passe et sa confirmation. */
export function fillSignupPasswords(
  fields: DetectedSignupFields,
  password: string,
): number {
  if (!password) return 0
  let filled = 0
  setNativeValue(fields.password, password)
  filled += 1
  if (fields.confirm) {
    setNativeValue(fields.confirm, password)
    filled += 1
  }
  fields.password.focus()
  return filled
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

/**
 * Remplit le champ de mot de passe actif (ou le premier champ visible).
 * Utilisé par le raccourci « générer un mot de passe », y compris sur les
 * formulaires d’inscription à plusieurs champs.
 */
export function fillPasswordField(document: Document, value: string): number {
  if (!value) return 0
  const active = document.activeElement
  if (
    active instanceof HTMLInputElement &&
    active.type === 'password' &&
    isVisible(active)
  ) {
    setNativeValue(active, value)
    active.focus()
    return 1
  }
  const detected = detectLoginFields(document)
  const fallback = visiblePasswords(document)[0]
  const input = detected.password ?? fallback
  if (!input) return 0
  setNativeValue(input, value)
  input.focus()
  return 1
}

/** Remplit le champ TOTP actif ou détecté. */
export function fillOtpField(document: Document, value: string): number {
  if (!value) return 0
  const active = document.activeElement
  if (
    active instanceof HTMLInputElement &&
    isVisible(active) &&
    (active.getAttribute('autocomplete') === 'one-time-code' ||
      OTP_PATTERN.test(descriptors(active)))
  ) {
    setNativeValue(active, value)
    active.focus()
    return 1
  }
  const detected = detectLoginFields(document).otp
  const fallback = Array.from(
    document.querySelectorAll<HTMLInputElement>('input'),
  ).find(
    (input) =>
      isVisible(input) &&
      !input.disabled &&
      !input.readOnly &&
      (input.getAttribute('autocomplete') === 'one-time-code' ||
        OTP_PATTERN.test(descriptors(input))),
  )
  const input = detected ?? fallback
  if (!input) return 0
  setNativeValue(input, value)
  input.focus()
  return 1
}

/* ------------------------------------------------------------------ */
/* Cartes bancaires et identités                                       */
/* ------------------------------------------------------------------ */

export interface DetectedCardFields {
  form: HTMLFormElement | null
  cardholder: HTMLInputElement | null
  number: HTMLInputElement | null
  expiry: HTMLInputElement | null
  expiryMonth: HTMLInputElement | null
  expiryYear: HTMLInputElement | null
  cvc: HTMLInputElement | null
  pin: HTMLInputElement | null
  brand: HTMLInputElement | null
}

export interface DetectedIdentityFields {
  form: HTMLFormElement | null
  fullName: HTMLInputElement | null
  firstName: HTMLInputElement | null
  lastName: HTMLInputElement | null
  email: HTMLInputElement | null
  phone: HTMLInputElement | null
  address: HTMLInputElement | null
  city: HTMLInputElement | null
  postalCode: HTMLInputElement | null
  country: HTMLInputElement | null
}

export type DetectedAutofill =
  | { kind: 'login'; login: DetectedLoginFields; anchor: HTMLInputElement }
  | { kind: 'signup'; signup: DetectedSignupFields; anchor: HTMLInputElement }
  | { kind: 'card'; card: DetectedCardFields; anchor: HTMLInputElement }
  | { kind: 'identity'; identity: DetectedIdentityFields; anchor: HTMLInputElement }

export interface CardFillValues {
  cardholder: string
  number: string
  expiry: string
  cvc: string
  pin: string
  brand: string
}

export interface IdentityFillValues {
  fullName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  address: string
  city: string
  postalCode: string
  country: string
}

/** Hôtes de prestataires de paiement autorisés dans une iframe tierce. */
const PAYMENT_PROVIDER_HOSTS = [
  'stripe.com',
  'stripe.network',
  'adyen.com',
  'paypal.com',
  'paypalobjects.com',
  'braintreepayments.com',
  'braintreegateway.com',
  'checkout.com',
  'worldpay.com',
  'klarna.com',
  'mollie.com',
  'squareup.com',
  'authorize.net',
  'cybersource.com',
  '2checkout.com',
  'payplug.com',
  'systempay.com',
  'ingenico.com',
  'ogone.com',
  'hipay.com',
  'mangopay.com',
  'lyra.com',
  'payzen.eu',
]

export function isPaymentProviderHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^www\./, '')
  if (!normalized) return false
  return PAYMENT_PROVIDER_HOSTS.some(
    (provider) => normalized === provider || normalized.endsWith(`.${provider}`),
  )
}

/**
 * Une carte ne peut être remplie que sur HTTPS, et dans une iframe tierce
 * uniquement si elle appartient à un prestataire de paiement connu.
 */
export function canFillCard(
  protocol: string,
  crossOriginFrame: boolean,
  host: string,
): boolean {
  if (protocol !== 'https:') return false
  if (!crossOriginFrame) return true
  return isPaymentProviderHost(host)
}

function autocompleteTokens(input: HTMLInputElement): string[] {
  return (input.getAttribute('autocomplete') ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

function hasAutocomplete(input: HTMLInputElement, ...values: string[]): boolean {
  const tokens = autocompleteTokens(input)
  return values.some((value) => tokens.includes(value))
}

function textMatch(input: HTMLInputElement, pattern: RegExp): boolean {
  return pattern.test(descriptors(input))
}

interface FieldCandidate<T extends string> {
  field: T
  input: HTMLInputElement
  score: number
  form: HTMLFormElement | null
}

function visibleInputs(document: Document): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(
    (input) => isVisible(input) && !input.disabled && !input.readOnly,
  )
}

function bestCandidates<T extends string>(
  document: Document,
  specs: Array<{ field: T; score: (input: HTMLInputElement) => number }>,
): FieldCandidate<T>[] {
  const inputs = visibleInputs(document)
  const result: FieldCandidate<T>[] = []
  const used = new Set<HTMLInputElement>()
  for (const spec of specs) {
    let best: FieldCandidate<T> | null = null
    for (const input of inputs) {
      if (used.has(input)) continue
      const score = spec.score(input)
      if (score <= 0) continue
      if (!best || score > best.score) {
        best = { field: spec.field, input, score, form: input.form }
      }
    }
    if (best) {
      used.add(best.input)
      result.push(best)
    }
  }
  return result
}

function byField<T extends string>(
  candidates: FieldCandidate<T>[],
  field: T,
): HTMLInputElement | null {
  return candidates.find((candidate) => candidate.field === field)?.input ?? null
}

function dominantForm(
  candidates: Array<{ form: HTMLFormElement | null }>,
): HTMLFormElement | null {
  const counts = new Map<HTMLFormElement, number>()
  for (const candidate of candidates) {
    if (!candidate.form) continue
    counts.set(candidate.form, (counts.get(candidate.form) ?? 0) + 1)
  }
  let best: HTMLFormElement | null = null
  let bestCount = 0
  for (const [form, count] of counts) {
    if (count > bestCount) {
      best = form
      bestCount = count
    }
  }
  return best
}

/** Détecte un formulaire de carte bancaire. */
export function detectCardFields(document: Document): DetectedCardFields | null {
  const candidates = bestCandidates(document, [
    {
      field: 'number',
      score: (input) =>
        (hasAutocomplete(input, 'cc-number') ? 12 : 0) +
        (textMatch(input, /card.?number|num[ée]ro de carte|num[ée]ro carte|cc-number|\bpan\b/i)
          ? 5
          : 0) +
        (input.inputMode === 'numeric' ? 1 : 0),
    },
    {
      field: 'expiry',
      score: (input) => {
        if (hasAutocomplete(input, 'cc-exp-month', 'cc-exp-year')) return 0
        if (textMatch(input, /mois|month|ann[ée]e|year/i)) return 0
        return (
          (hasAutocomplete(input, 'cc-exp') ? 12 : 0) +
          (textMatch(input, /expir|expiry|exp\.?\s*date|date d.expiration|mm\s*[/.-]\s*yy/i)
            ? 5
            : 0)
        )
      },
    },
    {
      field: 'expiryMonth',
      score: (input) =>
        (hasAutocomplete(input, 'cc-exp-month') ? 12 : 0) +
        (textMatch(input, /exp.*month|mois d.expiration|mois/i) ? 3 : 0),
    },
    {
      field: 'expiryYear',
      score: (input) =>
        (hasAutocomplete(input, 'cc-exp-year') ? 12 : 0) +
        (textMatch(input, /exp.*year|ann[ée]e d.expiration|ann[ée]e/i) ? 3 : 0),
    },
    {
      field: 'cvc',
      score: (input) =>
        (hasAutocomplete(input, 'cc-csc') ? 12 : 0) +
        (textMatch(input, /cvc|cvv|csc|security.?code|code de s[ée]curit[ée]/i)
          ? 6
          : 0),
    },
    {
      field: 'cardholder',
      score: (input) =>
        (hasAutocomplete(input, 'cc-name') ? 12 : 0) +
        (textMatch(input, /card.?holder|titulaire|name on card|nom sur la carte/i)
          ? 6
          : 0),
    },
    {
      field: 'pin',
      score: (input) =>
        (hasAutocomplete(input, 'cc-pin') ? 12 : 0) +
        (textMatch(input, /card.?pin|code pin|\bpin\b/i) ? 5 : 0),
    },
    {
      field: 'brand',
      score: (input) =>
        (hasAutocomplete(input, 'cc-type') ? 12 : 0) +
        (textMatch(input, /card.?type|card.?brand|r[ée]seau|brand/i) ? 4 : 0),
    },
  ])

  const cardForm = dominantForm(candidates)
  if (cardForm && visiblePasswords(document).some((input) => input.form === cardForm)) {
    return null
  }
  const number = byField(candidates, 'number')
  const expiry = byField(candidates, 'expiry')
  const expiryMonth = byField(candidates, 'expiryMonth')
  const expiryYear = byField(candidates, 'expiryYear')
  const cvc = byField(candidates, 'cvc')
  const cardholder = byField(candidates, 'cardholder')
  const pin = byField(candidates, 'pin')
  const brand = byField(candidates, 'brand')
  const hasExpiry = Boolean(expiry || (expiryMonth && expiryYear))
  const strong = Boolean(number || (hasExpiry && cvc))
  if (!strong) return null
  if (!number && !hasExpiry && !cvc && !cardholder) return null

  return {
    form: cardForm,
    cardholder,
    number,
    expiry,
    expiryMonth,
    expiryYear,
    cvc,
    pin,
    brand,
  }
}

/** Détecte un formulaire d’identité ou d’adresse. */
export function detectIdentityFields(
  document: Document,
): DetectedIdentityFields | null {
  const candidates = bestCandidates(document, [
    {
      field: 'fullName',
      score: (input) =>
        (hasAutocomplete(input, 'name') ? 10 : 0) +
        (textMatch(input, /full.?name|nom complet|nom et pr[ée]nom/i) ? 6 : 0),
    },
    {
      field: 'firstName',
      score: (input) =>
        (hasAutocomplete(input, 'given-name') ? 10 : 0) +
        (textMatch(input, /first.?name|pr[ée]nom|given.?name/i) ? 6 : 0),
    },
    {
      field: 'lastName',
      score: (input) =>
        (hasAutocomplete(input, 'family-name') ? 10 : 0) +
        (textMatch(
          input,
          /last.?name|surname|family.?name|nom de famille|\bnom\b/i,
        )
          ? 6
          : 0),
    },
    {
      field: 'email',
      score: (input) =>
        (hasAutocomplete(input, 'email') ? 10 : 0) +
        (inputType(input) === 'email' ? 6 : 0) +
        (textMatch(input, /e.?mail|courriel/i) ? 4 : 0),
    },
    {
      field: 'phone',
      score: (input) =>
        (hasAutocomplete(input, 'tel') ? 10 : 0) +
        (inputType(input) === 'tel' ? 6 : 0) +
        (textMatch(input, /phone|t[ée]l[ée]phone|mobile|portable/i) ? 4 : 0),
    },
    {
      field: 'address',
      score: (input) =>
        (hasAutocomplete(input, 'street-address', 'address-line1') ? 10 : 0) +
        (textMatch(input, /address|adresse|street|rue/i) ? 5 : 0),
    },
    {
      field: 'city',
      score: (input) =>
        (hasAutocomplete(input, 'address-level2') ? 10 : 0) +
        (textMatch(input, /city|ville|town/i) ? 5 : 0),
    },
    {
      field: 'postalCode',
      score: (input) =>
        (hasAutocomplete(input, 'postal-code') ? 10 : 0) +
        (textMatch(input, /postal|zip|code postal/i) ? 6 : 0),
    },
    {
      field: 'country',
      score: (input) =>
        (hasAutocomplete(input, 'country', 'country-name') ? 10 : 0) +
        (textMatch(input, /country|pays/i) ? 5 : 0),
    },
  ])

  if (candidates.length < 3) return null
  const identityForm = dominantForm(candidates)
  if (
    identityForm &&
    visiblePasswords(document).some((input) => input.form === identityForm)
  ) {
    return null
  }
  const addressLike = ['address', 'city', 'postalCode', 'country'] as const
  const hasAddress = addressLike.some((field) => byField(candidates, field))
  const hasContact = Boolean(byField(candidates, 'email') || byField(candidates, 'phone'))
  if (!hasAddress && !hasContact) return null

  return {
    form: identityForm,
    fullName: byField(candidates, 'fullName'),
    firstName: byField(candidates, 'firstName'),
    lastName: byField(candidates, 'lastName'),
    email: byField(candidates, 'email'),
    phone: byField(candidates, 'phone'),
    address: byField(candidates, 'address'),
    city: byField(candidates, 'city'),
    postalCode: byField(candidates, 'postalCode'),
    country: byField(candidates, 'country'),
  }
}

/** Détecte le formulaire le plus pertinent de la page. */
export function detectAutofillFields(document: Document): DetectedAutofill | null {
  const signup = detectSignupFields(document)
  if (signup) {
    return {
      kind: 'signup',
      signup,
      anchor: signup.password,
    }
  }

  const login = detectLoginFields(document)
  if (login.password) {
    return {
      kind: 'login',
      login,
      anchor: login.password,
    }
  }

  const card = detectCardFields(document)
  if (card) {
    return {
      kind: 'card',
      card,
      anchor:
        card.number ??
        card.expiry ??
        card.expiryMonth ??
        card.cvc ??
        card.cardholder ??
        card.pin ??
        card.brand!,
    }
  }

  const identity = detectIdentityFields(document)
  if (identity) {
    return {
      kind: 'identity',
      identity,
      anchor:
        identity.email ??
        identity.firstName ??
        identity.fullName ??
        identity.address ??
        identity.postalCode ??
        identity.city ??
        identity.phone ??
        identity.country!,
    }
  }

  return null
}

function fillValue(input: HTMLInputElement | null, value: string): number {
  if (!input || !value) return 0
  setNativeValue(input, value)
  return 1
}

/** Remplit une carte. Le CVC et le PIN ne sont remplis que si demandé. */
export function fillDetectedCard(
  fields: DetectedCardFields,
  values: CardFillValues,
  includeSensitive: boolean,
): number {
  let filled = 0
  filled += fillValue(fields.cardholder, values.cardholder)
  filled += fillValue(fields.number, values.number)
  filled += fillValue(fields.brand, values.brand)

  const expiry = values.expiry.trim()
  if (fields.expiry) {
    filled += fillValue(fields.expiry, expiry)
  } else {
    const match = /^(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/.exec(expiry)
    if (match) {
      filled += fillValue(fields.expiryMonth, match[1].padStart(2, '0'))
      filled += fillValue(
        fields.expiryYear,
        match[2].length === 2 ? `20${match[2]}` : match[2],
      )
    }
  }

  if (includeSensitive) {
    filled += fillValue(fields.cvc, values.cvc)
    filled += fillValue(fields.pin, values.pin)
  }

  if (filled > 0) (fields.number ?? fields.cardholder)?.focus()
  return filled
}

/** Remplit une identité ou une adresse. */
export function fillDetectedIdentity(
  fields: DetectedIdentityFields,
  values: IdentityFillValues,
): number {
  let filled = 0
  filled += fillValue(fields.fullName, values.fullName)
  filled += fillValue(fields.firstName, values.firstName)
  filled += fillValue(fields.lastName, values.lastName)
  filled += fillValue(fields.email, values.email)
  filled += fillValue(fields.phone, values.phone)
  filled += fillValue(fields.address, values.address)
  filled += fillValue(fields.city, values.city)
  filled += fillValue(fields.postalCode, values.postalCode)
  filled += fillValue(fields.country, values.country)
  if (filled > 0) (fields.email ?? fields.firstName ?? fields.address)?.focus()
  return filled
}

function readValue(input: HTMLInputElement | null): string {
  return input?.value.trim() ?? ''
}

/** Relit une carte saisie dans un formulaire, pour l’enregistrer. */
export function readCardValues(fields: DetectedCardFields): CardFillValues {
  const expiry =
    readValue(fields.expiry) ||
    [readValue(fields.expiryMonth), readValue(fields.expiryYear)]
      .filter(Boolean)
      .join('/')
  return {
    cardholder: readValue(fields.cardholder),
    number: readValue(fields.number),
    expiry,
    cvc: readValue(fields.cvc),
    pin: readValue(fields.pin),
    brand: readValue(fields.brand),
  }
}

/** Relit une identité saisie dans un formulaire, pour l’enregistrer. */
export function readIdentityValues(
  fields: DetectedIdentityFields,
): IdentityFillValues {
  return {
    fullName: readValue(fields.fullName),
    firstName: readValue(fields.firstName),
    lastName: readValue(fields.lastName),
    email: readValue(fields.email),
    phone: readValue(fields.phone),
    address: readValue(fields.address),
    city: readValue(fields.city),
    postalCode: readValue(fields.postalCode),
    country: readValue(fields.country),
  }
}

/** Remplit des champs personnalisés en rapprochant leur libellé. */
export function fillFieldsByLabel(
  values: Array<{ label: string; value: string }>,
): number {
  let filled = 0
  const inputs = visibleInputs(document)
  const used = new Set<HTMLInputElement>()
  for (const value of values) {
    const needle = value.label.trim().toLowerCase()
    if (!needle || !value.value) continue
    const input = inputs.find(
      (candidate) =>
        !used.has(candidate) &&
        descriptors(candidate).toLowerCase().includes(needle),
    )
    if (!input) continue
    setNativeValue(input, value.value)
    used.add(input)
    filled += 1
  }
  return filled
}
