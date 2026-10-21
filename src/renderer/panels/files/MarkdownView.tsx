// A Markdown file rendered in the read-only preview (PRD F17). GFM; raw HTML goes through GitHub's sanitize schema,
// so a README's centred logo or <details> shows but nothing runs. Links: http(s) → the built-in browser (⌘ → the
// system browser), a path in the worktree → its preview, #anchor → that heading.
import { Children, isValidElement, memo, useState, type MouseEvent, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { SessionId } from '@shared/types'
import { openLink } from '../../state/link-actions'
import { headingSlug, imagePath, resolveMarkdownHref } from './markdown-model'
import { setNotice, showPreview } from './store'
import styles from './MarkdownView.module.css'

interface Props {
  root: string
  path: string
  sessionId: SessionId
  text: string
}

export const MarkdownView = memo(function MarkdownView({ root, path, sessionId, text }: Props) {
  const follow = (href: string, e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    const target = resolveMarkdownHref(href, path)
    if (!target) return
    if (target.kind === 'url') openLink(sessionId, target.url, e.metaKey ? 'external' : 'internal')
    else if (target.kind === 'anchor') {
      const scope = e.currentTarget.closest('[data-markdown]')
      scope?.querySelector(`[id="${CSS.escape(target.id)}"]`)?.scrollIntoView({ block: 'start' })
    } else
      void window.tr.worktree.resolveLinks(root, [target.path]).then(([found]) => {
        if (found) showPreview(root, found, target.line)
        else setNotice(root, `找不到 ${target.path}`)
      })
  }

  const heading =
    (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
    ({ children }: { children?: ReactNode }) => <Tag id={headingSlug(textOf(children))}>{children}</Tag>

  const components: Components = {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    h5: heading('h5'),
    h6: heading('h6'),
    a: ({ href, children }) => (
      <a href={href} title={href} onClick={(e) => href !== undefined && follow(href, e)}>
        {children}
      </a>
    ),
    img: ({ src, alt }) => <WorktreeImage root={root} path={typeof src === 'string' ? imagePath(src, path) : null} alt={alt ?? ''} />
  }

  return (
    <div className={styles.markdown} data-markdown>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={components}>
        {text}
      </Markdown>
    </div>
  )
})

/** Images inside the worktree load from disk; remote ones (and any that fail) show their alt text. */
function WorktreeImage({ root, path, alt }: { root: string; path: string | null; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (path === null || failed) return alt ? <span className={styles.imageAlt}>{alt}</span> : null
  return <img src={fileUrl(`${root}/${path}`)} alt={alt} onError={() => setFailed(true)} />
}

const fileUrl = (absolute: string): string => `file://${absolute.split('/').map(encodeURIComponent).join('/')}`

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return Children.toArray(node.props.children).map(textOf).join('')
  return ''
}
