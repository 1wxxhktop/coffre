import { describe, expect, it } from 'vitest'
import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from './markdown'

function inlineText(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'code') return node.value
      if (node.type === 'link') return inlineText(node.children)
      return inlineText(node.children)
    })
    .join('')
}

function firstParagraph(blocks: MarkdownBlock[]): MarkdownInline[] {
  const paragraph = blocks.find((block) => block.type === 'paragraph')
  return paragraph && paragraph.type === 'paragraph' ? paragraph.children : []
}

describe('Markdown des notes', () => {
  it('reconnaît les titres et les paragraphes', () => {
    const blocks = parseMarkdown('# Titre\n\nBonjour le monde')
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 })
    expect(inlineText(firstParagraph(blocks))).toBe('Bonjour le monde')
  })

  it('met en forme sans interpréter de HTML', () => {
    const blocks = parseMarkdown(
      'Un **gras**, une *italique*, du `code` et ~~barré~~.\n<script>alert(1)</script>',
    )
    const paragraph = firstParagraph(blocks)
    expect(paragraph.map((node) => node.type)).toEqual(
      expect.arrayContaining(['strong', 'em', 'code', 'strike', 'text']),
    )
    expect(inlineText(paragraph)).toContain('<script>alert(1)</script>')
  })

  it('accepte uniquement les liens http(s)', () => {
    const blocks = parseMarkdown(
      '[Documentation](https://example.com/docs) et [piège](javascript:alert(1))',
    )
    const paragraph = firstParagraph(blocks)
    const links = paragraph.filter((node) => node.type === 'link')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ href: 'https://example.com/docs' })
    expect(inlineText(paragraph)).toContain('piège')
  })

  it('reconnaît les listes et les cases à cocher', () => {
    const blocks = parseMarkdown('- [ ] À faire\n- [x] Fait\n- Simple')
    const list = blocks[0]
    expect(list).toMatchObject({ type: 'list', ordered: false })
    if (list.type !== 'list') return
    expect(list.items.map((item) => item.checked)).toEqual([false, true, undefined])
  })

  it('distingue les listes ordonnées', () => {
    const blocks = parseMarkdown('1. Premier\n2. Second')
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: true })
  })

  it('reconnaît les citations et les blocs de code', () => {
    const blocks = parseMarkdown('> Une citation\n\n```ts\nconst x = 1\n```')
    expect(blocks[0]).toMatchObject({ type: 'blockquote' })
    expect(blocks[1]).toMatchObject({
      type: 'code',
      language: 'ts',
      value: 'const x = 1',
    })
  })

  it('respecte les échappements et les underscores de mot', () => {
    expect(inlineText(firstParagraph(parseMarkdown('\\*pas emphase\\*')))).toBe(
      '*pas emphase*',
    )
    const paragraph = firstParagraph(parseMarkdown('snake_case et _vraie emphase_'))
    expect(paragraph.some((node) => node.type === 'em')).toBe(true)
    expect(inlineText(paragraph)).toBe('snake_case et vraie emphase')
  })
})
