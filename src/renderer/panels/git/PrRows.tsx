// Git · 变更's GitHub parts beyond the PR line (PRD F16 v1.63 / v1.78): the per-PR switches with what they are doing
// (Figma 29I) and, when 自动修复's brake stopped, the stopped row with its buttons (29G; shared with the base rows in
// BaseCiRow.tsx). Comment bodies are untrusted text: shown as plain text, quoted as data when sent.
//
// LEGACY: PrThreadRow, PrNotes and the helpers they use (inline PR threads, 标记已解决) are dead once ChangesView stops
// importing them (Figma 29 moves PR comments to the PR line's 让 Claude 处理); delete them together with that import.
import { Check, ChevronDown, ChevronRight, ExternalLink, TriangleAlert } from 'lucide-react'
import type { PrNote, PrStatus, PrThread } from '@shared/pull-requests'
import type { SessionId } from '@shared/types'
import { openPullRequest } from '../../pull-requests/actions'
import {
  agentIdle,
  agentName,
  declineFix,
  discardFix,
  prWantsFix,
  proceedAnyway,
  pushAnyway,
  retryFix,
  setAutoFix,
  setMergeWhenGreen,
  stopFix
} from '../../pull-requests/auto-fix'
import { brakeLabel } from '@shared/auto-fix-brakes'
import { automationText, mergeWhenGreenOn, stopActions, type FixRun, type FixScope } from '../../pull-requests/auto-fix-model'
import { setPrNotice, setThreadPicked, toggleNotes, usePullRequests } from '../../pull-requests/store'
import { useWorkspace } from '../../state/workspace'
import { Toggle } from '../../ui/Toggle'
import ci from './CiRows.module.css'
import styles from './GitView.module.css'

const ICON = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const

function projectRootOf(worktreePath: string): string | null {
  const state = useWorkspace.getState()
  const worktree = state.worktrees.find((w) => w.path === worktreePath)
  return state.projects.find((p) => p.id === worktree?.projectId)?.rootPath ?? null
}

/** 标记已解决 for one thread, as the user on GitHub. */
async function resolve(worktreePath: string, thread: PrThread): Promise<void> {
  const root = projectRootOf(worktreePath)
  if (!root) return
  const result = await window.tr.pr.resolveThreads({ root, worktree: worktreePath, threadIds: [thread.id], reply: '' })
  setPrNotice(worktreePath, result.ok ? { tone: 'muted', text: result.message } : { tone: result.reason === 'declined' ? 'muted' : 'error', text: result.message })
}

function Author({ login, bot }: { login: string; bot: boolean }) {
  return (
    <>
      <span className={styles.prAuthor}>{login}</span>
      {bot && <span className={styles.prTag}>bot</span>}
    </>
  )
}

/** An unresolved thread under its line: tick to send with 发给 …, resolve it, or open it on GitHub. */
export function PrThreadRow({ worktreePath, thread, changed, top, split = false, sessionId }: { worktreePath: string; thread: PrThread; changed: boolean; top: number; split?: boolean; sessionId: SessionId | null }) {
  const picked = usePullRequests((s) => !s.unpicked[thread.id])
  const first = thread.comments[0]!
  const replies = thread.comments.length - 1
  return (
    <div className={styles.prThread} style={{ top }} data-split={split || undefined} role="note" aria-label={`GitHub 评论 ${first.author.login} ${thread.path}:${thread.line ?? ''}`} data-thread-id={thread.id}>
      <div className={styles.commentHead}>
        <button
          type="button"
          role="checkbox"
          aria-checked={picked}
          aria-label={picked ? '发送时包含这条' : '发送时不包含这条'}
          className={styles.commentPick}
          onClick={() => setThreadPicked(thread.id, !picked)}
        >
          {picked && <Check size={10} strokeWidth={2.5} aria-hidden />}
        </button>
        <span className={styles.prSource}>GitHub</span>
        <Author login={first.author.login} bot={first.author.bot} />
        {replies > 0 && <span className={styles.prSource}>· 另有 {replies} 条回复</span>}
        <span className={styles.spacer} />
        {changed && (
          <span className={styles.prTag} title="这个文件在评论之后又有没提交的改动">
            可能已改
          </span>
        )}
      </div>
      <p className={styles.commentText} title={first.body}>
        {first.body}
      </p>
      <div className={styles.prActions}>
        <button type="button" className={styles.prAction} title="在 GitHub 上把这条评论标记为已解决（以你的账号）" onClick={() => void resolve(worktreePath, thread)}>
          标记已解决
        </button>
        {first.url && (
          <button type="button" className={styles.prAction} onClick={() => openPullRequest(sessionId, first.url)}>
            在 GitHub 打开
          </button>
        )}
      </div>
    </div>
  )
}

