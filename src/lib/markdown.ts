/**
 * Sous-ensemble Markdown volontairement limité pour les notes.
 *
 * Aucun HTML n’est interprété : le contenu brut reste du texte. Les liens ne
 * sont acceptés que s’ils passent la validation http(s) commune. Les blocs
 * pris en charge sont les titres (`#` à `###`), paragraphes, listes (y compris
 * cases à cocher), citations et blocs de code clôturés par trois accents
 * graves.
 */

import { safeExternalUrl } from './url'

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'strike'; children: MarkdownInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: MarkdownInline[] }

export interface MarkdownListItem {
  children: MarkdownInline[]
  /** `undefined` pour une puce ordinaire, booléen pour une case à cocher. */
  checked?: boolean
}

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; items: MarkdownListItem[] }
  | { type: 'blockquote'; children: MarkdownInline[] }
  | { type: 'code'; language: string; value: string }

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!~>'.split(''))
const LIST_ITEM = /^\s*([-*+]|\d+\.)\s+(.*)$/
const HEADING = /^(#{1,3})\s+(.*)$/
const TASK_ITEM = /^\[([ xX])\]\s+(.*)$/

function isWordCharacter(char: string | undefined): boolean {
  return Boolean(char && /[\p{L}\p{N}_]/u.test(char))
}

function parseInline(input: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = []
  let text = ''
  let index = 0

  const flush = () => {
    if (!text) return
    nodes.push({ type: 'text', value: text })
    text = ''
  }

  while (index < input.length) {
    const char = input[index]

    if (char === '\\' && index + 1 < input.length && ESCAPABLE.has(input[index + 1])) {
      text += input[index + 1]
      index += 2
      continue
    }

    if (char === '`') {
      const end = input.indexOf('`', index + 1)
      if (end > index + 1) {
        flush()
        nodes.push({ type: 'code', value: input.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }

    if (input.startsWith('**', index) || input.startsWith('__', index)) {
      const marker = input.slice(index, index + 2)
      const end = input.indexOf(marker, index + 2)
      if (end > index + 2) {
        flush()
        nodes.push({ type: 'strong', children: parseInline(input.slice(index + 2, end)) })
        index = end + 2
        continue
      }
    }

    if (input.startsWith('~~', index)) {
      const end = input.indexOf('~~', index + 2)
      if (end > index + 2) {
        flush()
        nodes.push({ type: 'strike', children: parseInline(input.slice(index + 2, end)) })
        index = end + 2
        continue
      }
    }

    if (char === '*' || char === '_') {
      // Un underscore au milieu d’un mot (snake_case) n’est pas une emphase.
      const boundary = char === '_' ? !isWordCharacter(input[index - 1]) : true
      const end = boundary ? input.indexOf(char, index + 1) : -1
      if (end > index + 1) {
        flush()
        nodes.push({ type: 'em', children: parseInline(input.slice(index + 1, end)) })
        index = end + 1
        continue
      }
    }

    if (char === '[') {
      const close = input.indexOf(']', index + 1)
      if (close !== -1 && input[close + 1] === '(') {
        const end = input.indexOf(')', close + 2)
        if (end !== -1) {
          const href = safeExternalUrl(input.slice(close + 2, end))
          if (href) {
            flush()
            nodes.push({
              type: 'link',
              href,
              children: parseInline(input.slice(index + 1, close)),
            })
            index = end + 1
            continue
          }
        }
      }
    }

    text += char
    index += 1
  }

  flush()
  return nodes
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.trimStart().startsWith('```')) {
      const language = line.trim().slice(3).trim()
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trimStart().startsWith('```')) {
        code.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: 'code', language, value: code.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2].trim()),
      })
      index += 1
      continue
    }

    const list = LIST_ITEM.exec(line)
    if (list) {
      const ordered = /\d+\./.test(list[1])
      const items: MarkdownListItem[] = []
      while (index < lines.length) {
        const item = LIST_ITEM.exec(lines[index])
        if (!item || /\d+\./.test(item[1]) !== ordered) break
        let value = item[2]
        let checked: boolean | undefined
        const task = TASK_ITEM.exec(value)
        if (task) {
          checked = task[1].toLowerCase() === 'x'
          value = task[2]
        }
        items.push({
          children: parseInline(value),
          ...(checked === undefined ? {} : { checked }),
        })
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    if (line.trimStart().startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && lines[index].trimStart().startsWith('>')) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'blockquote', children: parseInline(quote.join('\n')) })
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index]
      if (!current.trim()) break
      if (
        HEADING.test(current) ||
        LIST_ITEM.test(current) ||
        current.trimStart().startsWith('>') ||
        current.trimStart().startsWith('```')
      ) {
        break
      }
      paragraph.push(current)
      index += 1
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) })
  }

  return blocks
}
