// Git · 变更's GitHub parts beyond the PR line (PRD F16 v1.63, Figma 22B): an unresolved review thread on its diff
// line (PrThread 366:14568), the two per-PR switches with what they are doing (22E), and the PR's own comments and
// review bodies, plus the threads GitHub can no longer place (PrNote 366:14589). Comment bodies are untrusted text:
// shown as plain text, quoted as data when sent.
import { Check, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import type { PrNote, PrStatus, PrThread } from '@shared/pull-requests'
import type { SessionId } from '@shared/types'
import { openPullRequest } from '../../pull-requests/actions'
import { agentIdle, setAutoFix, setMergeWhenGreen } from '../../pull-requests/auto-fix'
import { automationText, mergeWhenGreenOn } from '../../pull-requests/auto-fix-model'
import { setPrNotice, setThreadPicked, toggleNotes, usePullRequests } from '../../pull-requests/store'
import { useWorkspace } from '../../state/workspace'
import { Toggle } from '../../ui/Toggle'
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

/** 自动修复 · 通过后合并 (PRD F16 · L3) and what they are doing. Open PRs only. */
export function PrAutomationRow({ worktreePath, status }: { worktreePath: string; status: PrStatus }) {
  const state = usePullRequests((s) => s.automation[worktreePath])
  const session = useWorkspace((s) => {
    const ids = new Set(s.worktrees.filter((w) => w.path === worktreePath).map((w) => w.id))
    return s.sessions.find((x) => ids.has(x.worktreeId) && (x.kind === 'claude' || x.kind === 'codex')) ?? null
  })
  const pr = status.pr
  if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) return null
  const merging = mergeWhenGreenOn(status)
  const words = automationText(state?.number === pr.number ? state : undefined, status, agentIdle(session))
  return (
    <div className={styles.prRow} data-testid="pr-automation">
      <Toggle
        label="自动修复"
        checked={state?.number === pr.number && state.autoFix}
        disabled={!session}
        title={session ? 'CI 失败或有新评论时，等 agent 空闲后自动发给它并按回车（用你的额度，每个 PR 有次数上限）' : '这个 worktree 没有 agent 会话'}
        onChange={(on) => setAutoFix(worktreePath, on)}
      />
      <span className={styles.prRowLabel}>自动修复</span>
      <span className={styles.prGap} />
      <Toggle
        label="通过后合并"
        checked={merging}
        disabled={!pr.details || pr.state === 'draft'}
        title={pr.state === 'draft' ? '草稿 PR 不能合并' : '检查通过后合并：仓库开了自动合并时由 GitHub 合并，否则 Wavi 开着时由 Wavi 合并'}
        onChange={(on) => void setMergeWhenGreen(worktreePath, on)}
      />
      <span className={styles.prRowLabel}>通过后合并</span>
      <span className={styles.spacer} />
      {words.text && (
        <span className={styles.prRowState} data-tone={words.tone} title={words.text}>
          {words.text}
        </span>
      )}
    </div>
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

function NoteItem({ login, bot, meta, body, url, sessionId }: { login: string; bot: boolean; meta: string; body: string; url: string; sessionId: SessionId | null }) {
  return (
    <li className={styles.prNote}>
      <div className={styles.commentHead}>
        <Author login={login} bot={bot} />
        <span className={styles.spacer} />
        <span className={styles.prMeta}>{meta}</span>
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
