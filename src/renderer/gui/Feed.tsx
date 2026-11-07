// The conversation column of a GUI session (PRD F23, Figma 49″C `Feed`, 51A, 59J): the composer's width, user bubbles
// ending at its right edge with the user's picture outside it, the agent's part of each turn from its left edge with
// the mark outside it — its Markdown, runs of tool and thinking rows grouped 8 apart — 12 between blocks, 24 between
// turns, and the block being streamed. Each
// block is memoised on its items (applyGuiEvent keeps unchanged items by identity), so a streamed delta re-renders
// the live block only; blocks scrolled far out of view skip layout and paint (`content-visibility`).
// Figma 54: hovering a message shows its actions — yours: time · copy · edit; the agent's, after a finished turn: copy ·
// time. 编辑 turns your message into a text box in place and fades what came after it until it is sent or cancelled.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { Brain, ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import type { GuiLive } from '@shared/gui-chat'
import { formatClock } from '@shared/session-meta'
import type { ChatItem } from '@shared/transcript-chat'
import type { AgentKind, SessionId } from '@shared/types'
import { AgentIcon } from '../ui/AgentIcon'
import { StatusGlyph } from '../ui/StatusGlyph'
import { ansiSpans } from './ansi'
import { ChatMarkdown } from './ChatMarkdown'
import { ComposerEditor, insertNewline, type CaretContext } from './ComposerEditor'
import { CopyButton } from './CopyButton'
import {
  composerKey,
  feedBlocks,
  liveStartsTurn,
  sentMessage,
  thinkingLabel,
  toolView,
  turnEnds,
  turnStarts,
  userBubble,
  userMarkdown,
  type FeedBlock,
  type StepItem
} from './model'
import styles from './Chat.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

/** Within this many px of the end the feed follows new content down. */
const STICK_PX = 48

interface FeedProps {
  sessionId: SessionId
  agent: AgentKind
  items: readonly ChatItem[]
  live: GuiLive | null
  waitingTool: string | null
  /** A turn runs: its reply has no actions yet, and nothing can be edited. */
  busy: boolean
  /** The agent can ask again from an earlier message (guiCanEdit) and nothing waits on the user. */
  canEdit: boolean
  /** Asks again from `messageId` with `text`; the reason when it did not. */
  onEdit(messageId: string, text: string): Promise<string | null>
}

