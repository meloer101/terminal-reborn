// Figma 37: one glass block under each session the window shows (37B), drawn on a layer inside the scrolling session
// list. A pane that shows another session moves its block there on two springs (37A); a new pane's block drips onto
// its row; a closed pane's evaporates (selection-drop.ts). Style is written straight to the blocks each frame — React
// only says which sessions are shown. First show, coming back from the overview and 减少动态效果 place the blocks
// without motion. No backdrop filter: the window is transparent, so a backdrop filter reads empty pixels and darkens
// the block (PRD §5 v1.74).
import { useEffect, useLayoutEffect, useRef } from 'react'
import { advance, changes, dripOnto, evaporate, flowTo, follow, frameOf, moving, restAt, type DropState, type RowBox } from './selection-drop'
import styles from './SelectionDrop.module.css'

interface Block {
  el: HTMLDivElement
  /** null while the session's row is not drawn (its project folded). */
  state: DropState | null
}

const boxOf = (row: HTMLElement): RowBox => ({ top: row.offsetTop, height: row.offsetHeight, left: row.offsetLeft, width: row.offsetWidth })

function draw(block: Block): void {
  const f = block.state && frameOf(block.state)
  if (!f) {
    block.el.style.display = 'none'
    return
  }
  const s = block.el.style
  s.display = ''
  s.transform = `translate(${f.left}px, ${f.top}px)`
  s.width = `${f.width}px`
  s.height = `${f.height}px`
  s.borderRadius = `${f.radius}px`
  s.opacity = String(f.opacity)
}

/** `ids`: the sessions this window's panes show, in pane order; empty while the overview covers them. */
export function SelectionDrops({ ids }: { ids: readonly string[] }) {
  const layer = useRef<HTMLDivElement>(null)
  const blocks = useRef(new Map<string, Block>())
  const leaving = useRef<Block[]>([])
  // What the blocks showed at the last render; null when nothing was shown, so the next show places them still.
  const before = useRef<string[] | null>(null)
  const frame = useRef({ raf: 0, last: 0 })

  useLayoutEffect(() => {
    const root = layer.current
    const list = root?.parentElement
    if (!root || !list) return
    const live = blocks.current
    const boxFor = (id: string): RowBox | null => {
      const row = list.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(id)}"]`)
      return row ? boxOf(row) : null
    }
    const make = (id: string, state: DropState | null): Block => {
      const el = document.createElement('div')
      el.className = styles.drop ?? ''
      el.dataset.testid = 'selection-drop'
      el.dataset.dropFor = id
      root.appendChild(el)
      const block = { el, state }
      live.set(id, block)
      return block
    }
    const drop = (block: Block): void => block.el.remove()

    if (ids.length === 0) {
      for (const block of [...live.values(), ...leaving.current]) drop(block)
      live.clear()
      leaving.current = []
      before.current = null
      return
    }

    const still = before.current === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) {
      for (const block of leaving.current) drop(block)
      leaving.current = []
      for (const [id, block] of live) {
        if (ids.includes(id)) continue
        drop(block)
        live.delete(id)
      }
    } else {
      const change = changes(before.current ?? [], ids)
      for (const { from, to } of change.flow) {
        const block = live.get(from)
        live.delete(from)
        const box = boxFor(to)
        if (!block) continue
        live.set(to, block)
        block.el.dataset.dropFor = to
        block.state = box ? (block.state ? flowTo(block.state, box) : restAt(box)) : null
      }
      for (const id of change.drip) {
        const box = boxFor(id)
        make(id, box ? dripOnto(box) : null)
      }
      for (const id of change.evaporate) {
        const block = live.get(id)
        live.delete(id)
        if (!block) continue
        if (block.state) {
          block.state = evaporate(block.state)
          leaving.current.push(block)
        } else drop(block)
      }
    }
    // Every shown session has a block that follows its row (the layout may have moved it).
    for (const id of ids) {
      const box = boxFor(id)
      const block = live.get(id) ?? make(id, null)
      if (!box) block.state = null
      else block.state = block.state ? follow(block.state, box) : restAt(box)
    }
    before.current = [...ids]
    for (const block of [...live.values(), ...leaving.current]) draw(block)

    const anyMoving = (): boolean => [...live.values(), ...leaving.current].some((b) => b.state !== null && moving(b.state))
    const f = frame.current
    if (f.raf || !anyMoving()) return
    f.last = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min(0.032, (now - f.last) / 1000)
      f.last = now
      for (const block of [...live.values(), ...leaving.current]) {
        if (!block.state) continue
        for (let i = 0; i < 4; i++) block.state = advance(block.state, dt / 4)
        draw(block)
      }
      leaving.current = leaving.current.filter((b) => (b.state?.phase === 'gone' ? (drop(b), false) : true))
      f.raf = anyMoving() ? requestAnimationFrame(tick) : 0
    }
    f.raf = requestAnimationFrame(tick)
  })

  // The list reflows when the sidebar is resized: keep resting blocks on their rows.
  useEffect(() => {
    const root = layer.current
    const list = root?.parentElement
    if (!root || !list) return
    const observer = new ResizeObserver(() => {
      for (const [id, block] of blocks.current) {
        if (block.state?.phase !== 'rest') continue
        const row = list.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(id)}"]`)
        if (row) {
          block.state = restAt(boxOf(row))
          draw(block)
        }
      }
    })
    observer.observe(list)
    const f = frame.current
    return () => {
      observer.disconnect()
      cancelAnimationFrame(f.raf)
      f.raf = 0
    }
  }, [])

  return <div ref={layer} className={styles.layer} aria-hidden />
}
