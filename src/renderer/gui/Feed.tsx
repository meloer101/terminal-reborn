// The conversation column of a GUI session (PRD F23, Figma 49″C `Feed`): user bubbles on the right, the agent's
// Markdown, runs of tool and thinking rows grouped 8 apart, 16 between blocks, and the block being streamed. Each
// block is memoised on its items (applyGuiEvent keeps unchanged items by identity), so a streamed delta re-renders
// the live block only; blocks scrolled far out of view skip layout and paint (`content-visibility`).
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { GuiLive } from '@shared/gui-chat'
import type { ChatItem } from '@shared/transcript-chat'
import type { SessionId } from '@shared/types'
import { StatusGlyph } from '../ui/StatusGlyph'
import { ChatMarkdown } from './ChatMarkdown'
import { feedBlocks, thinkingLabel, toolView, userBubble, type FeedBlock, type StepItem } from './model'
import styles from './Chat.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

/** Within this many px of the end the feed follows new content down. */
const STICK_PX = 48

export function Feed({ sessionId, items, live, waitingTool }: { sessionId: SessionId; items: readonly ChatItem[]; live: GuiLive | null; waitingTool: string | null }) {
  const blocks = useMemo(() => feedBlocks(items), [items])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)

  // Follows the end while the user is there; scrolling up leaves the view where it is.
  useEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    const onScroll = (): void => {
      stuck.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= STICK_PX
    }
    const observer = new ResizeObserver(() => {
      if (stuck.current) scroller.scrollTop = scroller.scrollHeight
    })
    observer.observe(content)
    observer.observe(scroller)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (scroller && stuck.current) scroller.scrollTop = scroller.scrollHeight
  }, [blocks, live])

  return (
    <div ref={scrollerRef} className={styles.scroller} data-region="gui-feed">
      <div ref={contentRef} className={styles.feed}>
        {blocks.map((block) => (
          <Block key={block.key} sessionId={sessionId} block={block} waitingTool={block.kind === 'steps' && block.items.some((i) => i.id === waitingTool) ? waitingTool : null} />
        ))}
        {live && <Live sessionId={sessionId} live={live} />}
      </div>
    </div>
  )
}

const Block = memo(
  function Block({ sessionId, block, waitingTool }: { sessionId: SessionId; block: FeedBlock; waitingTool: string | null }) {
    if (block.kind === 'steps') {
      return (
        <div className={styles.steps}>
          {block.items.map((item) => (item.kind === 'thinking' ? <Thinking key={item.id} item={item} /> : <Tool key={item.id} item={item} waiting={item.id === waitingTool} />))}
        </div>
      )
    }
    const { item } = block
    switch (item.kind) {
      case 'user':
        return <UserBubble text={item.text} />
      case 'text':
        return <ChatMarkdown sessionId={sessionId} text={item.text} className={styles.block} />
      case 'system':
        return <p className={styles.system}>{item.text}</p>
      case 'unknown':
        return null
    }
  },
  (a, b) => a.sessionId === b.sessionId && a.waitingTool === b.waitingTool && sameBlock(a.block, b.block)
)

/** Same block: the same items, by identity (a grown run of steps is a new block). */
function sameBlock(a: FeedBlock, b: FeedBlock): boolean {
  if (a.kind === 'item' || b.kind === 'item') return a.kind === b.kind && a.kind === 'item' && b.kind === 'item' && a.item === b.item
  return a.items.length === b.items.length && a.items.every((item, i) => item === b.items[i])
}

function UserBubble({ text }: { text: string }) {
  const { header, body } = userBubble(text)
  return (
    <div className={styles.userRow}>
      <div className={styles.bubble}>
        {header && <span className={styles.bubbleHeader}>{header}</span>}
        <p className={styles.bubbleText}>{body}</p>
      </div>
    </div>
  )
}

function Thinking({ item }: { item: Extract<StepItem, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.thinking}>
      <button type="button" className={styles.thinkingRow} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{thinkingLabel(item.ms)}</span>
        {open ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
      </button>
      {open && item.text && <p className={styles.thinkingText}>{item.text}</p>}
    </div>
  )
}

function Tool({ item, waiting }: { item: Extract<StepItem, { kind: 'tool' }>; waiting: boolean }) {
  const [open, setOpen] = useState(false)
  const view = toolView(item, waiting)
  return (
    <div className={styles.tool}>
      <button type="button" className={styles.toolRow} aria-expanded={view.expandable ? open : undefined} disabled={!view.expandable} onClick={() => setOpen(!open)}>
        <StatusGlyph status={view.status} />
        <span className={styles.toolName}>{view.name}</span>
        <span className={styles.toolArg}>{view.arg}</span>
        {view.added !== undefined && <span className={styles.added}>+{view.added}</span>}
        {view.removed !== undefined && <span className={styles.removed}>−{view.removed}</span>}
        {view.waiting && <span className={styles.waiting}>等你确认</span>}
      </button>
      {view.summary && !open && <p className={styles.toolSummary}>{view.summary}</p>}
      {open && item.diff && <Diff diff={item.diff} />}
      {open && !item.diff && item.output && <pre className={styles.output}>{item.output}</pre>}
    </div>
  )
}

function Diff({ diff }: { diff: NonNullable<Extract<ChatItem, { kind: 'tool' }>['diff']> }) {
  return (
    <pre className={styles.output}>
      {diff.hunks.map((hunk, h) => (
        <span key={h} className={styles.hunk}>
          {hunk.lines.map((line, i) => (
            <span key={i} className={styles.diffLine} data-kind={line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx'}>
              {line}
              {'\n'}
            </span>
          ))}
        </span>
      ))}
      {diff.truncated && <span className={styles.diffLine}>…</span>}
    </pre>
  )
}

/** The block being streamed: the agent's text so far with a caret, or its thinking going on. */
function Live({ sessionId, live }: { sessionId: SessionId; live: GuiLive }) {
  if (live.kind === 'thinking') {
    return (
      <div className={styles.steps}>
        <p className={styles.thinkingLive}>思考中</p>
      </div>
    )
  }
  return <ChatMarkdown sessionId={sessionId} text={live.text} className={`${styles.block} ${styles.live}`} />
}
