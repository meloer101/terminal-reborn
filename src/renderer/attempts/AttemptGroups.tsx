// 一题多解 in the overview (PRD F9 v1.59; no Figma frame yet — drawn like the overview's groups and rows): one row per
// attempt group above the status groups — the task, the base, every member as its status glyph and name — with 比较
// (the overlay with the members side by side) and, once one was merged, 归档其余 N 份 (asks first). In the overlay each
// member's window gets a compare bar under its title bar: what it changed, the checks it ran, how its launch went,
// 看 diff and 合并这个. Status is the glyph's shape plus text, never color alone.
import { memo, useEffect, useMemo, useState } from 'react'
import { AlertCircle, GitCompareArrows, GitMerge } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  diffSummary,
  diffSummaryText,
  groupShown,
  memberLabels,
  promptPreview,
  remainingMembers,
  type AttemptAgent,
  type AttemptGroup,
  type DiffSummary
} from '@shared/attempt-groups'
import type { Session, SessionId } from '@shared/types'
import { glyphStatus } from '../lifecycle/present'
import { GROUP_LABEL } from '../overview/model'
import { showCompare } from '../overview/store'
import enterStyles from '../overview/EnterButton.module.css'
import { useAttemptGroups, type MemberLaunch } from '../state/attempt-groups'
import { useWorkspace } from '../state/workspace'
import { TurnChecksTag } from '../turn-checks/TurnChecksTag'
import { StatusGlyph } from '../ui/StatusGlyph'
import { archiveRemaining, mergeMember, openMemberDiff, remainingBranches, resend } from './actions'
import styles from './AttemptGroups.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
const DIFF_POLL_MS = 4000

interface MemberView {
  session: Session
  label: string
  branch: string
  path: string
}

/** The group's members still listed, each with its name in the group (`Claude Code 1`, `Codex`) and branch. */
function useMembers(group: AttemptGroup | undefined): MemberView[] {
  const { sessions, worktrees } = useWorkspace(useShallow((s) => ({ sessions: s.sessions, worktrees: s.worktrees })))
  return useMemo(() => {
    if (!group) return []
    const found = group.members.flatMap((id) => {
      const session = sessions.find((x) => x.id === id)
      const worktree = session && worktrees.find((w) => w.id === session.worktreeId)
      return session && worktree && !worktree.archived ? [{ session, worktree }] : []
    })
    const labels = memberLabels(found.map((m): AttemptAgent => (m.session.kind === 'codex' ? 'codex' : 'claude')))
    return found.map((m, i) => ({ session: m.session, label: labels[i] ?? '', branch: m.worktree.branch, path: m.worktree.path }))
  }, [group, sessions, worktrees])
}

const listedIn = (members: readonly MemberView[]) => (id: SessionId) => members.some((m) => m.session.id === id)

export function AttemptGroups() {
  const groups = useAttemptGroups((s) => s.groups)
  const { sessions, worktrees } = useWorkspace(useShallow((s) => ({ sessions: s.sessions, worktrees: s.worktrees })))
  const listed = useMemo(() => {
    const archived = new Set(worktrees.filter((w) => w.archived).map((w) => w.id))
    return new Set(sessions.filter((x) => !archived.has(x.worktreeId)).map((x) => x.id))
  }, [sessions, worktrees])
  const shown = groups.filter((g) => groupShown(g, (id) => listed.has(id)))
  if (shown.length === 0) return null
  return (
    <section className={styles.section} aria-label="一题多解" data-testid="attempt-groups">
      <div className={styles.header}>
        <h2>一题多解</h2>
        <span className={styles.count}>{shown.length}</span>
      </div>
      {shown.map((g) => (
        <GroupRow key={g.id} group={g} />
      ))}
    </section>
  )
}

