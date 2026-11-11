// The conversation column of a GUI session (PRD F23, Figma 49″C `Feed`, 51A, 59J): the composer's width, user bubbles
// ending at its right edge with the user's picture outside it, the agent's part of each turn from its left edge with
// the mark outside it — its Markdown, runs of tool and thinking rows grouped 8 apart (a subagent's under its row) — 12 between blocks, 24 between
// turns, and the block being streamed. Each
// block is memoised on its items (applyGuiEvent keeps unchanged items by identity), so a streamed delta re-renders
// the live block only; blocks scrolled far out of view skip layout and paint (`content-visibility`).
// Figma 54: hovering a message shows its actions — yours: time · copy · edit; the agent's, after a finished turn: copy ·
// time. 编辑 turns your message into a text box in place and fades what came after it until it is sent or cancelled.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { Bot, Brain, ChevronDown, ChevronRight, ClipboardList, FilePlus, FileText, FolderSearch, Globe, ListTodo, MoveRight, Pencil, Search, Sparkles, Square, Terminal, ToggleLeft, Trash2, Wrench, type LucideIcon } from 'lucide-react'
import type { GuiLive } from '@shared/gui-chat'
import { formatClock } from '@shared/session-meta'
import type { ChatItem, FileDiff } from '@shared/transcript-chat'
import type { AgentKind, SessionId } from '@shared/types'
import { AgentIcon } from '../ui/AgentIcon'
import { StatusGlyph } from '../ui/StatusGlyph'
import { ansiSpans } from './ansi'
import { ChatMarkdown } from './ChatMarkdown'
import { Attachment } from './Composer'
import { ComposerEditor, insertNewline, type CaretContext } from './ComposerEditor'
import { CopyButton } from './CopyButton'
import { DispatchGraph, WaviMessageView } from './Dispatch'
import { DiffBlock, diffText } from './DiffBlock'
import { TodoList } from './Todos'
import {
  blockHas,
  composerKey,
  dispatchKey,
  dispatchRows,
  waviMessage,
  feedBlocks,
  groupView,
  isSubagentTool,
  liveStartsTurn,
  sentMessage,
  stepParts,
  subagentElapsed,
  thinkingLabel,
  toolView,
  turnEnds,
  turnStarts,
  userBubble,
  userMarkdown,
  type DispatchRow,
  type FeedBlock,
  type NestedItem,
  type StepItem,
  type ToolIcon,
  type ToolView,
  type WaviMessage
} from './model'
import styles from './Chat.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

/** A tool row's icon key (model.ts `toolView`) → its lucide icon. */
const TOOL_ICONS: Readonly<Record<ToolIcon, LucideIcon>> = {
  'file-text': FileText,
  'file-plus': FilePlus,
  pencil: Pencil,
  terminal: Terminal,
  square: Square,
  search: Search,
  'folder-search': FolderSearch,
  globe: Globe,
  bot: Bot,
  'list-todo': ListTodo,
  sparkles: Sparkles,
  'clipboard-list': ClipboardList,
  trash: Trash2,
  'move-right': MoveRight,
  brain: Brain,
  toggle: ToggleLeft,
  wrench: Wrench
}

