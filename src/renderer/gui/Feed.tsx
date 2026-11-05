// The conversation column of a GUI session (PRD F23, Figma 49″C `Feed`, 51A): user bubbles on the right with the
// user's picture beside them, the agent's part of each turn after its mark — its Markdown, runs of tool and thinking
// rows grouped 8 apart — 16 between blocks, and the block being streamed. Each
// block is memoised on its items (applyGuiEvent keeps unchanged items by identity), so a streamed delta re-renders
// the live block only; blocks scrolled far out of view skip layout and paint (`content-visibility`).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { GuiLive } from '@shared/gui-chat'
import type { ChatItem } from '@shared/transcript-chat'
import type { AgentKind, SessionId } from '@shared/types'
import { AgentIcon } from '../ui/AgentIcon'
import { StatusGlyph } from '../ui/StatusGlyph'
import { ChatMarkdown } from './ChatMarkdown'
import { feedBlocks, liveStartsTurn, sentMessage, thinkingLabel, toolView, turnStarts, userBubble, userMarkdown, type FeedBlock, type StepItem } from './model'
import styles from './Chat.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

/** Within this many px of the end the feed follows new content down. */
const STICK_PX = 48

export function Feed({ sessionId, agent, items, live, waitingTool }: { sessionId: SessionId; agent: AgentKind; items: readonly ChatItem[]; live: GuiLive | null; waitingTool: string | null }) {
  const blocks = useMemo(() => feedBlocks(items), [items])
  const starts = useMemo(() => turnStarts(blocks), [blocks])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  // The blocks last drawn, to tell a message the user just sent.
  const seen = useRef<FeedBlock[] | null>(null)

  // The feed reads top down like any chat (Figma 50A): new blocks go below and the view follows the end while the
  // user is there; scrolling up leaves the view where it is, and sending a message brings it back to the end.
  const follow = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller && stuck.current) scroller.scrollTop = scroller.scrollHeight
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    const onScroll = (): void => {
      stuck.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= STICK_PX
    }
    const observer = new ResizeObserver(follow)
    observer.observe(content)
    observer.observe(scroller)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [follow])

  useLayoutEffect(() => {
    if (sentMessage(seen.current, blocks)) stuck.current = true
    seen.current = blocks
    follow()
  }, [blocks, live, follow])

  return (
    <div ref={scrollerRef} className={styles.scroller} data-region="gui-feed">
      <div ref={contentRef} className={styles.feed}>
        {blocks.map((block) =>
          block.kind === 'item' && block.item.kind === 'user' ? (
            <UserBubble key={block.key} sessionId={sessionId} id={block.item.id} text={block.item.text} />
          ) : (
            <AgentTurn key={block.key} agent={agent} start={starts.has(block.key)}>
              <Block sessionId={sessionId} block={block} waitingTool={block.kind === 'steps' && block.items.some((i) => i.id === waitingTool) ? waitingTool : null} />
            </AgentTurn>
          )
        )}
        {live && (
          <AgentTurn agent={agent} start={liveStartsTurn(blocks)}>
            <Live sessionId={sessionId} live={live} />
          </AgentTurn>
        )}
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
        return null
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

/** 51A: the agent's part of a turn, after its mark; the mark beside the first block only. */
function AgentTurn({ agent, start, children }: { agent: AgentKind; start: boolean; children: ReactNode }) {
  return (
    <div className={styles.agentTurn} data-start={start || undefined}>
      {start && (
        <span className={styles.agentAvatar} data-agent-mark aria-hidden>
          <AgentIcon kind={agent} size={16} />
        </span>
      )}
      {children}
    </div>
  )
}

/** 51A: what the user sent, as Markdown, with their picture beside it when they set one (设置 · 外观 · 对话). */
const UserBubble = memo(function UserBubble({ sessionId, id, text }: { sessionId: SessionId; id: string; text: string }) {
  const { header, body } = userBubble(text)
  const markdown = useMemo(() => userMarkdown(body), [body])
  return (
    <div className={styles.userRow} data-item={id}>
      <div className={styles.bubble}>
        {header && <span className={styles.bubbleHeader}>{header}</span>}
        <ChatMarkdown sessionId={sessionId} text={markdown} className={styles.bubbleText} />
      </div>
      <span className={styles.userAvatar} aria-hidden />
    </div>
  )
})

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