/** The worktree's agent session, for the rows' switches and words (the first Claude / Codex session of the worktree). */
export function useAgentOf(worktreePath: string) {
  return useWorkspace((s) => {
    const ids = new Set(s.worktrees.filter((w) => w.path === worktreePath).map((w) => w.id))
    return s.sessions.find((x) => ids.has(x.worktreeId) && (x.kind === 'claude' || x.kind === 'codex')) ?? null
  })
}

/** The brake stopped, or the base fails already (Figma 29G): an alert icon and the reason in primary text. */
export function FixStopLine({ run, note }: { run: Extract<FixRun, { kind: 'stopped' }>; note: string | null }) {
  const text = brakeLabel(run.decision)
  return (
    <p className={ci.stop} role="status" data-testid="fix-stop">
      <span className={ci.stopIcon}>
        <TriangleAlert size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={ci.text} title={note ? `${text}\n${note}` : text}>
        {text}
      </span>
    </p>
  )
}

/** The stopped row's buttons: 仍然推送 · 丢弃 · 让 Claude 重修, or for the base failing already 在这里修 · 不修. */
export function FixStopActions({ scope, worktreePath, run, agent }: { scope: FixScope; worktreePath: string; run: Extract<FixRun, { kind: 'stopped' }>; agent: string }) {
  const actions = stopActions(run)
  if (actions.kind === 'ask') {
    return (
      <div className={ci.actions} data-testid="fix-stop-actions">
        <button type="button" className={ci.action} onClick={() => proceedAnyway(scope, worktreePath)}>
          在这里修
        </button>
        <button type="button" className={ci.action} onClick={() => declineFix(scope, worktreePath)}>
          不修
        </button>
      </div>
    )
  }
  return (
    <div className={ci.actions} data-testid="fix-stop-actions">
      {actions.push && (
        <button type="button" className={ci.action} title="不管刹车，把这次修复推上去（先确认）" onClick={() => void pushAnyway(scope, worktreePath)}>
          仍然推送
        </button>
      )}
      {actions.discard && (
        <button type="button" className={ci.action} title="把分支退回修复开始前的提交" onClick={() => void discardFix(scope, worktreePath)}>
          丢弃
        </button>
      )}
      <button type="button" className={ci.action} data-primary="" onClick={() => void retryFix(scope, worktreePath)}>
        {`让 ${agent} 重修`}
      </button>
    </div>
  )
}

/** 停下 while the agent works on a fix. */
export function FixStopButton({ scope, worktreePath, run }: { scope: FixScope; worktreePath: string; run: FixRun | null | undefined }) {
  if (run?.kind !== 'fixing') return null
  return (
    <button type="button" className={ci.action} onClick={() => stopFix(scope, worktreePath)}>
      停下
    </button>
  )
}

