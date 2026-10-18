// The new-session sheet's decisions (PRD F4, Figma 15), kept apart from React so they can be tested: what 创建 does
// with the form, what blocks it, and the few lines of copy the sheet shows only when something is limited or wrong.
import {
  branchNameProblem,
  folderNameFor,
  type BranchNameProblem,
  type NewSessionBranch,
  type NewSessionInfo,
  type Workdir,
  type WorktreeCreateRequest,
  type WorktreeCreateResult
} from '@shared/new-session'

export interface SheetForm {
  workdir: Workdir
  /** 基于: a branch name from NewSessionInfo.branches. */
  base: string | null
  /** 高级 · 分支名 (generated until the user types). */
  branch: string
  /** 高级 · 准备 */
  prepare: boolean
}

export type CreatePlan =
  /** 当前目录: a session in the project's main checkout, git untouched. */
  | { type: 'current' }
  /** 基于 is a branch another worktree has out: another session in that worktree. */
  | { type: 'existing'; path: string; branch: string }
  /** 新 worktree: created in the background; the session waits for it. */
  | { type: 'worktree'; path: string; request: WorktreeCreateRequest }

/** The base branch the form points at, when it is still in the list. */
export function selectedBase(info: NewSessionInfo, form: Pick<SheetForm, 'base'>): NewSessionBranch | null {
  return info.branches.find((b) => b.name === form.base) ?? null
}

/** A local branch checked out in a linked worktree: picking it opens that worktree instead (15C). */
export const isElsewhere = (branch: NewSessionBranch | null): branch is NewSessionBranch & { worktreePath: string } =>
  branch !== null && !branch.remote && branch.worktreePath !== null && !branch.inMainCheckout

/** Folder name the new worktree gets for the branch name in the form. */
export function folderFor(info: NewSessionInfo, branch: string): string {
  return folderNameFor(branch, new Set(info.takenFolders))
}

/**
 * What 创建 does, or why it cannot (`info` is null while the project's git state is loading; a 当前目录 session needs
 * none of it).
 */
export function planCreate(
  root: string,
  info: NewSessionInfo | null,
  form: SheetForm
): { plan: CreatePlan; problem: null } | { plan: null; problem: BranchNameProblem | 'loading' | 'no-base' } {
  if (form.workdir === 'current' || info?.repo === false) return { plan: { type: 'current' }, problem: null }
  if (!info) return { plan: null, problem: 'loading' }
  const base = selectedBase(info, form)
  if (!base) return { plan: null, problem: 'no-base' }
  if (isElsewhere(base)) return { plan: { type: 'existing', path: base.worktreePath, branch: base.name }, problem: null }
  const problem = branchNameProblem(form.branch, info.branches)
  if (problem) return { plan: null, problem }
  const folder = folderFor(info, form.branch)
  return {
    plan: {
      type: 'worktree',
      path: `${info.worktreesDir}/${folder}`,
      request: { root, branch: form.branch, base: base.name, folder, prepare: form.prepare }
    },
    problem: null
  }
}

/** Under the 分支名 field when the name cannot be used (15E); null otherwise. */
export function branchProblemText(problem: BranchNameProblem | null, name: string): string | null {
  switch (problem) {
    case 'exists':
      return `分支 ${name} 已经存在。换个名字，或在「基于」里直接选它`
    case 'invalid':
      return 'git 不接受这个分支名：不能有空格和 ~ ^ : ? * [ \\，不能以 - 开头'
    case 'empty':
      return '分支名不能为空'
    default:
      return null
  }
}

/** 准备 row: what it would copy (setup scripts come with `.tr/settings.toml`); null when there is nothing to do. */
export function prepareText(info: Pick<NewSessionInfo, 'includeFiles' | 'includeCount'>): string | null {
  if (info.includeCount === 0) return null
  const shown = info.includeFiles.slice(0, 2).join('、')
  return info.includeCount > 2 ? `复制 ${shown} 等 ${info.includeCount} 项` : `复制 ${shown}`
}

/** `/Users/x/…` → `~/…` for display. */
export function tilde(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
}

/** One line for a session whose worktree could not be created (shown in its error bar). */
export function createFailureText(result: Exclude<WorktreeCreateResult, { ok: true }>): string {
  switch (result.reason) {
    case 'branch-exists':
      return '分支已经存在'
    case 'folder-exists':
      return '文件夹已经存在'
    case 'base-missing':
      return '找不到「基于」的分支'
    case 'not-a-repo':
      return '项目文件夹不是 git 仓库'
    case 'invalid':
      return '参数无效'
    case 'git':
      return result.message?.split('\n').find((line) => line.trim() !== '')?.replace(/^fatal:\s*/, '') ?? 'git 出错了'
  }
}
