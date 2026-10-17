// BrowserBar (Figma 130:283): back · forward · reload · borderless address field · open in the system browser.
// The address shows the host in the primary color and the path in tertiary; focused, it is a plain text field.
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { parseAddress, splitUrl, type BrowserPageState } from '@shared/browser'
import { IconButton } from '../../ui/IconButton'
import { ClosePanelButton } from '../PaneHeader'
import styles from './BrowserView.module.css'

export function BrowserBar({
  worktree,
  page,
  onError
}: {
  worktree: string
  page: BrowserPageState | undefined
  /** An address that cannot be opened: the reason, or null to clear it. */
  onError: (message: string | null) => void
}) {
  const url = page?.url ?? ''
  const [draft, setDraft] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const editing = draft !== null
  const { host, path } = splitUrl(url)
  const browser = window.tr.browser

  // ⌘L in the page (main hands the keyboard back to the app first).
  useEffect(
    () =>
      window.tr.browser.onFocusAddress((target) => {
        if (target === worktree) input.current?.focus()
      }),
    [worktree]
  )

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      const parsed = parseAddress(e.currentTarget.value)
      if (!parsed.ok) {
        onError(parsed.error)
        return
      }
      onError(null)
      browser.navigate(worktree, parsed.url)
      input.current?.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onError(null)
      input.current?.blur()
    }
  }

  return (
    <div className={styles.header}>
      <div className={styles.bar}>
        <IconButton label="后退" disabled={!page?.canGoBack} onClick={() => browser.back(worktree)}>
          <ArrowLeft size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="前进" disabled={!page?.canGoForward} onClick={() => browser.forward(worktree)}>
          <ArrowRight size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="刷新" disabled={!url} onClick={() => browser.reload(worktree)}>
          <RotateCw size={16} strokeWidth={1.75} />
        </IconButton>
        <label className={styles.address} data-editing={editing}>
          <Globe className={styles.globe} size={16} strokeWidth={1.75} aria-hidden />
          <input
            ref={input}
            className={styles.addressInput}
            aria-label="地址"
            placeholder="输入地址或端口号，如 5173"
            spellCheck={false}
            autoComplete="off"
            value={draft ?? url}
            onFocus={(e) => {
              setDraft(url)
              e.currentTarget.select()
            }}
            onBlur={() => setDraft(null)}
            onChange={(e) => {
              setDraft(e.target.value)
              onError(null)
            }}
            onKeyDown={onKeyDown}
          />
          {!editing && url && (
            <span className={styles.addressText} aria-hidden>
              <span className={styles.host}>{host}</span>
              <span className={styles.path}>{path}</span>
            </span>
          )}
        </label>
        <span className={styles.gap} />
        <IconButton label="用系统浏览器打开" disabled={!url} onClick={() => browser.openExternal(worktree)}>
          <ExternalLink size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      <ClosePanelButton />
    </div>
  )
}