/** Wavi's own message (a dispatch report or notice) in a user item, read once per item. */
const waviCache = new WeakMap<ChatItem, WaviMessage | null>()
function waviOf(item: Extract<ChatItem, { kind: 'user' }>): WaviMessage | null {
  let found = waviCache.get(item)
  if (found === undefined) waviCache.set(item, (found = waviMessage(item.text)))
  return found
}

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
  // Figma 68′: the turn's wavi run calls as one graph.
  const dispatch = useMemo(() => dispatchRows(items), [items])
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
          block.kind === 'item' && block.item.kind === 'user' && waviOf(block.item) ? (
            <WaviMessageView key={block.key} message={waviOf(block.item)!} time={timeOf(block.item.at)} />
          ) : block.kind === 'item' && block.item.kind === 'user' ? (
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
              <Block
                sessionId={sessionId}
                block={block}
                waitingTool={block.kind === 'steps' && waitingTool !== null && blockHas(block, waitingTool) ? waitingTool : null}
                dispatch={dispatch}
                dispatchShape={dispatchKey(block, dispatch)}
              />
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
  function Block({
    sessionId,
    block,
    waitingTool,
    dispatch
  }: {
    sessionId: SessionId
    block: FeedBlock
    waitingTool: string | null
    dispatch: ReadonlyMap<string, DispatchRow>
    /** What the block draws of `dispatch` (dispatchKey): the memo compares this, not the map. */
    dispatchShape: string
  }) {
    if (block.kind === 'steps') {
      return (
        <div className={styles.steps}>
          {/* Figma 70′B: calls between two of the agent's words fold into one row; the dispatch graph and a call waiting on
              you stay out, and the calls the graph draws are not there to split a run. */}
          {stepParts(
            block.items.filter((item) => dispatch.get(item.id)?.kind !== 'merged'),
            (item) => dispatch.has(item.id) || item.id === waitingTool
          ).map((part) => {
            if (part.kind === 'group') return <ToolGroup key={part.key} items={part.items} nested={block.nested} />
            const { item } = part
            const row = dispatch.get(item.id)
            if (row?.kind === 'graph') return <DispatchGraph key={item.id} parentId={sessionId} ids={row.ids} />
            if (row?.kind === 'merged') return null
            return item.kind === 'thinking' ? <Thinking key={item.id} item={item} /> : <Tool key={item.id} item={item} nested={block.nested} waitingTool={waitingTool} />
          })}
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
  (a, b) => a.sessionId === b.sessionId && a.waitingTool === b.waitingTool && a.dispatchShape === b.dispatchShape && sameBlock(a.block, b.block)
)

const sameList = <T,>(a: readonly T[], b: readonly T[] | undefined): boolean => !!b && a.length === b.length && a.every((item, i) => item === b[i])

/** Same block: the same items, by identity, and the same under each subagent row (a grown run of steps is a new block). */
function sameBlock(a: FeedBlock, b: FeedBlock): boolean {
  if (a.kind === 'item' || b.kind === 'item') return a.kind === b.kind && a.kind === 'item' && b.kind === 'item' && a.item === b.item
  return sameList(a.items, b.items) && a.nested.size === b.nested.size && [...a.nested].every(([id, list]) => sameList(list, b.nested.get(id)))
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
 * copy · edit under it on hover; 54C: editing, a text box in its place. 71A: the pictures sent with it over the bubble
 * (71C: no bubble when it had no words; 71D: a file that is gone shows its name).
 */
const UserMessage = memo(function UserMessage({ sessionId, item, faded, editable, editing, onStartEdit, onCancel, onSave }: UserMessageProps) {
  const { header, body } = userBubble(item.text)
  const markdown = useMemo(() => userMarkdown(body), [body])
  const pictures = item.attachments ?? []
  return (
    <div className={styles.userRow} data-item={item.id} data-faded={faded || undefined}>
      <div className={styles.userColumn}>
        {editing ? (
          <InlineEdit text={item.text} onCancel={onCancel} onSave={(text) => onSave(item.id, text)} />
        ) : (
          <>
            {pictures.length > 0 && (
              <ul className={`${styles.attachments} ${styles.sentPictures}`} aria-label="图片" data-testid="gui-message-pictures">
                {pictures.map((path, i) => (
                  <Attachment key={`${i}:${path}`} path={path} />
                ))}
              </ul>
            )}
            {(item.text.trim() || pictures.length === 0) && (
              <div className={styles.bubble}>
                {header && <span className={styles.bubbleHeader}>{header}</span>}
                <ChatMarkdown sessionId={sessionId} text={markdown} className={styles.bubbleText} />
              </div>
            )}
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
      <ComposerEditor draft={draft} onChange={setDraft} onKeyDown={onKeyDown} editorRef={editorRef} label="编辑消息" autoFocus />
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

function ToolIconMark({ icon }: { icon: ToolIcon }) {
  const Icon = TOOL_ICONS[icon]
  return <Icon {...ICON} />
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
        {open ? <ChevronDown {...ICON} className={styles.rowChevron} /> : <ChevronRight {...ICON} className={styles.rowChevron} />}
      </button>
      {open && item.text && <p className={styles.thinkingText}>{item.text}</p>}
    </div>
  )
}

/**
 * Figma 70′B / 70C: a run of calls as one row — › · what they did (读取了 2 个文件，运行了 1 条命令) · +N −M · N 个失败; while
 * one runs, the mark turns and the call follows the summary (· 运行 pnpm test). Opened, its rows are listed right of a
 * line as under a subagent's row, up to 320 high.
 */
function ToolGroup({ items, nested }: { items: readonly StepItem[]; nested: ReadonlyMap<string, readonly NestedItem[]> }) {
  const [open, setOpen] = useState(false)
  const view = groupView(items)
  return (
    <div className={styles.tool} data-testid="gui-tool-group">
      <button type="button" className={styles.toolRow} aria-expanded={open} onClick={() => setOpen(!open)}>
        <StepMark>{view.running ? <StatusGlyph status="running" /> : open ? <ChevronDown {...ICON} className={styles.rowChevron} /> : <ChevronRight {...ICON} className={styles.rowChevron} />}</StepMark>
        <span className={styles.groupText}>{view.text}</span>
        {view.live && (
          <>
            <span className={styles.toolVerb}>· {view.live.verb}</span>
            <span className={styles.groupArg}>{view.live.arg}</span>
          </>
        )}
        <span className={styles.groupFill} />
        {view.added !== undefined && <span className={styles.added}>+{view.added}</span>}
        {view.removed !== undefined && <span className={styles.removed}>−{view.removed}</span>}
        {view.failed > 0 && <span className={styles.failed}>{view.failed} 个失败</span>}
      </button>
      {open && (
        <div className={`${styles.subagentSteps} ${styles.groupSteps}`} data-testid="gui-tool-group-steps">
          {items.map((item) => (item.kind === 'thinking' ? <Thinking key={item.id} item={item} /> : <Tool key={item.id} item={item} nested={nested} waitingTool={null} />))}
        </div>
      )}
    </div>
  )
}

const NO_NESTED: ReadonlyMap<string, readonly NestedItem[]> = new Map()
const NO_CHILDREN: readonly NestedItem[] = []

/**
 * A tool row. Figma 59J: a subagent's row (Agent / Task, a Codex collab call) reads 子 agent · its task · ⌄ with how long
 * it ran at the end; what the subagent did is listed under it, after a line — open while it runs, closed once done.
 */
function Tool({
  item,
  waitingTool,
  nested = NO_NESTED
}: {
  item: Extract<ChatItem, { kind: 'tool' }>
  waitingTool: string | null
  nested?: ReadonlyMap<string, readonly NestedItem[]>
}) {
  const subagent = isSubagentTool(item.name)
  const children = (subagent && nested.get(item.id)) || NO_CHILDREN
  // null: as the row's state says (a subagent's open while it runs); a click decides from then on.
  const [chosen, setOpen] = useState<boolean | null>(null)
  const open = chosen ?? (subagent && item.state === 'running')
  const view = toolView(item, item.id === waitingTool)
  // Figma 59J: one block per file; a single file's path is on the row already.
  const files = item.files ?? (item.diff ? [item.diff] : [])
  const hasChildren = children.length > 0
  const expandable = view.expandable || hasChildren
  return (
    <div className={styles.tool} data-subagent={subagent || undefined}>
      <button type="button" className={styles.toolRow} aria-expanded={expandable ? open : undefined} disabled={!expandable} onClick={() => setOpen(!open)}>
        <StepMark>{view.status === 'done_unread' ? <ToolIconMark icon={view.icon} /> : <StatusGlyph status={view.status} />}</StepMark>
        <span className={styles.toolVerb} title={view.name}>
          {view.verb}
        </span>
        <span className={subagent ? styles.subagentArg : styles.toolArg}>{view.arg}</span>
        {subagent && expandable && <span className={styles.chevron}>{open ? <ChevronDown {...ICON} className={styles.rowChevron} /> : <ChevronRight {...ICON} className={styles.rowChevron} />}</span>}
        {view.added !== undefined && <span className={styles.added}>+{view.added}</span>}
        {view.removed !== undefined && <span className={styles.removed}>−{view.removed}</span>}
        {view.waiting && <span className={styles.waiting}>等你确认</span>}
        {view.exit !== undefined && <span className={styles.exit}>exit {view.exit}</span>}
        {subagent && <Elapsed item={item} />}
      </button>
      {hasChildren ? (
        open && (
          <div className={styles.subagentSteps} data-testid="gui-subagent-steps">
            {children.map((child) =>
              child.kind === 'text' ? (
                <p key={child.id} className={styles.subagentText}>
                  {child.text}
                </p>
              ) : child.kind === 'thinking' ? (
                <Thinking key={child.id} item={child} />
              ) : (
                <Tool key={child.id} item={child} nested={nested} waitingTool={waitingTool} />
              )
            )}
          </div>
        )
      ) : (
        <ToolBody item={item} open={open} files={files} view={view} />
      )}
    </div>
  )
}

/** Under a row: its summary while closed; open, its task list, its files' changes or its output. */
function ToolBody({ item, open, files, view }: { item: Extract<ChatItem, { kind: 'tool' }>; open: boolean; files: FileDiff[]; view: ToolView }) {
  return (
    <>
      {view.summary && !open && <p className={styles.toolSummary}>{view.summary}</p>}
      {open && item.todos && item.todos.length > 0 && <TodoList todos={item.todos} className={styles.todosInFeed} />}
      {open && !item.todos && (files.length > 0 || view.output || view.command) && (
        <div className={styles.codeWrap}>
          {files.length > 0 ? (
            <div className={styles.fileBlocks}>
              {files.map((file, i) => (
                <DiffBlock key={i} diff={file} header={files.length > 1} />
              ))}
            </div>
          ) : (
            <Output raw={item.output ?? ''} command={view.command} />
          )}
          <CopyButton
            text={() => (files.length > 0 ? diffText(files) : view.output?.trim() ? view.output : (view.command ?? ''))}
            label="复制输出"
            className={styles.cornerCopy}
          />
        </div>
      )}
    </>
  )
}

/**
 * A subagent row's time at its end: since it started while it runs (counted each second, only while the row is on
 * screen), its own duration once done.
 */
function Elapsed({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const running = item.state === 'running'
  const ref = useRef<HTMLSpanElement>(null)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const el = ref.current
    if (!running || !el) return
    let timer: number | undefined
    const stop = (): void => {
      window.clearInterval(timer)
      timer = undefined
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return stop()
      setNow(Date.now())
      timer ??= window.setInterval(() => setNow(Date.now()), 1000)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      stop()
    }
  }, [running])
  const label = subagentElapsed(item, now)
  return (
    <span ref={ref} className={styles.elapsed} data-testid="gui-subagent-time">
      {label}
    </span>
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
