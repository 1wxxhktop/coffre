/**
 * Modèle pur du menu contextuel.
 *
 * Il ne contient aucun secret : uniquement des identifiants d’éléments et des
 * libellés déjà visibles dans le coffre. Les connexions sont filtrées sur
 * l’hôte de la page active avant de construire le modèle ; une entrée d’un
 * autre domaine ne peut donc pas atteindre le menu.
 */

import type {
  ExtensionAutofillSummary,
  ExtensionLoginSummary,
} from '../src/lib/extensionProtocol'
import { matchingLoginSummaries } from './commandHelpers'

export type ContextMenuContext = 'all' | 'page' | 'editable'

export interface ContextMenuEntry {
  id: string
  title?: string
  titleKey?: string
  parentId?: string
  contexts?: ContextMenuContext[]
  enabled?: boolean
}

export interface ContextMenuInput {
  unlocked: boolean
  fillAllowed?: boolean
  host: string
  logins: ExtensionAutofillSummary[]
  cards: ExtensionAutofillSummary[]
  identities: ExtensionAutofillSummary[]
}

const MAX_ITEMS = 8

function titled(
  items: ExtensionAutofillSummary[],
  prefix: string,
  parentId: string,
  emptyKey: string,
): ContextMenuEntry[] {
  const selected = items.slice(0, MAX_ITEMS)
  if (selected.length === 0) {
    return [
      {
        id: `${prefix}-none`,
        titleKey: emptyKey,
        parentId,
        enabled: false,
      },
    ]
  }
  return selected.map((item) => ({
    id: `${prefix}:${item.id}`,
    title: item.title,
    parentId,
  }))
}

export function buildContextMenuModel(
  input: ContextMenuInput,
): ContextMenuEntry[] {
  if (!input.unlocked) {
    return [
      {
        id: 'unlock',
        titleKey: 'context_unlock',
        contexts: ['all'],
      },
    ]
  }

  if (input.fillAllowed === false) {
    return [
      {
        id: 'open-app',
        titleKey: 'context_openApp',
        contexts: ['page'],
      },
      {
        id: 'add-site',
        titleKey: 'context_addSite',
        contexts: ['page'],
      },
    ]
  }

  const entries: ContextMenuEntry[] = [
    {
      id: 'fill-login',
      titleKey: 'context_fillLogin',
      contexts: ['editable'],
    },
  ]
  const logins: ExtensionLoginSummary[] = matchingLoginSummaries(
    input.logins,
    input.host,
  )
  if (!input.host) {
    entries.push({
      id: 'fill-login-choose',
      titleKey: 'context_chooseLogin',
      parentId: 'fill-login',
    })
  } else if (logins.length === 0) {
    entries.push({
      id: 'fill-login-none',
      titleKey: 'context_noLogin',
      parentId: 'fill-login',
      enabled: false,
    })
  } else {
    entries.push(
      ...logins.slice(0, MAX_ITEMS).map((item) => ({
        id: `fill-login:${item.id}`,
        title: item.title,
        parentId: 'fill-login',
      })),
    )
  }

  entries.push(
    {
      id: 'generate-password',
      titleKey: 'context_generate',
      contexts: ['editable'],
    },
    {
      id: 'insert-alias',
      titleKey: 'context_alias',
      contexts: ['editable'],
    },
    {
      id: 'fill-card',
      titleKey: 'context_fillCard',
      contexts: ['editable'],
    },
    ...titled(input.cards, 'fill-card', 'fill-card', 'context_noCard'),
    {
      id: 'fill-identity',
      titleKey: 'context_fillIdentity',
      contexts: ['editable'],
    },
    ...titled(
      input.identities,
      'fill-identity',
      'fill-identity',
      'context_noIdentity',
    ),
    {
      id: 'open-app',
      titleKey: 'context_openApp',
      contexts: ['page'],
    },
    {
      id: 'add-site',
      titleKey: 'context_addSite',
      contexts: ['page'],
    },
  )
  return entries
}
