// Worktree view commands: switching to a worktree's session, the row's 更多 menu, delete and 清理. Every removal is
// confirmed, refused for the main checkout / a live session / uncommitted changes (main re-checks the last one), and
// only forced after a second confirmation when git itself says no.
import type { WorktreeRemoveResult } from '@shared/git-worktrees'
import type { AgentKind, ProjectId } from '@shared/types'
import { useWorkspace } from '../../state/workspace'
import { popupMenu, type MenuAnchor } from '../../ui/menu'
import { cleanupPlan, deleteBlocker, tildePath, type WorktreeRow } from './model'
import { patchRoot, worktreesOf } from './store'

const KIND_LABEL: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex', shell: '终端' }

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

function failureText(result: Exclude<WorktreeRemoveResult, { ok: true }>): string {
  switch (result.reason) {
    case 'dirty':
      return '有未提交的改动'
    case 'main':
      return '主目录不能删除'
    case 'unknown':
      return '它已经不在 git worktree 列表里'
    case 'git':
      return result.message ?? 'git 拒绝删除'
  }
}

/** Closes the (idle) sessions of a worktree whose folder is gone. */
function closeSessionsOf(row: WorktreeRow): void {
  const state = useWorkspace.getState()
  for (const session of row.sessions) state.closeSession(session.id)
}

async function removeOne(root: string, row: WorktreeRow): Promise<WorktreeRemoveResult> {
  const result = await window.tr.gitWorktrees.remove(root, row.info.path, false)
  if (result.ok) closeSessionsOf(row)
  return result
}

/** 更多 › 删除 worktree…: guard → confirm → `git worktree remove` → (git refused) second confirm → `--force`. */
export async function deleteWorktreeInteractive(root: string, row: WorktreeRow, refresh: () => Promise<void>): Promise<void> {
  const blocker = deleteBlocker(row)
  if (blocker) {
    patchRoot(root, { notice: `不能删除 ${row.name}：${blocker}` })
    return
  }
  const closing = row.sessions.length > 0 ? `这里的 ${row.sessions.length} 个会话会一起关闭。` : ''
  const confirmed = await window.tr.ui.confirm({
    message: `删除 worktree「${row.name}」？`,
    detail: `会删除文件夹 ${tildePath(row.info.path, window.tr.homeDir)}，分支保留。${closing}`,
    confirmLabel: '删除',
    destructive: true
  })
  if (!confirmed) return
  patchRoot(root, { busy: true, notice: null })
  try {
    let result = await removeOne(root, row)
    if (!result.ok && result.reason === 'git') {
      const force = await window.tr.ui.confirm({
        message: `git 拒绝删除「${row.name}」`,
        detail: `${result.message ?? ''}\n\n没有未提交的改动。强制删除会连同其中被忽略的文件一起删掉。`,
        confirmLabel: '强制删除',
        destructive: true
      })
      if (force) {
        result = await window.tr.gitWorktrees.remove(root, row.info.path, true)
        if (result.ok) closeSessionsOf(row)
      }
    }
    patchRoot(root, { notice: result.ok ? `已删除 ${row.name}` : `没有删除 ${row.name}：${failureText(result)}` })
  } catch {
    patchRoot(root, { notice: `没有删除 ${row.name}：出错了` })
  } finally {
    patchRoot(root, { busy: false })
    await refresh()
  }
}

/** 可清理 › 清理: one confirmation listing what goes (and what stays and why), then remove them one by one. */
export async function cleanUpInteractive(root: string, rows: readonly WorktreeRow[], refresh: () => Promise<void>): Promise<void> {
  const plan = cleanupPlan(rows)
  const skipped = plan.skip.map(({ row, reason }) => `${row.name}（${reason}）`)
  if (plan.remove.length === 0) {
    patchRoot(root, { notice: skipped.length > 0 ? `没有可以清理的：${skipped.join('；')}` : '没有可以清理的 worktree' })
    return
  }
  const listed = plan.remove.map((row) => `· ${row.name}  ${tildePath(row.info.path, window.tr.homeDir)}`).join('\n')
  const confirmed = await window.tr.ui.confirm({
    message: `清理 ${plan.remove.length} 个 worktree？`,
    detail: `${listed}\n\n文件夹会被删除，分支保留。${skipped.length > 0 ? `\n跳过：${skipped.join('；')}` : ''}`,
    confirmLabel: '清理',
    destructive: true
  })
  if (!confirmed) return
  patchRoot(root, { busy: true, notice: null })
  const failed: string[] = []
  let removed = 0
  try {
    for (const row of plan.remove) {
      const result = await removeOne(root, row).catch((): WorktreeRemoveResult => ({ ok: false, reason: 'git', message: '出错了' }))
      if (result.ok) removed++
      else failed.push(`${row.name}（${failureText(result)}）`)
    }
  } finally {
    patchRoot(root, {
      busy: false,
      notice: failed.length > 0 ? `已清理 ${removed} 个；没删掉：${failed.join('；')}` : `已清理 ${removed} 个 worktree`
    })
    await refresh()
  }
}

/** The selected row's 更多: 在此新建会话 · 复制路径 · 删除 worktree…. */
export async function openRowMenu(
  projectId: ProjectId,
  root: string,
  row: WorktreeRow,
  anchor: MenuAnchor,
  refresh: () => Promise<void>
): Promise<void> {
  const kinds: AgentKind[] = ['claude', 'codex', 'shell']
  const choice = await popupMenu(
    [
      {
        type: 'submenu',
        label: '在此新建会话',
        items: kinds.map((kind) => ({ type: 'item', id: `new:${kind}`, label: KIND_LABEL[kind], enabled: !row.info.prunable }))
      },
      { type: 'item', id: 'copy-path', label: '复制路径' },
      { type: 'separator' },
      { type: 'item', id: 'delete', label: '删除 worktree…', enabled: !row.info.isMain && !worktreesOf(root).busy }
    ],
    anchor
  )
  if (choice === 'copy-path') void navigator.clipboard.writeText(row.info.path).catch(() => {})
  else if (choice === 'delete') await deleteWorktreeInteractive(root, row, refresh)
  else if (choice?.startsWith('new:')) startSessionIn(projectId, row, choice.slice(4) as AgentKind)
}
