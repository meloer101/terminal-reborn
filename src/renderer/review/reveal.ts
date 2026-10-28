// Jumping between a finding in the review block and its tag in the diff (PRD F13 v1.78, Figma 29B2). The list in
// Git · 变更 is windowed, so the diff line may not be in the DOM yet: open the file, scroll to where the line must be,
// then bring the tag itself into view. Best effort; a finding whose line is not in the diff lands on its file's row.
import { create } from 'zustand'
import type { ReviewComment } from '@shared/review-comments'
import { changeItems, changeKey, itemHeight } from '../panels/git/changes-model'
import { gitOf, toggleFile, useGit } from '../panels/git/store'
import { offsetsOf } from '../panels/git/virtual'
import { useReviewComments } from '../state/review-comments'
import { findMarkItem } from './marks'

const FLASH_MS = 1600
const LOAD_WAIT_MS = 4000

interface Flash {
  /** The finding row in the review block. */
  finding: string | null
  /** The tag on a diff line. */
  marker: string | null
  /** The finding last opened in the diff: its row stays marked while its file is open (Figma 29R). */
  active: string | null
}

export const useReviewFlash = create<Flash>()(() => ({ finding: null, marker: null, active: null }))

const timers: Partial<Record<'finding' | 'marker', number>> = {}

function flash(part: 'finding' | 'marker', id: string): void {
  window.clearTimeout(timers[part])
  useReviewFlash.setState(part === 'finding' ? { finding: id } : { marker: id })
  timers[part] = window.setTimeout(() => useReviewFlash.setState(part === 'finding' ? { finding: null } : { marker: null }), FLASH_MS)
}

const cssEscape = (value: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&'))

/** From a tag in the diff: scrolls the review block to the finding and highlights it for a moment. */
export function revealFinding(commentId: string): void {
  flash('finding', commentId)
  window.requestAnimationFrame(() => document.querySelector(`[data-finding-id="${cssEscape(commentId)}"]`)?.scrollIntoView({ block: 'nearest' }))
}

/** Resolves once the file's diff is loaded (or after a while, so a failed load does not hang the jump). */
function diffReady(root: string, key: string): Promise<void> {
  const ready = () => {
    const diff = gitOf(root).diffs[key]
    return diff !== undefined && diff.kind !== 'loading'
  }
  if (ready()) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      unsubscribe()
      window.clearTimeout(timer)
      resolve()
    }
    const unsubscribe = useGit.subscribe(() => {
      if (ready()) done()
    })
    const timer = window.setTimeout(done, LOAD_WAIT_MS)
  })
}

function markerFor(commentId: string): Element | null {
  return document.querySelector(`[data-review-mark~="${cssEscape(commentId)}"]`)
}

/** From a finding in the block: opens its file in 变更, scrolls to its line and highlights the tag there. */
export async function revealInDiff(root: string, comment: ReviewComment): Promise<void> {
  useReviewFlash.setState({ active: comment.id })
  const key = changeKey(comment.group, comment.path)
  if (!gitOf(root).expanded.has(key)) toggleFile(root, key)
  await diffReady(root, key)
  const git = gitOf(root)
  const scroller = document.querySelector<HTMLElement>('[role="list"][aria-label="改动的文件"]')
  if (git.changes && scroller) {
    const layout = scroller.dataset.layout === 'split' ? 'split' : 'unified'
    const own = (useReviewComments.getState().byRoot[root] ?? []).filter((c) => c.origin !== 'review')
    const items = changeItems(git.changes, git.expanded, git.diffs, own, null, layout)
    const index = findMarkItem(items, key, comment.side, comment.line)
    if (index >= 0) {
      const offsets = offsetsOf(items.map(itemHeight))
      scroller.scrollTop = Math.max(0, offsets[index]! - scroller.clientHeight / 2)
    }
  }
  flash('marker', comment.id)
  // The windowed list renders the line a frame after the scroll.
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => markerFor(comment.id)?.scrollIntoView({ block: 'center' })))
}
