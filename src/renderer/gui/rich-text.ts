// The composer's formatted text as the agent gets it (PRD F23, Figma 50C–E): Markdown, but only where there is
// formatting. Plain text comes out exactly as typed — no backslash escapes, no HTML entities (`src/my_file.ts`,
// `a < b` stay as they are), paragraphs one line apart like a text area's lines — so a path or a command in a prompt
// is never changed. Lists are `- ` / `1. `, quotes `> `, code blocks fenced, marks `**` `*` `~~` and backticks.
// `textDoc` is the way back for text set from outside (a picked `/` command, a restored draft): one paragraph a line,
// so `docText(textDoc(t)) === t`. Pure.
import type { JSONContent } from '@tiptap/core'

type Mark = 'bold' | 'italic' | 'strike' | 'code'

/** Outermost first; code is always innermost (nothing is formatted inside it). */
const MARK_ORDER: readonly Mark[] = ['bold', 'italic', 'strike', 'code']
const DELIMITER: Record<Exclude<Mark, 'code'>, string> = { bold: '**', italic: '*', strike: '~~' }

const marksOf = (node: JSONContent): Mark[] => {
  const names = new Set((node.marks ?? []).map((m) => m.type))
  return MARK_ORDER.filter((m) => names.has(m))
}

/** Inline code: as many backticks as it needs to hold the ones inside it, padded when it starts or ends with one. */
function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

/**
 * A paragraph's inline content. Marks open and close around runs of text (`**a *b***`, not `**a****b**`); spaces at a
 * run's edges stay outside its delimiters, where Markdown needs them.
 */
function inline(nodes: readonly JSONContent[]): string {
  let out = ''
  const open: Mark[] = []
  const close = (keep: number): void => {
    if (open.length <= keep) return
    const trail = /\s*$/.exec(out)?.[0] ?? ''
    out = out.slice(0, out.length - trail.length)
    while (open.length > keep) {
      const mark = open.pop()!
      if (mark !== 'code') out += DELIMITER[mark]
    }
    out += trail
  }
  // A code span is written whole: consecutive text nodes with the code mark are one span.
  let code: string | null = null
  const flushCode = (): void => {
    if (code === null) return
    out += codeSpan(code)
    code = null
  }
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      flushCode()
      close(0)
      out += '\n'
      continue
    }
    if (node.type !== 'text' || !node.text) continue
    const marks = marksOf(node)
    // Marks already open that this run keeps stay outermost, so a mark added inside a longer one nests in it.
    const own: Mark[] = marks.filter((m) => m !== 'code')
    let same = 0
    while (same < open.length && own.includes(open[same]!)) same++
    const outer = [...open.slice(0, same), ...own.filter((m) => !open.slice(0, same).includes(m))]
    if (same < open.length) {
      flushCode()
      close(same)
    }
    if (marks.includes('code')) {
      for (const mark of outer.slice(open.length)) {
        out += DELIMITER[mark as Exclude<Mark, 'code'>]
        open.push(mark)
      }
      code = (code ?? '') + node.text
      continue
    }
    flushCode()
    const text = node.text
    const lead = outer.length > open.length ? (/^\s*/.exec(text)?.[0] ?? '') : ''
    out += lead
    for (const mark of outer.slice(open.length)) {
      out += DELIMITER[mark as Exclude<Mark, 'code'>]
      open.push(mark)
    }
    out += text.slice(lead.length)
  }
  flushCode()
  close(0)
  return out
}

/** Indents every line after the first by `indent` (a list item's continuation lines). */
const hang = (text: string, indent: string): string => text.replace(/\n(?=.)/g, `\n${indent}`)

function block(node: JSONContent): string {
  const children = node.content ?? []
  switch (node.type) {
    case 'paragraph':
      return inline(children)
    case 'codeBlock': {
      const text = children.map((c) => c.text ?? '').join('')
      const longest = Math.max(2, ...(text.match(/`{3,}/g) ?? []).map((run) => run.length))
      const fence = '`'.repeat(longest + 1)
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      return `${fence}${language}\n${text}\n${fence}`
    }
    case 'blockquote':
      return blocks(children)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')
    case 'bulletList':
    case 'orderedList': {
      const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
      return children
        .map((item, i) => {
          const marker = node.type === 'bulletList' ? '- ' : `${start + i}. `
          return marker + hang(blocks(item.content ?? [], '\n'), ' '.repeat(marker.length))
        })
        .join('\n')
    }
    default:
      return inline(children)
  }
}

/**
 * Blocks one after another: paragraphs a line apart (a text area's lines); a list, quote or code block a blank line
 * away from what is around it, so it reads as its own block. Inside a list item everything is a line apart.
 */
function blocks(nodes: readonly JSONContent[], separator?: string): string {
  let out = ''
  nodes.forEach((node, i) => {
    if (i > 0) out += separator ?? (node.type === 'paragraph' && nodes[i - 1]!.type === 'paragraph' ? '\n' : '\n\n')
    out += block(node)
  })
  return out
}

/** The text the agent gets for the composer's document. */
export const docText = (doc: JSONContent): string => blocks(doc.content ?? [])

/** Text set from outside as a document: one paragraph a line. */
export function textDoc(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
  }
}