/** 自动修复 · 通过后合并 (PRD F16 · L3, Figma 29I) and what they are doing; the stopped row when a brake stopped. Open PRs only. */
export function PrAutomationRow({ worktreePath, status }: { worktreePath: string; status: PrStatus }) {
  const stored = usePullRequests((s) => s.automation[worktreePath])
  const session = useAgentOf(worktreePath)
  const pr = status.pr
  if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) return null
  const state = stored?.number === pr.number ? stored : undefined
  const merging = mergeWhenGreenOn(status)
  const name = agentName(session)
  const words = automationText(state, status, { idle: agentIdle(session), wants: state?.autoFix === true && prWantsFix(worktreePath, status), name })
  const stopped = state?.run?.kind === 'stopped' ? state.run : null
  return (
    <>
      {stopped && <FixStopLine run={stopped} note={state?.note ?? null} />}
      <div className={ci.row} data-testid="pr-automation">
        <Toggle
          label="自动修复"
          checked={state?.autoFix === true}
          disabled={!session}
          title={session ? 'CI 失败或有新评论时，等 agent 空闲后让它修并提交，Wavi 检查后推送（用你的额度，每个 PR 有次数上限）' : '这个 worktree 没有 agent 会话'}
          onChange={(on) => setAutoFix(worktreePath, on)}
        />
        <span className={ci.label}>自动修复</span>
        <span className={ci.gap} />
        <Toggle
          label="通过后合并"
          checked={merging}
          disabled={!pr.details || pr.state === 'draft'}
          title={pr.state === 'draft' ? '草稿 PR 不能合并' : '检查通过后合并：仓库开了自动合并时由 GitHub 合并，否则 Wavi 开着时由 Wavi 合并'}
          onChange={(on) => void setMergeWhenGreen(worktreePath, on)}
        />
        <span className={ci.label}>通过后合并</span>
        <span className={ci.spacer} />
        {words.text && (
          <span className={ci.state} data-tone={words.tone} title={state?.note ? `${words.text}\n${state.note}` : words.text}>
            {words.text}
          </span>
        )}
        <FixStopButton scope="pr" worktreePath={worktreePath} run={state?.run} />
      </div>
      {stopped && <FixStopActions scope="pr" worktreePath={worktreePath} run={stopped} agent={name} />}
    </>
  )
}

/** PR 评论 · N: PR-level comments and review bodies, and threads not placed on a diff line. Collapsible. */
export function PrNotes({ worktreePath, notes, threads, sessionId }: { worktreePath: string; notes: readonly PrNote[]; threads: readonly PrThread[]; sessionId: SessionId | null }) {
  const closed = usePullRequests((s) => s.notesClosed[worktreePath] === true)
  const count = notes.length + threads.length
  if (count === 0) return null
  const Chevron = closed ? ChevronRight : ChevronDown
  return (
    <div className={styles.prNotes} data-testid="pr-notes">
      <button type="button" className={styles.prNotesHead} aria-expanded={!closed} onClick={() => toggleNotes(worktreePath)}>
        <Chevron {...ICON} />
        PR 评论 · {count}
        <span className={styles.spacer} />
        {threads.length > 0 && <span className={styles.prSource}>其中 {threads.length} 条不在改动的行上</span>}
      </button>
      {!closed && (
        <ul className={styles.prNoteList}>
          {threads.map((thread) => (
            <NoteItem
              key={thread.id}
              login={thread.comments[0]!.author.login}
              bot={thread.comments[0]!.author.bot}
              meta={`${thread.path}${thread.line ? `:${thread.line}` : ''}${thread.outdated ? ' · 已过时' : ''}`}
              body={thread.comments[0]!.body}
              url={thread.comments[0]!.url}
              sessionId={sessionId}
              onResolve={() => void resolve(worktreePath, thread)}
              threadId={thread.id}
            />
          ))}
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              login={note.author.login}
              bot={note.author.bot}
              meta={`${note.kind === 'review' ? '审阅' : '评论'} · ${note.createdAt.slice(11, 16)}`}
              body={note.body}
              url={note.url}
              sessionId={sessionId}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** `onResolve`: a thread not placed on a line (outdated after a fix, or on a line this diff does not show) can still be resolved here. */
function NoteItem({
  login,
  bot,
  meta,
  body,
  url,
  sessionId,
  onResolve,
  threadId
}: {
  login: string
  bot: boolean
  meta: string
  body: string
  url: string
  sessionId: SessionId | null
  onResolve?: () => void
  threadId?: string
}) {
  return (
    <li className={styles.prNote} data-thread-id={threadId}>
      <div className={styles.commentHead}>
        <Author login={login} bot={bot} />
        <span className={styles.spacer} />
        <span className={styles.prMeta}>{meta}</span>
        {onResolve && (
          <button type="button" className={styles.prAction} title="在 GitHub 上把这条评论标记为已解决（以你的账号）" onClick={onResolve}>
            标记已解决
          </button>
        )}
        {url && (
          <button type="button" className={styles.commentIcon} aria-label="在 GitHub 打开" onClick={() => openPullRequest(sessionId, url)}>
            <ExternalLink {...ICON} />
          </button>
        )}
      </div>
      <p className={styles.prNoteBody} title={body}>
        {body}
      </p>
    </li>
  )
}
