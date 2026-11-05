// The agent's words in a GUI session (PRD F23, Figma 49″C): Markdown with GFM, the same element styles as the files
// view's preview (panels/files/MarkdownView), at the chat's reading size. Raw HTML is not rendered (the sanitize
// schema drops what would run); a link opens in the built-in browser, ⌘-click in the system one. A code block has a
// copy button in its corner on hover (Figma 54B).
import { memo, type MouseEvent } from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { SessionId } from '@shared/types'
import { openLink } from '../state/link-actions'
import { CopyButton } from './CopyButton'
import styles from './Chat.module.css'

const REMARK = [remarkGfm]
const REHYPE = [rehypeSanitize]

/** A Markdown (hast) node's text: a code block's source. */
function hastText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; value?: string; children?: unknown[] }
  return n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(hastText).join('')
}

export const ChatMarkdown = memo(function ChatMarkdown({ sessionId, text, className }: { sessionId: SessionId; text: string; className?: string }) {
  const components: Components = {
    a: ({ href, children }) => (
      <a
        href={href}
        title={href}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          e.preventDefault()
          if (href && /^https?:\/\//i.test(href)) openLink(sessionId, href, e.metaKey ? 'external' : 'internal')
        }}
      >
        {children}
      </a>
    ),
    pre: ({ node, children }) => (
      <div className={styles.codeWrap}>
        <pre>{children}</pre>
        <CopyButton text={() => hastText(node).replace(/\n$/, '')} label="复制代码" className={styles.cornerCopy} />
      </div>
    )
  }
  return (
    <div className={[styles.markdown, className].filter(Boolean).join(' ')}>
      <Markdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={components}>
        {text}
      </Markdown>
    </div>
  )
})
