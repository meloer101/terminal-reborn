// Worktree view commands: switching to a worktree's session, the row's 更多 menu, delete and 清理. Every removal is
// confirmed and refused whenever work could be lost (see deleteBlocker; main checks again). `--force` is offered in a
// second confirmation only for git's submodule refusal.
import type { WorktreeRemoveResult } from '@shared/git-worktrees'
import type { AgentKind, ProjectId, WorktreeId } from '@shared/types'
import { restoreArchivedWorktree } from '../../archive/actions'
import { openArchiveSheet } from '../../archive/store'
import { useWorkspace } from '../../state/workspace'
import { disposeTerminal } from '../../terminal/registry'
import { popupMenu, type MenuAnchor } from '../../ui/menu'
import { cleanupPlan, deleteBlocker, keptText, tildePath, type WorktreeRow } from './model'
import { patchRoot, worktreesOf } from './store'

const KIND_LABEL: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex', shell: '终端' }

/** Said in every delete confirmation: a plain `git worktree remove` takes ignored files with it. */
const IGNORED_FILES_NOTE = '被 .gitignore 忽略的文件（如 .env、node_modules）也会一起删除。'

/** Click on a row: show it expanded, and switch to its most urgent session (a worktree without one only expands). */
export function selectRow(root: string, row: WorktreeRow): void {
  patchRoot(root, { picked: row.key, notice: null })
  const state = useWorkspace.getState()
  const active = state.sessions.find((s) => s.id === state.activeSessionId)
  const target = row.sessions[0]
  if (target && !(active && row.worktreeIds.includes(active.worktreeId))) state.setActiveSession(target.id)
}

export function startSessionIn(projectId: ProjectId, row: WorktreeRow, kind: AgentKind): void {
  useWorkspace.getState().addSessionInWorktree(projectId, { path: row.openPath, branch: row.info.branch ?? '' }, kind)
}

export function removeFailureText(result: Exclude<WorktreeRemoveResult, { ok: true }>): string {
  switch (result.reason) {
    case 'dirty':
      return '有未提交的改动'
    case 'unverified':
      return '无法确认有没有会丢的改动或提交'
    case 'unreachable-commits':
      return `有 ${result.message ?? ''} 个提交不在任何分支上`
    case 'busy':
      return '正在变基'
    case 'locked':
      return '已被锁定'
    case 'main':
      return '主目录不能删除'
    case 'unknown':
      return '它已经不在 git worktree 列表里'
    case 'submodules':
      return '含有子模块'
    case 'git':
      return result.message ?? 'git 拒绝删除'
  }
}

/** The row's sessions as the store has them now (a dialog was open meanwhile). */
function freshRow(row: WorktreeRow): WorktreeRow {
  const ids = new Set(row.worktreeIds)
  return { ...row, sessions: useWorkspace.getState().sessions.filter((s) => ids.has(s.worktreeId)) }
}

/**
 * Ends the worktree's terminals before its folder goes, then removes it; the records go only once it is gone.
 * Also used after a local merge (F4) that was asked to remove the worktree.
 */
export async function removeWorktreeWithSessions(
  root: string,
  path: string,
  worktreeIds: readonly WorktreeId[],
  force = false
): Promise<WorktreeRemoveResult> {
  const ids = new Set(worktreeIds)
  const sessions = useWorkspace.getState().sessions.filter((s) => ids.has(s.worktreeId))
  for (const session of sessions) disposeTerminal(session.id, true)
  const result = await window.tr.gitWorktrees.remove(root, path, force)
  const state = useWorkspace.getState()
  if (result.ok) state.forgetWorktrees([...worktreeIds])
  // Their terminals are gone either way (the confirmation said they close); the folder's record stays if it does.
  else for (const session of sessions) state.closeSession(session.id)
  return result
}

const removeOne = (root: string, row: WorktreeRow, force = false): Promise<WorktreeRemoveResult> =>
  removeWorktreeWithSessions(root, row.info.path, row.worktreeIds, force)

