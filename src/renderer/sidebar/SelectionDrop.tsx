// Figma 37: one glass block under each session the window shows (37B), drawn on a layer inside the scrolling session
// list. A pane that shows another session moves its block there on two springs (37A); a new pane's block drips onto
// its row; a closed pane's evaporates (selection-drop.ts). Style is written straight to the blocks each frame — React
// only says which sessions are shown. First show, coming back from the overview and 减少动态效果 place the blocks
// without motion. No backdrop filter: the window is transparent, so a backdrop filter reads empty pixels and darkens
// the block (PRD §5 v1.74).
//
// Cost: the sidebar re-renders on every session patch, so nothing here runs per render. Rows are measured when the
// shown sessions change, and otherwise only from a ResizeObserver on the projects and their rows (it fires after
// layout, so reading offsets there forces none): a row that grows or shrinks, a project folding, the sidebar
// resizing. Frames write width / height rather than a scale: a scaled block would stretch its 1px rim, its shadow
// and its corners into ellipses, and the bead (12 px) would lose them altogether.
import { useLayoutEffect, useRef } from 'react'
import { advance, changes, dripOnto, evaporate, flowTo, follow, frameOf, moving, restAt, type DropState, type RowBox } from './selection-drop'
import styles from './SelectionDrop.module.css'

interface Block {
  el: HTMLDivElement
  /** null while the session's row is not drawn (its project folded). */
  state: DropState | null
  /** The style last written, so a frame that did not change writes nothing. */
  drawn: string
}

const boxOf = (row: HTMLElement): RowBox => ({ top: row.offsetTop, height: row.offsetHeight, left: row.offsetLeft, width: row.offsetWidth })

function draw(block: Block): void {
  const f = block.state && frameOf(block.state)
  const drawn = f ? `${f.left} ${f.top} ${f.width} ${f.height} ${f.radius} ${f.opacity}` : 'none'
  if (drawn === block.drawn) return
  block.drawn = drawn
  const s = block.el.style
  if (!f) {
    s.display = 'none'
    return
  }
  s.display = ''
  s.transform = `translate(${f.left}px, ${f.top}px)`
  s.width = `${f.width}px`
  s.height = `${f.height}px`
  s.borderRadius = `${f.radius}px`
  s.opacity = String(f.opacity)
}

interface Drops {
  /** The sessions shown now, in pane order; empty while the overview covers them. */
  show(ids: readonly string[]): void
  dispose(): void
}

/** The blocks on `root`, a layer inside `list` (the session list, whose sections hold the rows). */
function createDrops(root: HTMLElement, list: HTMLElement): Drops {
  const live = new Map<string, Block>()
  let leaving: Block[] = []
  // What the blocks showed last; null when nothing was shown, so the next show places them still.
  let before: string[] | null = null
  let raf = 0
  let last = 0

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
    const block = { el, state, drawn: '' }
    live.set(id, block)
    return block
  }
  const drop = (block: Block): void => block.el.remove()
  const all = (): Block[] => [...live.values(), ...leaving]
  const anyMoving = (): boolean => all().some((b) => b.state !== null && moving(b.state))

  const tick = (now: number): void => {
    const dt = Math.min(0.032, (now - last) / 1000)
    last = now
    for (const block of all()) {
      if (!block.state) continue
      for (let i = 0; i < 4; i++) block.state = advance(block.state, dt / 4)
      draw(block)
    }
    leaving = leaving.filter((b) => (b.state?.phase === 'gone' ? (drop(b), false) : true))
    raf = anyMoving() ? requestAnimationFrame(tick) : 0
  }

  /** Every shown session has a block that follows its row (the layout may have moved it). */
  const place = (): void => {
    for (const id of before ?? []) {
      const box = boxFor(id)
      const block = live.get(id) ?? make(id, null)
      if (!box) block.state = null
      else block.state = block.state ? follow(block.state, box) : restAt(box)
    }
    for (const block of all()) draw(block)
    if (raf || !anyMoving()) return
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }

  const show = (ids: readonly string[]): void => {
    if (ids.length === 0) {
      for (const block of all()) drop(block)
      live.clear()
      leaving = []
      before = null
      return
    }
    const still = before === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) {
      for (const block of leaving) drop(block)
      leaving = []
      for (const [id, block] of live) {
        if (ids.includes(id)) continue
        drop(block)
        live.delete(id)
      }
    } else {
      const change = changes(before ?? [], ids)
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
          leaving.push(block)
        } else drop(block)
      }
    }
    before = [...ids]
    place()
  }

  // A row moves when anything above it changes height (rows have 1–3 lines), a project folds or the sidebar resizes:
  // each of those resizes a project section or a row. Sections and rows come and go, so the observed set follows them.
  const resized = new ResizeObserver(() => {
    if (before !== null) place()
  })
  const observed = new Set<Element>()
  const watch = (el: Element): void => {
    if (observed.has(el)) return
    observed.add(el)
    resized.observe(el)
  }
  const sync = (): void => {
    for (const el of observed) {
      if (el.isConnected) continue
      resized.unobserve(el)
      observed.delete(el)
    }
    for (const section of list.children) {
      if (section === root) continue
      watch(section)
      structure.observe(section, { childList: true })
      for (const child of section.children) watch(child)
    }
  }
  const structure = new MutationObserver(sync)
  structure.observe(list, { childList: true })
  sync()

  return {
    show,
    dispose() {
      resized.disconnect()
      structure.disconnect()
      cancelAnimationFrame(raf)
      raf = 0
      for (const block of all()) drop(block)
      live.clear()
      leaving = []
    }
  }
}

/** `ids`: the sessions this window's panes show, in pane order; empty while the overview covers them. */
export function SelectionDrops({ ids }: { ids: readonly string[] }) {
  const layer = useRef<HTMLDivElement>(null)
  const drops = useRef<Drops | null>(null)
  // By content: the sidebar re-renders (and may rebuild `ids`) on every session patch.
  const key = ids.join('\n')

  useLayoutEffect(() => {
    const root = layer.current
    const list = root?.parentElement
    if (!root || !list) return
    const d = createDrops(root, list)
    drops.current = d
    return () => {
      d.dispose()
      drops.current = null
    }
  }, [])

  useLayoutEffect(() => {
    drops.current?.show(key === '' ? [] : key.split('\n'))
  }, [key])

  return <div ref={layer} className={styles.layer} aria-hidden />
}
