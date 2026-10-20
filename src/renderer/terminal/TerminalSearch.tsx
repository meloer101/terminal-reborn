import { CaseSensitive, ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { SessionId } from '@shared/types'
import { IconButton } from '../ui/IconButton'
import { findStatus } from './find'
import { getXtermSurface } from './registry'
import { closeTerminalSearch, useTerminalSearch } from './search-store'
import styles from './TerminalSearch.module.css'

const ICON = { size: 16, strokeWidth: 1.75 } as const

/** Find bar over the active terminal (B18). ↵ goes up to older output, ⇧↵ down; Esc closes and returns to the terminal. */
export function TerminalSearch({ sessionId }: { sessionId: SessionId }) {
  const open = useTerminalSearch((s) => s.open)
  const focusToken = useTerminalSearch((s) => s.focusToken)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<{ resultIndex: number; resultCount: number } | null>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open, focusToken])

  useEffect(() => {
    const surface = getXtermSurface(sessionId)
    if (!open || !surface) return
    const subscription = surface.onFindResults(setResults)
    return () => {
      subscription.dispose()
      surface.clearFind()
      setResults(null)
    }
  }, [open, sessionId])

  if (!open) return null

  const find = (direction: 'previous' | 'next', incremental = false, text = query, cased = caseSensitive): void => {
    const surface = getXtermSurface(sessionId)
    if (!surface) return
    const found = surface.find(text, { caseSensitive: cased, direction, incremental })
    if (!found) setResults(text === '' ? null : { resultIndex: -1, resultCount: 0 })
  }

  const close = (): void => {
    closeTerminalSearch()
    getXtermSurface(sessionId)?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    // Enter / Esc while an input method is composing confirm / cancel the composition.
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      find(e.shiftKey ? 'next' : 'previous')
    }
  }

  return (
    <div className={styles.bar} role="search" data-testid="terminal-search">
      <input
        ref={inputRef}
        className={styles.input}
        value={query}
        placeholder="在终端中查找"
        aria-label="在终端中查找"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          find('previous', true, e.target.value)
        }}
        onKeyDown={onKeyDown}
      />
      <span className={styles.count} aria-live="polite">
        {findStatus(query, results)}
      </span>
      <IconButton
        label="区分大小写"
        active={caseSensitive}
        aria-pressed={caseSensitive}
        onClick={() => {
          setCaseSensitive(!caseSensitive)
          find('previous', true, query, !caseSensitive)
        }}
      >
        <CaseSensitive {...ICON} />
      </IconButton>
      <IconButton label="上一个 · ↵" onClick={() => find('previous')}>
        <ChevronUp {...ICON} />
      </IconButton>
      <IconButton label="下一个 · ⇧↵" onClick={() => find('next')}>
        <ChevronDown {...ICON} />
      </IconButton>
      <IconButton label="关闭 · esc" onClick={close}>
        <X {...ICON} />
      </IconButton>
    </div>
  )
}