/** 更多 › 删除 worktree…: guard → confirm → guard again → `git worktree remove` → (submodules) second confirm → `--force`. */
export async function deleteWorktreeInteractive(root: string, row: WorktreeRow, refresh: () => Promise<void>): Promise<void> {
  const blocker = deleteBlocker(row)
  if (blocker) {
    patchRoot(root, { notice: `不能删除 ${row.name}：${blocker}` })
    return
  }
  const closing = row.sessions.length > 0 ? `这里的 ${row.sessions.length} 个会话会一起关闭。` : ''
  const confirmed = await window.tr.ui.confirm({
    message: `删除 worktree「${row.name}」？`,
    detail: `会删除文件夹 ${tildePath(row.openPath, window.tr.homeDir)}，${keptText(row.info)}。${IGNORED_FILES_NOTE}${closing}`,
    confirmLabel: '删除',
    destructive: true
  })
  if (!confirmed) return
  const current = freshRow(row)
  const late = deleteBlocker(current)
  if (late) {
    patchRoot(root, { notice: `不能删除 ${row.name}：${late}` })
    return
  }
  patchRoot(root, { busy: true, notice: null })
  try {
    let result = await removeOne(root, current)
    if (!result.ok && result.reason === 'submodules') {
      const force = await window.tr.ui.confirm({
        message: `「${row.name}」含有子模块，git 不肯直接删除`,
        detail: `已确认没有未提交的改动。强制删除会连同子模块的文件夹一起删掉。${IGNORED_FILES_NOTE}`,
        confirmLabel: '强制删除',
        destructive: true
      })
      if (force) result = await removeOne(root, current, true)
    }
    patchRoot(root, { notice: result.ok ? `已删除 ${row.name}` : `没有删除 ${row.name}：${removeFailureText(result)}` })
  } catch {
    patchRoot(root, { notice: `没有删除 ${row.name}：出错了` })
  } finally {
    patchRoot(root, { busy: false })
    await refresh()
  }
}

/**
 * 可清理 › 清理: one confirmation listing what goes (and what stays and why), then remove them one by one. Rows with a
 * session are never part of it (cleanupPlan), checked again after the dialog.
 */
export async function cleanUpInteractive(root: string, rows: readonly WorktreeRow[], refresh: () => Promise<void>): Promise<void> {
  const plan = cleanupPlan(rows)
  const skipped = plan.skip.map(({ row, reason }) => `${row.name}（${reason}）`)
  if (plan.remove.length === 0) {
    patchRoot(root, { notice: skipped.length > 0 ? `没有可以清理的：${skipped.join('；')}` : '没有可以清理的 worktree' })
    return
  }
  const listed = plan.remove.map((row) => `· ${row.name}  ${tildePath(row.openPath, window.tr.homeDir)}`).join('\n')
  const confirmed = await window.tr.ui.confirm({
    message: `清理 ${plan.remove.length} 个 worktree？`,
    detail: `${listed}\n\n文件夹会被删除，分支保留。${IGNORED_FILES_NOTE}${skipped.length > 0 ? `\n跳过：${skipped.join('；')}` : ''}`,
    confirmLabel: '清理',
    destructive: true
  })
  if (!confirmed) return
  patchRoot(root, { busy: true, notice: null })
  const failed: string[] = []
  let removed = 0
  try {
    for (const row of plan.remove) {
      const current = freshRow(row)
      if (current.sessions.length > 0) {
        failed.push(`${row.name}（有会话）`)
        continue
      }
      const result = await removeOne(root, current).catch((): WorktreeRemoveResult => ({ ok: false, reason: 'git', message: '出错了' }))
      if (result.ok) removed++
      else failed.push(`${row.name}（${removeFailureText(result)}）`)
    }
  } finally {
    patchRoot(root, {
      busy: false,
      notice: failed.length > 0 ? `已清理 ${removed} 个；没删掉：${failed.join('；')}` : `已清理 ${removed} 个 worktree`
    })
    await refresh()
  }
}

/** The selected row's 更多: 在此新建会话 · 复制路径 · 归档… (or 恢复归档) · 删除 worktree…. */
export async function openRowMenu(
  projectId: ProjectId,
  root: string,
  row: WorktreeRow,
  anchor: MenuAnchor,
  refresh: () => Promise<void>
): Promise<void> {
  const kinds: AgentKind[] = ['claude', 'codex', 'shell']
  const archivedId = useWorkspace.getState().worktrees.find((w) => row.worktreeIds.includes(w.id) && w.archived)?.id
  const choice = await popupMenu(
    [
      {
        type: 'submenu',
        label: '在此新建会话',
        items: kinds.map((kind) => ({ type: 'item', id: `new:${kind}`, label: KIND_LABEL[kind], enabled: row.info.prunable === null }))
      },
      { type: 'item', id: 'copy-path', label: '复制路径' },
      { type: 'separator' },
      archivedId
        ? { type: 'item', id: 'restore', label: '恢复归档' }
        : { type: 'item', id: 'archive', label: '归档…', enabled: !row.info.isMain && row.worktreeIds.length > 0 },
      { type: 'item', id: 'delete', label: '删除 worktree…', enabled: !row.info.isMain && !worktreesOf(root).busy }
    ],
    anchor
  )
  if (choice === 'copy-path') void navigator.clipboard.writeText(row.openPath).catch(() => {})
  else if (choice === 'archive' && row.worktreeIds[0]) openArchiveSheet(row.worktreeIds[0])
  else if (choice === 'restore' && archivedId) {
    await restoreArchivedWorktree(archivedId).catch((error: unknown) =>
      patchRoot(root, { notice: `没能恢复：${error instanceof Error ? error.message : String(error)}` })
    )
  }
  else if (choice === 'delete') await deleteWorktreeInteractive(root, row, refresh)
  else if (choice?.startsWith('new:')) startSessionIn(projectId, row, choice.slice(4) as AgentKind)
}
