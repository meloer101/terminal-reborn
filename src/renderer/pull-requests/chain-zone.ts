// What Git · 变更's exit zone, its ⋯ menu and ⌘K show of the merge chain (合入链路 v2, PRD v1.169, Figma 73B–73H): the
// state line (glyph tone, the strong part and the rest of the sentence), the files it is about, the menu's fixed list
// with each blocked item's reason, and the chain actions ⌘K offers. Pure; the chain itself is src/shared/ship-chain.ts.
import type { ShipPreflight } from '@shared/ship'
import type { ChainActionId, ChainState, ChainTone } from '@shared/ship-chain'

/** Every way into the chain from the zone, the ⋯ menu and ⌘K (pull-requests/chain-actions.ts runs them): a chain move,
 *  the local merge sheet (the menu's 合并到 <base>…), the built-in review and opening the PR. */
export type ChainCommand = ChainState['actions'][number]['id'] | 'handoff' | 'continue' | 'abort' | 'merge-sheet' | 'review' | 'open-pr'

export interface ZoneHeadline {
  tone: ChainTone
  /** The sentence up to its colon, in strong text. */
  strong: string
  /** The rest (how to get past it), in secondary text; null when the sentence has no colon. */
  rest: string | null
}

/** 提交… with every 未提交 file unticked. */
export const NO_TICKED = '没有勾选文件'

/**
 * The chain as the zone uses it: 提交… is blocked while files are uncommitted but none is ticked (the chain counts
 * files, the panel knows the ticks). Applied once, so the buttons, the menu and ⌘K agree.
 */
export function withTicks(chain: ChainState, ticked: number): ChainState {
  const commit = chain.actions.find((a) => a.id === 'commit')
  if (!commit || commit.blocker !== null || ticked > 0) return chain
  const blocked = { ...commit, blocker: NO_TICKED }
  return {
    ...chain,
    actions: chain.actions.map((a) => (a.id === 'commit' ? blocked : a)),
    next: chain.next?.id === 'commit' ? { ...chain.next, blocker: NO_TICKED } : chain.next,
    second: chain.second?.id === 'commit' ? { ...chain.second, blocker: NO_TICKED } : chain.second
  }
}

/** 73D4: a stopped operation with every conflict resolved reads as such, on the ok tone. */
export const RESOLVED = '冲突都解决了'

/**
 * The zone's state line: the chain's headline; else the reason the other exit is blocked (73C1: gh 还没有登录 while
 * 合并到 main 并推送 stays the primary), so no blocked button is left with only a tooltip.
 */
export function zoneHeadline(chain: ChainState): ZoneHeadline | null {
  let line = chain.headline
  if (line && chain.stage === 'operation' && chain.next?.id === 'continue') line = { tone: 'ok', text: `${line.text} · ${RESOLVED}` }
  if (!line && chain.second?.blocker) line = { tone: 'blocked', text: chain.second.blocker }
  if (!line) return null
  const at = line.text.indexOf('：')
  return at < 0 ? { tone: line.tone, strong: line.text, rest: null } : { tone: line.tone, strong: line.text.slice(0, at), rest: line.text.slice(at + 1) }
}

/** The files the state line is about (73C3, 73D3): what would conflict with the base, or what an operation left unresolved. */
export function zoneFiles(chain: ChainState, preflight: ShipPreflight | null, radar: readonly string[] | null): string[] {
  if (chain.stage === 'operation') return preflight?.operation?.unresolved ?? []
  if (chain.stage === 'conflicts') return (preflight?.ok ? preflight.baseConflicts : null) ?? [...(radar ?? [])]
  return []
}

export interface ZoneMenuItem {
  id: ChainActionId
  /** The ⋯ menu's 合并到 <base>… opens the merge sheet (merge-sheet); the rest run what their label says. */
  command: ChainCommand
  label: string
  /** Why it cannot run now, short (the part before a colon), shown in the item's trailing slot; null when it can. */
  blocker: string | null
}

/** The part of a reason a menu's trailing slot has room for: the sentence up to its colon. */
export const shortReason = (text: string): string => text.split('：')[0] ?? text

/**
 * The ⋯ menu (73B): the chain's actions in their fixed order. 合并到 <base>… (the merge sheet) is hidden while a PR is
 * open, 合并 PR #N… shown only then; 创建 PR reads 推送到 PR #N with one open.
 */
export function zoneMenu(chain: ChainState): ZoneMenuItem[] {
  const open = chain.openPr !== null
  return chain.actions
    .filter((a) => (open ? a.id !== 'main' : a.id !== 'merge-pr'))
    .map((a) => ({
      id: a.id,
      command: a.id === 'main' ? 'merge-sheet' : a.id,
      label: a.id === 'main' ? `合并到 ${chain.base}…` : a.label,
      blocker: a.blocker === null ? null : shortReason(a.blocker)
    }))
}

export interface PaletteGitAction {
  command: ChainCommand
  label: string
  /** The row's second line: what it acts on. */
  detail: string
  /** The zone's primary move: the row shows ⇧⌘M. */
  primary: boolean
}

export interface PaletteGitFacts {
  /** Ticked 未提交 files. */
  ticked: number
  behind: number | null
  branch: string
  remote: string | null
  /** Files 审阅全部改动 would read; null: the review is not offered (another review mode, an agent that has none, one running). */
  reviewFiles: number | null
  /** The open PR to open; null when none. */
  pr: number | null
}

/**
 * ⌘K's Git group for the active session's worktree (73H): only the chain actions that can run now (归档… only once the
 * branch is merged), then 审阅全部改动 and 打开 PR #N when they apply.
 */
export function paletteGitActions(chain: ChainState, facts: PaletteGitFacts): PaletteGitAction[] {
  const detail = (id: ChainActionId): string => {
    switch (id) {
      case 'commit':
        return `${facts.ticked} 个文件`
      case 'sync':
        return facts.behind ? `落后 ${facts.behind}` : ''
      case 'push':
        return facts.remote ? `${facts.branch} → ${facts.remote}` : facts.branch
      case 'pull':
        return `${facts.remote ?? 'origin'}/${facts.branch}`
      default:
        return ''
    }
  }
  const out: PaletteGitAction[] = chain.actions
    // 归档… is offered once the work is merged, not for every worktree whose sessions are idle.
    .filter((a) => a.blocker === null && (a.id !== 'archive' || chain.stage === 'merged'))
    .map((a) => ({ command: a.id, label: a.label, detail: detail(a.id), primary: chain.next?.id === a.id }))
  if (facts.reviewFiles !== null && facts.reviewFiles > 0) out.push({ command: 'review', label: '审阅全部改动', detail: `${facts.reviewFiles} 个文件`, primary: false })
  if (facts.pr !== null) out.push({ command: 'open-pr', label: `打开 PR #${facts.pr}`, detail: '', primary: false })
  return out
}
