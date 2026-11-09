/**
 * Panneau de détails d’une connexion, avec copie champ par champ.
 *
 * Les valeurs sensibles sont conservées dans des fermetures et ne sont jamais
 * écrites dans des attributs ou des données du DOM. Le mot de passe est masqué
 * par défaut ; l’utilisateur peut le révéler ou le copier sans le révéler.
 */

import { t } from './i18n'

export interface LoginDetails {
  id: string
  title: string
  username: string
  password: string
  totp: string
}

const HIDDEN_VALUE = '••••••••'

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    // Repli pour les navigateurs sans API presse-papiers asynchrone.
  }

  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    return copied
  } catch {
    return false
  }
}

export function detailsNotice(text: string): HTMLParagraphElement {
  const notice = document.createElement('p')
  notice.className = 'details__notice'
  notice.textContent = text
  return notice
}

function copyButton(value: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'button button--small'
  button.textContent = t('details_copy')
  button.setAttribute('aria-label', t('details_copy'))

  button.addEventListener('click', () => {
    void (async () => {
      if (!(await copyText(value))) return
      button.textContent = t('details_copied')
      button.setAttribute('aria-label', t('details_copied'))
      button.disabled = true
      window.setTimeout(() => {
        button.textContent = t('details_copy')
        button.setAttribute('aria-label', t('details_copy'))
        button.disabled = false
      }, 1200)
    })()
  })

  return button
}

function valueRow(
  label: string,
  value: string,
  options: { secret?: boolean; mono?: boolean } = {},
): HTMLElement | null {
  if (!value) return null

  const row = document.createElement('div')
  row.className = 'detail'

  const labelElement = document.createElement('span')
  labelElement.className = 'detail__label'
  labelElement.textContent = label

  const content = document.createElement('div')
  content.className = 'detail__content'

  const valueElement = document.createElement('span')
  valueElement.className = `detail__value${
    options.secret || options.mono ? ' detail__value--mono' : ''
  }`
  valueElement.textContent = options.secret ? HIDDEN_VALUE : value

  const actions = document.createElement('div')
  actions.className = 'detail__actions'

  if (options.secret) {
    const reveal = document.createElement('button')
    reveal.type = 'button'
    reveal.className = 'button button--small'
    reveal.textContent = t('details_reveal')
    reveal.setAttribute('aria-label', t('details_reveal'))
    let shown = false
    reveal.addEventListener('click', () => {
      shown = !shown
      valueElement.textContent = shown ? value : HIDDEN_VALUE
      reveal.textContent = shown ? t('details_hide') : t('details_reveal')
      reveal.setAttribute('aria-label', reveal.textContent ?? '')
    })
    actions.append(reveal)
  }

  actions.append(copyButton(value))
  content.append(valueElement, actions)
  row.append(labelElement, content)
  return row
}

export function renderLoginDetails(
  panel: HTMLElement,
  details: LoginDetails,
  onFill?: () => void,
): void {
  panel.replaceChildren()

  const rows = [
    valueRow(t('details_username'), details.username),
    valueRow(t('details_password'), details.password, { secret: true }),
    valueRow(t('details_totp'), details.totp, { mono: true }),
  ].filter((row): row is HTMLElement => row !== null)

  if (rows.length === 0) {
    panel.append(detailsNotice(t('details_error')))
    return
  }

  panel.append(...rows)

  if (onFill) {
    const actions = document.createElement('div')
    actions.className = 'details__actions'
    const fill = document.createElement('button')
    fill.type = 'button'
    fill.className = 'button button--primary'
    fill.textContent = t('details_fill')
    fill.addEventListener('click', onFill)
    actions.append(fill)
    panel.append(actions)
  }
}