export function Feed({ sessionId, agent, items, live, waitingTool, busy, canEdit, onEdit }: FeedProps) {
  const blocks = useMemo(() => feedBlocks(items), [items])
  const starts = useMemo(() => turnStarts(blocks), [blocks])
  const ends = useMemo(() => turnEnds(blocks, busy || live !== null), [blocks, busy, live])
  const [editingId, setEditingId] = useState<string | null>(null)
  // The message being edited, while it is still there (an edit sent replaces the conversation after it).
  const editingAt = editingId === null ? -1 : blocks.findIndex((b) => b.kind === 'item' && b.item.id === editingId)
  const editing = editingAt >= 0 ? editingId : null
  const startEdit = useCallback((id: string) => setEditingId(id), [])
  const cancelEdit = useCallback(() => setEditingId(null), [])
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
        {blocks.map((block, i) =>
          block.kind === 'item' && block.item.kind === 'user' ? (
            <UserMessage
              key={block.key}
              sessionId={sessionId}
              item={block.item}
              faded={editingAt >= 0 && i > editingAt}
              editable={canEdit && !busy && !block.item.id.startsWith('pending-')}
              editing={editing === block.item.id}
              onStartEdit={startEdit}
              onCancel={cancelEdit}
              onSave={onEdit}
            />
          ) : (
            <AgentTurn key={block.key} agent={agent} start={starts.has(block.key)} faded={editingAt >= 0 && i > editingAt} end={ends.get(block.key)}>
              <Block sessionId={sessionId} block={block} waitingTool={block.kind === 'steps' && block.items.some((i) => i.id === waitingTool) ? waitingTool : null} />
            </AgentTurn>
          )
        )}
        {live && (
          <AgentTurn agent={agent} start={liveStartsTurn(blocks)} faded={editingAt >= 0}>
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

/** When a message was sent or a turn ended: `15:04`, with the date on another day. */
const timeOf = (at: number): string => (at > 0 ? formatClock(at, Date.now()) : '')

/**
 * 51A: the agent's part of a turn, after its mark; the mark beside the first block only. 54B: after the last block of
 * a finished turn, copy (the turn's Markdown) · time, shown on hover.
 */
function AgentTurn({ agent, start, faded, end, children }: { agent: AgentKind; start: boolean; faded: boolean; end?: { text: string; at: number }; children: ReactNode }) {
  return (
    <div className={styles.agentTurn} data-start={start || undefined} data-faded={faded || undefined}>
      {start && (
        <span className={styles.agentAvatar} data-agent-mark aria-hidden>
          <AgentIcon kind={agent} size={16} />
        </span>
      )}
      {children}
      {end && (
        <div className={styles.messageActions} data-testid="gui-turn-actions">
          <CopyButton text={end.text} />
          <span className={styles.messageTime}>{timeOf(end.at)}</span>
        </div>
      )}
    </div>
  )
}

interface UserMessageProps {
  sessionId: SessionId
  item: Extract<ChatItem, { kind: 'user' }>
  faded: boolean
  editable: boolean
  editing: boolean
  onStartEdit(id: string): void
  onCancel(): void
  onSave(id: string, text: string): Promise<string | null>
}

/**
 * 51A: what the user sent, as Markdown, with their picture beside it when they set one (设置 · 外观 · 对话). 54A: time ·
 * copy · edit under it on hover; 54C: editing, a text box in its place.
 */
const UserMessage = memo(function UserMessage({ sessionId, item, faded, editable, editing, onStartEdit, onCancel, onSave }: UserMessageProps) {
  const { header, body } = userBubble(item.text)
  const markdown = useMemo(() => userMarkdown(body), [body])
  return (
    <div className={styles.userRow} data-item={item.id} data-faded={faded || undefined}>
      <div className={styles.userColumn}>
        {editing ? (
          <InlineEdit text={item.text} onCancel={onCancel} onSave={(text) => onSave(item.id, text)} />
        ) : (
          <>
            <div className={styles.bubble}>
              {header && <span className={styles.bubbleHeader}>{header}</span>}
              <ChatMarkdown sessionId={sessionId} text={markdown} className={styles.bubbleText} />
            </div>
            <div className={styles.messageActions} data-testid="gui-message-actions">
              <span className={styles.messageTime}>{timeOf(item.at)}</span>
              <CopyButton text={item.text} />
              {editable && (
                <button type="button" className={styles.actionIcon} aria-label="编辑" title="编辑" onClick={() => onStartEdit(item.id)}>
                  <Pencil {...ICON} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <span className={styles.userAvatar} aria-hidden />
    </div>
  )
})

/** 54C: the message as text to change; ⏎ sends it in the original's place (the rest is dropped), ⎋ cancels. */
function InlineEdit({ text, onCancel, onSave }: { text: string; onCancel(): void; onSave(text: string): Promise<string | null> }) {
  const [draft, setDraft] = useState(text)
  const [sending, setSending] = useState(false)
  const editorRef = useRef<Editor | null>(null)
  const submit = (): void => {
    if (!draft.trim() || sending) return
    setSending(true)
    void onSave(draft).then((reason) => {
      if (reason) setSending(false)
    })
  }
  const onKeyDown = (event: KeyboardEvent, caret: CaretContext): boolean => {
    if (event.key === 'Escape' && !event.isComposing) {
      onCancel()
      return true
    }
    const { key, shiftKey, metaKey, ctrlKey, altKey, keyCode, isComposing } = event
    const action = composerKey({ key, shiftKey, metaKey, ctrlKey, altKey, keyCode, isComposing }, { menuOpen: false, busy: false, inCode: caret.inCode })
    if (action === 'send') {
      submit()
      return true
    }
    // ⏎ in a code block is the editor's (three in a row leave it).
    if (action !== 'newline' || (caret.inCode && !shiftKey) || !editorRef.current) return false
    insertNewline(editorRef.current, caret)
    return true
  }
  return (
    <div
      className={styles.editBox}
      data-testid="gui-edit"
      // ⎋ from its buttons too.
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }}
    >
      <ComposerEditor draft={draft} onChange={setDraft} onKeyDown={onKeyDown} editorRef={editorRef} toolbarOpen={false} label="编辑消息" autoFocus />
      <div className={styles.editButtons}>
        <button type="button" className={styles.button} disabled={sending} onClick={onCancel}>
          取消
        </button>
        <button type="button" className={styles.button} data-primary="true" disabled={sending || !draft.trim()} onClick={submit}>
          发送
        </button>
      </div>
    </div>
  )
}

/** A step row's mark (Figma 59J): the tool's icon, or its status while it runs, waits on you or failed. */
function StepMark({ children }: { children: ReactNode }) {
  return <span className={styles.stepMark}>{children}</span>
}

function Thinking({ item }: { item: Extract<StepItem, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.thinking}>
      <button type="button" className={styles.thinkingRow} aria-expanded={open} onClick={() => setOpen(!open)}>
        <StepMark>
          <Brain {...ICON} />
        </StepMark>
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
        <StepMark>{view.status === 'done_unread' ? <view.icon {...ICON} /> : <StatusGlyph status={view.status} />}</StepMark>
        <span className={styles.toolVerb} title={view.name}>
          {view.verb}
        </span>
        <span className={styles.toolArg}>{view.arg}</span>
        {view.added !== undefined && <span className={styles.added}>+{view.added}</span>}
        {view.removed !== undefined && <span className={styles.removed}>−{view.removed}</span>}
        {view.waiting && <span className={styles.waiting}>等你确认</span>}
        {view.exit !== undefined && <span className={styles.exit}>exit {view.exit}</span>}
      </button>
      {view.summary && !open && <p className={styles.toolSummary}>{view.summary}</p>}
      {open && (item.diff || view.output || view.command) && (
        <div className={styles.codeWrap}>
          {item.diff ? <Diff diff={item.diff} /> : <Output raw={item.output ?? ''} command={view.command} />}
          <CopyButton
            text={() => (item.diff ? item.diff.hunks.flatMap((h) => h.lines).join('\n') : view.output?.trim() ? view.output : (view.command ?? ''))}
            label="复制输出"
            className={styles.cornerCopy}
          />
        </div>
      )}
    </div>
  )
}

/**
 * What a command printed, in its colors (the --term-* ones), under `$ <command>` when the agent gave its whole text
 * (Figma 59J); the copy button copies the text alone.
 */
function Output({ raw, command }: { raw: string; command?: string }) {
  const spans = useMemo(() => ansiSpans(raw), [raw])
  return (
    <pre className={styles.output}>
      {command !== undefined && (
        <span className={styles.outputCommand} data-testid="gui-output-command">
          $ {command}
          {raw ? '\n' : ''}
        </span>
      )}
      {spans.map((span, i) =>
        span.fg || span.bold || span.dim ? (
          <span key={i} className={styles.ansi} data-fg={span.fg} data-bold={span.bold} data-dim={span.dim}>
            {span.text}
          </span>
        ) : (
          span.text
        )
      )}
    </pre>
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
        <div className={styles.thinkingRow}>
          <StepMark>
            <Brain {...ICON} />
          </StepMark>
          <p className={styles.thinkingLive}>思考中</p>
        </div>
      </div>
    )
  }
  return <ChatMarkdown sessionId={sessionId} text={live.text} className={`${styles.block} ${styles.live}`} />
}
