// The new-session sheet's decisions (PRD F4, Figma 15), kept apart from React so they can be tested: what 创建 does
// with the form, what blocks it, and the few lines of copy the sheet shows only when something is limited or wrong.
import { AGENT_SPECS, agentName, CLI_AGENTS, isCliAgent, type CliAgent } from '@shared/agents'
import { guiAvailability, type GuiAvailability } from '@shared/gui-agents'
import type { AgentAvailability } from '@shared/ipc'
import type { AgentKind, SessionUi } from '@shared/types'
import type { MenuEntry } from '../ui/menu-model'
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

/** 准备 row: what it would copy and whether it runs the setup script (PRD F4); null when there is nothing to do. */
export function prepareText(info: Pick<NewSessionInfo, 'includeFiles' | 'includeCount' | 'hasSetup'>): string | null {
  const setup = info.hasSetup ? '运行 setup 脚本' : null
  if (info.includeCount === 0) return setup
  const shown = info.includeFiles.slice(0, 2).join('、')
  const copy = info.includeCount > 2 ? `复制 ${shown} 等 ${info.includeCount} 项` : `复制 ${shown}`
  return setup ? `${copy}，${setup}` : copy
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

// --- 界面 (PRD F23, Figma 49″A / 49″B) ----------------------------------------------------------------------------

/** Whether a binary is on the login shell's PATH, from what main reported for the agent CLIs and the ACP adapters. */
export function binaryInstalled(found: AgentAvailability | null): (binary: string) => boolean {
  return (binary) => found?.adapters?.[binary] === true || CLI_AGENTS.some((id) => AGENT_SPECS[id].binary === binary && found?.[id] === true)
}

export interface UiRow {
  /** The 界面 the session gets: the choice, unless the agent cannot run as GUI. */
  value: SessionUi
  /** The GUI segment is off: the agent has no GUI, or its adapter is missing. */
  guiDisabled: boolean
  /** Hover text of the disabled GUI segment (CLI only, Figma 49″B). */
  guiTitle?: string
  /** The adapter to install first (Figma 49″B: 「GUI 要先装 amp-acp」 + 复制安装命令). */
  adapter?: { binary: string; install: string }
  /** The value is CLI because GUI was not possible, not because it was chosen: it is not remembered. */
  forced: boolean
}

/** The 界面 row for an agent (null for a plain terminal, which has no GUI). `choice` is the user's (or remembered) pick. */
export function uiRow(kind: AgentKind, choice: SessionUi, installed: (binary: string) => boolean): UiRow | null {
  if (kind === 'shell') return null
  const availability: GuiAvailability = guiAvailability(kind, installed)
  if (availability.kind === 'available') return { value: choice, guiDisabled: false, forced: false }
  const forced = choice === 'gui'
  if (availability.kind === 'needs-adapter') {
    return { value: 'cli', guiDisabled: true, adapter: { binary: availability.binary, install: availability.install }, forced }
  }
  return { value: 'cli', guiDisabled: true, guiTitle: availability.reason, forced }
}

/** 已安装: Claude Code and Codex always (a missing one says so in the terminal), every other CLI only when it is on PATH. */
export function listedAgents(found: AgentAvailability | null): AgentKind[] {
  return CLI_AGENTS.filter((id) => id === 'claude' || id === 'codex' || found?.[id] === true)
}

/**
 * 在此新建会话 (a session's right-click, a Worktree row's 更多; Figma 58C): every agent, in 新建会话's order — 已安装,
 * then 没装 drawn grey (choosing one opens 设置 · 智能体, where its install command is) — in a list of fixed height,
 * and 终端 under it. Item ids are `${prefix}${kind}` and `${prefix}install:${agent}`; `enabled` covers the ones that
 * start a session.
 */
export function hereMenu(found: AgentAvailability | null, prefix: string, enabled = true): Extract<MenuEntry, { type: 'submenu' }> {
  const installed = listedAgents(found)
  const missing = CLI_AGENTS.filter((id) => !installed.includes(id))
  const start = (kind: AgentKind): MenuEntry => ({ type: 'item', id: `${prefix}${kind}`, label: agentName(kind), ...(enabled ? {} : { enabled: false }) })
  return {
    type: 'submenu',
    label: '在此新建会话',
    items: [
      { type: 'header', label: '已安装' },
      ...installed.map(start),
      ...(missing.length > 0
        ? [
            { type: 'separator' } as const,
            { type: 'header', label: '没装' } as const,
            ...missing.map((id): MenuEntry => ({ type: 'item', id: `${prefix}install:${id}`, label: agentName(id), muted: true }))
          ]
        : [])
    ],
    footer: [{ type: 'separator' }, start('shell')]
  }
}

/** What a 在此新建会话 choice asks for: a session of `kind`, or how to install `install`; null for another id. */
export function hereChoice(choice: string | null, prefix: string): { kind: AgentKind } | { install: CliAgent } | null {
  if (!choice?.startsWith(prefix)) return null
  const rest = choice.slice(prefix.length)
  if (rest.startsWith('install:')) {
    const id = rest.slice('install:'.length)
    return isCliAgent(id) ? { install: id } : null
  }
  return rest === 'shell' || isCliAgent(rest) ? { kind: rest } : null
}