function GroupRow({ group }: { group: AttemptGroup }) {
  const members = useMembers(group)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const left = remainingMembers(group, listedIn(members))
  const comparable = members.filter((m) => m.session.id !== group.merged?.sessionId)

  const archive = async (): Promise<void> => {
    setBusy(true)
    setNotice(null)
    const result = await archiveRemaining(group)
    setBusy(false)
    if (result.failures.length > 0) setNotice(`没有归档：${result.failures.join('；')}`)
  }

  return (
    <div className={styles.row} data-group-id={group.id} data-testid="attempt-group">
      <span className={styles.icon}>
        <GitCompareArrows {...ICON} />
      </span>
      <span className={styles.task} title={group.prompt}>
        {promptPreview(group.prompt)}
      </span>
      <span className={styles.base}>基于 {group.base}</span>
      <span className={styles.members}>
        {members.map((m) => {
          const status = glyphStatus(m.session)
          const text = `${m.label} · ${GROUP_LABEL[status]} · ${m.branch}`
          return (
            <span key={m.session.id} className={styles.member} title={text} aria-label={text} data-member-id={m.session.id}>
              <StatusGlyph status={status} />
              <span>{m.label}</span>
            </span>
          )
        })}
      </span>
      {group.merged && (
        <span className={styles.merged}>
          <GitMerge size={12} strokeWidth={2} aria-hidden />
          已合并 {group.merged.branch}
        </span>
      )}
      {notice && (
        <span className={styles.notice} role="status">
          {notice}
        </span>
      )}
      <span className={styles.spacer} />
      {group.merged && left.length > 0 && (
        <button
          type="button"
          className={enterStyles.enter}
          disabled={busy}
          title={`先确认，再归档 ${remainingBranches(group).map((b) => b.branch).join('、')}；可以在跳转（⌘K）的历史里恢复`}
          onClick={() => void archive()}
        >
          {busy ? '正在归档…' : `归档其余 ${left.length} 份`}
        </button>
      )}
      {comparable.length > 0 && (
        <button
          type="button"
          className={enterStyles.enter}
          title="在浮层里并排看这几份的终端、改动和检查"
          onClick={() => showCompare(group.id, comparable.map((m) => m.session.id))}
        >
          比较
        </button>
      )}
    </div>
  )
}

/** What a member's worktree changed against the base: `+12 −3 · 2 个文件`, polled while it is on screen. */
function useDiffSummary(path: string | undefined, base: string): DiffSummary | 'error' | null {
  const [summary, setSummary] = useState<DiffSummary | 'error' | null>(null)
  useEffect(() => {
    if (!path) return
    let live = true
    const load = (): void => {
      window.tr.git
        .changes(path, base)
        .then((changes) => live && setSummary(changes ? diffSummary(changes) : 'error'))
        .catch(() => live && setSummary('error'))
    }
    load()
    const timer = window.setInterval(load, DIFF_POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [path, base])
  return summary
}

const LAUNCH_TEXT: Record<Exclude<MemberLaunch['phase'], 'failed'>, string | null> = {
  creating: '正在创建 worktree…',
  starting: '等 agent 启动后发送…',
  sending: '正在发送…',
  sent: null
}

/** The bar under a member's title bar in the compare overlay. */
export const CompareBar = memo(function CompareBar({ groupId, sessionId }: { groupId: string; sessionId: SessionId }) {
  const group = useAttemptGroups((s) => s.groups.find((g) => g.id === groupId))
  const launch = useAttemptGroups((s) => s.launches[sessionId])
  const members = useMembers(group)
  const member = members.find((m) => m.session.id === sessionId)
  const diff = useDiffSummary(member?.path, group?.base ?? '')
  if (!group || !member) return null
  const merged = group.merged?.sessionId === sessionId
  const launchText = launch && launch.phase !== 'failed' ? LAUNCH_TEXT[launch.phase] : null
  return (
    <div className={styles.compare} data-testid="attempt-compare" data-member-id={sessionId}>
      <span className={styles.compareLabel}>{member.label}</span>
      <span className={styles.diff} data-testid="attempt-diff">
        {diff === null ? '…' : diff === 'error' ? '读不出改动' : diffSummaryText(diff)}
      </span>
      <TurnChecksTag sessionId={sessionId} />
      {launchText && <span className={styles.launch}>{launchText}</span>}
      {launch?.phase === 'failed' && (
        <span className={styles.failed} role="status" title={launch.message}>
          <AlertCircle size={12} strokeWidth={2} aria-hidden />
          没发出去：{launch.message}
        </span>
      )}
      <span className={styles.spacer} />
      {launch?.phase === 'failed' && (
        <button type="button" className={enterStyles.enter} title="把任务再发给这一份一次（用你自己的额度）" onClick={() => resend(sessionId)}>
          再发一次
        </button>
      )}
      <button type="button" className={enterStyles.enter} title="进入这个会话，打开 Git · 变更" onClick={() => openMemberDiff(sessionId)}>
        看 diff
      </button>
      {merged ? (
        <span className={styles.mergedTag}>
          <GitMerge size={12} strokeWidth={2} aria-hidden />
          已合并
        </span>
      ) : (
        <button type="button" className={enterStyles.enter} title={`把 ${member.branch} 合并到 ${group.base}（先预检）`} onClick={() => mergeMember(sessionId)}>
          合并这个
        </button>
      )}
    </div>
  )
})
