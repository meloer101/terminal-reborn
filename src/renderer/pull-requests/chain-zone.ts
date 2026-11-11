// What Git · 变更's exit zone, its ⋯ menu and ⌘K show of the merge chain (合入链路 v2, PRD v1.169, Figma 73B–73H): the
// state line (glyph tone, the strong part and the rest of the sentence), the files it is about, the menu's fixed list
// with each blocked item's reason, and the chain actions ⌘K offers. Pure; the chain itself is src/shared/ship-chain.ts.
import type { ConfirmOptions } from '@shared/lifecycle'
import { livePr, type GhState, type PrStatus } from '@shared/pull-requests'
import type { ShipKind, ShipOperation, ShipOperationRequest, ShipOperationResult, ShipPreflight } from '@shared/ship'
import { CHAIN_TEXT, oneLine, type ChainActionId, type ChainState, type ChainTone } from '@shared/ship-chain'

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

/**
 * 合并 PR #N… opens the PR merge sheet, which needs the open PR's details (without them the merge sheet is the local
 * one, which would merge past the PR): why it cannot open now, or null. gh missing or signed out says so; a poll that
 * failed says what gh said; no status yet (not polled): checking.
 */
export function mergePrBlocker(status: PrStatus | null, gh: GhState | null = null): string | null {
  if (gh === 'missing') return CHAIN_TEXT.ghMissingMerge
  if (gh === 'signed-out') return CHAIN_TEXT.ghSignedOutMerge
  if (!status) return CHAIN_TEXT.checking
  const pr = livePr(status)
  if (!pr) return status.error?.message ?? CHAIN_TEXT.noPr
  return pr.details ? null : (status.error?.message ?? CHAIN_TEXT.checking)
}

/** The run the chain's `pr` action starts: a push to its open PR (the poll's, else the preflight's number while gh is
 *  not ready, so the label 推送到 PR #N and the run agree), else 创建 PR. */
export const prRunKind = (chain: Pick<ChainState, 'openPr'>): Extract<ShipKind, 'pr' | 'push-pr'> => (chain.openPr !== null ? 'push-pr' : 'pr')

/** Files a confirmation names before the rest are counted. */
const CONFIRM_FILES = 8
/** What main accepts as a confirmation's detail (src/main/confirm-spec.ts). */
const CONFIRM_DETAIL_MAX = 500

/** 中止 of a rebase or cherry-pick that would lose these files' resolutions or edits: the native confirmation. Names
 *  come from git: one line each, cut, listed while the detail stays within what main accepts, the rest counted. */
export function abortConfirmation(kind: ShipOperation['kind'], files: readonly string[]): ConfirmOptions {
  const listed: string[] = []
  for (const file of files.slice(0, CONFIRM_FILES)) {
    const next = [...listed, oneLine(file)]
    const more = next.length < files.length ? `\n等 ${files.length} 个文件` : ''
    if (next.join('\n').length + more.length > CONFIRM_DETAIL_MAX) break
    listed.push(next[next.length - 1]!)
  }
  const more = listed.length < files.length ? [`等 ${files.length} 个文件`] : []
  return {
    message: `中止 ${kind} 会丢掉 ${files.length} 个文件里已解决或改过的内容`,
    detail: [...listed, ...more].join('\n'),
    confirmLabel: '中止',
    cancelLabel: '取消',
    destructive: true
  }
}

/**
 * 继续 / 中止 in main; a 中止 main refuses with `confirm` is asked about (abortConfirmation) and sent again with `force`
 * and the files the user was shown (main asks again when the abort would now lose another) only on 中止. null: the
 * user kept the operation.
 */
export async function runOperation(
  request: ShipOperationRequest,
  kind: ShipOperation['kind'],
  send: (request: ShipOperationRequest) => Promise<ShipOperationResult>,
  ask: (options: ConfirmOptions) => Promise<boolean>
): Promise<ShipOperationResult | null> {
  let result = await send(request)
  // Asked once per new list: a list that grew while the sheet was open is shown again.
  for (let round = 0; round < 3; round++) {
    if (result.ok || result.reason !== 'confirm' || request.action !== 'abort') return result
    if (!(await ask(abortConfirmation(kind, result.files)))) return null
    result = await send({ ...request, force: true, confirmed: [...result.files] })
  }
  return result
}

/**
 * What ⇧⌘M does while Git · 变更 is open on the worktree (`idle`: no run, no review, no stopped fix holds the zone): the
 * primary exit when it can run; 合并 PR #N… through the chain, which says why it cannot open yet (never the local merge
 * sheet past the PR); nothing for a blocked exit or the chain's other moves (clicked), or while the zone is busy. null:
 * nothing registered — the merge sheet (merged, stuck, no move).
 */
export function zoneShortcut(chain: ChainState | null, idle: boolean): ChainCommand | 'nothing' | null {
  if (!idle) return 'nothing'
  const next = chain?.next ?? null
  if (next === null || chain?.stage === 'merged' || chain?.stage === 'stuck') return null
  if (next.id === 'merge-pr') return 'merge-pr'
  return (next.id === 'main' || next.id === 'pr') && next.blocker === null ? next.id : 'nothing'
}

/** Whether the primary button shows ⇧⌘M: an exit or 合并 PR #N… that can run now. */
export const zoneShortcutShown = (chain: ChainState): boolean =>
  chain.next !== null && (chain.next.id === 'main' || chain.next.id === 'pr' || chain.next.id === 'merge-pr') && chain.next.blocker === null

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
  /** The zone's primary move, which ⇧⌘M runs from here: the row shows ⇧⌘M. */
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
  /** Git · 变更 is open on the worktree and registered what ⇧⌘M runs there (merge/store.ts registerPrimaryExit). */
  exitRegistered: boolean
  /** What 拉取 fetches (the preflight's `pullFrom`); absent or null: `<remote>/<branch>`. */
  pullFrom?: string | null
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
        return facts.pullFrom ?? `${facts.remote ?? 'origin'}/${facts.branch}`
      default:
        return ''
    }
  }
  const out: PaletteGitAction[] = chain.actions
    // 归档… is offered once the work is merged, not for every worktree whose sessions are idle.
    .filter((a) => a.blocker === null && (a.id !== 'archive' || chain.stage === 'merged'))
    // ⇧⌘M runs an exit only while Git · 变更 registered it; 合并 PR #N… it runs through the chain from anywhere
    // (pull-requests/chain-actions.ts mergeShortcut).
    .map((a) => ({ command: a.id, label: a.label, detail: detail(a.id), primary: chain.next?.id === a.id && (a.id === 'merge-pr' || facts.exitRegistered) }))
  if (facts.reviewFiles !== null && facts.reviewFiles > 0) out.push({ command: 'review', label: '审阅全部改动', detail: `${facts.reviewFiles} 个文件`, primary: false })
  if (facts.pr !== null) out.push({ command: 'open-pr', label: `打开 PR #${facts.pr}`, detail: '', primary: false })
  return out
}
