// Git · 变更's merge chain rows (合入链路 v2, PRD v1.170, Figma 73B–73G): the state line — a glyph, the sentence's strong
// part and the rest — with the files it is about under it, and the exits: the chain's second move and its primary
// (⇧⌘M), then ⋯ with every chain action in a fixed order, a blocked one disabled with its reason in the trailing slot.
// Every action goes through pull-requests/chain-actions.ts, the same function ⌘K calls.
import { useEffect, useRef } from 'react'
import { Check, CircleAlert, CircleDashed, Ellipsis } from 'lucide-react'
import type { ChainMove, ChainState } from '@shared/ship-chain'
import { SHORTCUTS } from '@shared/shortcuts'
import { runChainCommand } from '../../pull-requests/chain-actions'
import { zoneMenu, type ChainCommand, type ZoneHeadline } from '../../pull-requests/chain-zone'
import { popupMenu, updateMenu, type MenuEntry } from '../../ui/menu'
import { formatAccelerator } from '../../ui/menu-model'
import ci from './CiRows.module.css'
import styles from './GitView.module.css'

const MARK = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

/** The state line (73C1–73D4, 73G1): never color alone — the glyph's shape and the words say it. */
export function ChainHeadlineRow({ headline, files }: { headline: ZoneHeadline; files: readonly string[] }) {
  const Glyph = headline.tone === 'ok' ? Check : headline.tone === 'working' ? CircleDashed : CircleAlert
  const text = headline.rest ? `${headline.strong}：${headline.rest}` : headline.strong
  return (
    <>
      <p className={ci.headline} role="status" data-testid="chain-headline" data-tone={headline.tone} title={text}>
        <span className={ci.mark} data-tone={headline.tone}>
          <Glyph {...MARK} />
        </span>
        <span className={ci.headlineText}>
          {headline.strong}
          {headline.rest && <span className={ci.headlineRest}>{headline.rest}</span>}
        </span>
      </p>
      {files.length > 0 && (
        <p className={ci.files} data-testid="chain-files" title={files.join('\n')}>
          {files.join(' · ')}
        </p>
      )}
    </>
  )
}

/** The exits on the right of the footer: the chain's second move (中止 sits on the left instead), its primary, ⋯. */
export function ChainButtons({
  chain,
  worktreePath,
  openIn,
  shortcut,
  idle
}: {
  chain: ChainState
  worktreePath: string
  openIn: string | null
  /** The primary carries ⇧⌘M (an exit, or 合并 PR #N…). */
  shortcut: boolean
  /** No run is open and no fix waits: the buttons act. */
  idle: boolean
}) {
  const run = (command: ChainCommand) => void runChainCommand(worktreePath, command, openIn)
  const button = (move: ChainMove, primary: boolean) => (
    <button
      key={move.id}
      type="button"
      className={primary ? styles.primaryButton : styles.ghostButton}
      disabled={!idle || move.blocker !== null}
      data-move={move.id}
      onClick={() => run(move.id)}
    >
      {move.label}
      {primary && shortcut && <span className={styles.shortcut}>{formatAccelerator(SHORTCUTS['merge-worktree'])}</span>}
    </button>
  )
  const entries: MenuEntry[] = zoneMenu(chain).map((item) => ({
    type: 'item',
    id: item.command,
    label: item.label,
    enabled: idle && item.blocker === null,
    ...(item.blocker ? { detail: item.blocker } : {})
  }))
  // The open menu follows the chain (a preflight that answers while it is open), never the chain it was opened with.
  const more = useRef<HTMLButtonElement>(null)
  const entriesKey = JSON.stringify(entries)
  useEffect(() => {
    if (more.current) updateMenu(more.current, JSON.parse(entriesKey) as MenuEntry[])
  }, [entriesKey])
  const openMenu = async (anchor: HTMLElement) => {
    const chosen = await popupMenu(entries, anchor)
    if (chosen) run(chosen as ChainCommand)
  }
  const second = chain.second && chain.second.id !== 'abort' ? chain.second : null
  return (
    <>
      {second && button(second, false)}
      {chain.next && button(chain.next, true)}
      <button
        type="button"
        ref={more}
        className={styles.moreButton}
        aria-label="全部操作"
        aria-haspopup="menu"
        data-testid="chain-menu"
        onClick={(event) => void openMenu(event.currentTarget)}
      >
        <Ellipsis {...MARK} />
      </button>
    </>
  )
}

/** 中止 on the left of the footer while an operation is stopped (73D3 / 73D4). */
export function ChainAbort({ chain, worktreePath, idle }: { chain: ChainState; worktreePath: string; idle: boolean }) {
  const abort = chain.second?.id === 'abort' ? chain.second : null
  if (!abort) return null
  return (
    <button type="button" className={styles.ghostButton} disabled={!idle || abort.blocker !== null} data-move="abort" onClick={() => void runChainCommand(worktreePath, 'abort')}>
      {abort.label}
    </button>
  )
}
