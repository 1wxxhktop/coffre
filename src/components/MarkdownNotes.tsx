import { Fragment, useMemo, type ReactNode } from 'react'
import { handleExternalClick } from '../lib/external'
import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from '../lib/markdown'

function renderInline(nodes: MarkdownInline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return (
          <Fragment key={index}>
            {node.value.split('\n').map((part, line) => (
              <Fragment key={line}>
                {line > 0 && <br />}
                {part}
              </Fragment>
            ))}
          </Fragment>
        )
      case 'strong':
        return <strong key={index}>{renderInline(node.children)}</strong>
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>
      case 'strike':
        return <s key={index}>{renderInline(node.children)}</s>
      case 'code':
        return <code key={index}>{node.value}</code>
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => handleExternalClick(event, node.href)}
          >
            {renderInline(node.children)}
          </a>
        )
    }
  })
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5'
      return <Tag key={index}>{renderInline(block.children)}</Tag>
    }
    case 'paragraph':
      return <p key={index}>{renderInline(block.children)}</p>
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag key={index}>
          {block.items.map((item, itemIndex) => (
            <li
              key={itemIndex}
              className={item.checked === undefined ? undefined : 'markdown-task'}
            >
              {item.checked !== undefined && (
                <input
                  type="checkbox"
                  checked={item.checked}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                />
              )}
              <span>{renderInline(item.children)}</span>
            </li>
          ))}
        </Tag>
      )
    }
    case 'blockquote':
      return <blockquote key={index}>{renderInline(block.children)}</blockquote>
    case 'code':
      return (
        <pre key={index}>
          <code>{block.value}</code>
        </pre>
      )
  }
}

/** Rend les notes avec un Markdown restreint, sans jamais interpréter de HTML. */
export function MarkdownNotes({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return <div className="markdown-notes">{blocks.map(renderBlock)}</div>
}
