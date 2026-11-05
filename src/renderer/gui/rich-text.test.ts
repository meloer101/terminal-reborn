import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { docText, textDoc } from './rich-text'

const t = (text: string, ...marks: string[]): JSONContent => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) })
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', ...(content.length ? { content } : {}) })
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

describe('docText: what the agent gets (Figma 50C–E)', () => {
  it('keeps plain text exactly as typed: no escapes, no entities, lines a line apart', () => {
    expect(docText(doc(p(t('改 src/my_file.ts 里 a < b && c*d 的 [bug]'))))).toBe('改 src/my_file.ts 里 a < b && c*d 的 [bug]')
    expect(docText(doc(p(t('第一行')), p(), p(t('  缩进的第三行'))))).toBe('第一行\n\n  缩进的第三行')
    expect(docText(doc(p(t('a')), p(t('b'))))).toBe('a\nb')
  })

  it('writes marks around runs, nested, with spaces outside the delimiters', () => {
    expect(docText(doc(p(t('a '), t('bold ', 'bold'), t('both', 'bold', 'italic'), t(' z'))))).toBe('a **bold *both*** z')
    expect(docText(doc(p(t('x', 'strike'), t(' y'))))).toBe('~~x~~ y')
    expect(docText(doc(p(t('run '), t('npm test', 'code'), t(' now'))))).toBe('run `npm test` now')
    expect(docText(doc(p(t('a`b', 'code'))))).toBe('``a`b``')
    expect(docText(doc(p(t('`x', 'code'))))).toBe('`` `x ``')
    expect(docText(doc(p(t('see ', 'bold'), t('file.ts', 'bold', 'code'))))).toBe('**see `file.ts`**')
    // A mark that runs on stays outside one added inside it.
    expect(docText(doc(p(t('和 ', 'strike'), t('斜体', 'italic', 'strike'))))).toBe('~~和 *斜体*~~')
  })

  it('writes lists, nested lists, quotes and code blocks a blank line away from paragraphs', () => {
    const text = docText(
      doc(
        p(t('分三步：')),
        { type: 'orderedList', attrs: { start: 1 }, content: [li(p(t('后端下发 cookie'))), li(p(t('前端删掉 '), t('localStorage', 'code'))), li(p(t('自动刷新')), { type: 'bulletList', content: [li(p(t('失败跳登录')))] })] },
        { type: 'blockquote', content: [p(t('原话')), p(t('第二行'))] },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1\n  b()')] },
        p(t('完'))
      )
    )
    expect(text).toBe(['分三步：', '', '1. 后端下发 cookie', '2. 前端删掉 `localStorage`', '3. 自动刷新', '   - 失败跳登录', '', '> 原话', '> 第二行', '', '```ts', 'const a = 1', '  b()', '```', '', '完'].join('\n'))
  })

  it('keeps a hard break as a newline and fences code that holds a fence', () => {
    expect(docText(doc(p(t('a'), { type: 'hardBreak' }, t('b'))))).toBe('a\nb')
    expect(docText(doc({ type: 'codeBlock', content: [t('```\nx\n```')] }))).toBe('````\n```\nx\n```\n````')
  })
})

describe('textDoc: text set from outside', () => {
  it('is one paragraph a line and comes back the same', () => {
    for (const text of ['', '/review ', 'a\n\n  b', '1. 不是列表\n**也不是粗体**']) expect(docText(textDoc(text))).toBe(text)
  })
})
