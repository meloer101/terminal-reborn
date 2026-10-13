// Fixture data matching Figma screen 01 (14:2). Used until real sessions exist (M1/M2).
import type { Project, Session, Worktree } from '@shared/types'

const now = Date.now()
const minutesAgo = (m: number) => now - m * 60_000

export const mockProjects: Project[] = [
  { id: 'p-acme', name: 'acme-web', rootPath: '~/code/acme-web' },
  { id: 'p-tr', name: 'terminal-reborn', rootPath: '~/code/terminal-reborn' }
]

export const mockWorktrees: Worktree[] = [
  { id: 'w-cookie', projectId: 'p-acme', branch: 'jacob/session-cookie', path: '~/.tr/worktrees/acme-web/session-cookie', isMain: false, baseBranch: 'main', added: 42, removed: 18 },
  { id: 'w-perf', projectId: 'p-acme', branch: 'jacob/checkout-perf', path: '~/.tr/worktrees/acme-web/checkout-perf', isMain: false, baseBranch: 'main', added: 128, removed: 35 },
  { id: 'w-nav', projectId: 'p-acme', branch: 'jacob/mobile-nav-jitter', path: '~/.tr/worktrees/acme-web/mobile-nav-jitter', isMain: false, baseBranch: 'main', added: 23, removed: 9 },
  { id: 'w-acme-main', projectId: 'p-acme', branch: 'main', path: '~/code/acme-web', isMain: true },
  { id: 'w-sidebar', projectId: 'p-tr', branch: 'jacob/sidebar-status', path: '~/.tr/worktrees/terminal-reborn/sidebar-status', isMain: false, baseBranch: 'main', added: 61, removed: 4 },
  { id: 'w-graph', projectId: 'p-tr', branch: 'jacob/graph-layout', path: '~/.tr/worktrees/terminal-reborn/graph-layout', isMain: false, baseBranch: 'main', added: 210, removed: 12 }
]

export const mockSessions: Session[] = [
  { id: 's-cookie', worktreeId: 'w-cookie', kind: 'claude', title: 'Cookie 会话迁移', status: 'running', currentAction: '编辑 src/auth/session.ts', startedAt: minutesAgo(4), lastActivityAt: now },
  { id: 's-perf', worktreeId: 'w-perf', kind: 'codex', title: '结算页性能优化', status: 'running', currentAction: '运行 pnpm test checkout', startedAt: minutesAgo(12), lastActivityAt: minutesAgo(1) },
  { id: 's-nav', worktreeId: 'w-nav', kind: 'claude', title: '修复移动端导航抖动', status: 'done_unread', currentAction: '已完成，等你审阅', startedAt: minutesAgo(2), lastActivityAt: minutesAgo(2) },
  { id: 's-acme-main', worktreeId: 'w-acme-main', kind: 'shell', title: 'main', status: 'idle', startedAt: minutesAgo(30), lastActivityAt: minutesAgo(30) },
  { id: 's-sidebar', worktreeId: 'w-sidebar', kind: 'claude', title: '侧边栏状态聚合', status: 'running', currentAction: '读取 src/state/agents.ts', startedAt: minutesAgo(6), lastActivityAt: now },
  { id: 's-graph', worktreeId: 'w-graph', kind: 'claude', title: 'Git 图谱布局算法', status: 'error', currentAction: 'pnpm build 失败 · 2 个错误', startedAt: minutesAgo(18), lastActivityAt: minutesAgo(3) }
]
