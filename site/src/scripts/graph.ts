/* 合并: the eight-branch graph from Figma W8, drawn by a playhead that the scroll moves through a working day.
   Lines are revealed by a clip that follows the playhead; commits, chips, merges, the waiting ring and the
   failed build pop as it passes them; the six steps light up in step with it. */
import { gsap } from 'gsap'
import { GRAPH, LANE_HEX } from './data'
import { burst } from './fx'
import { $, $$, fontReady, reduced, svg } from './util'

interface Pop {
  el: SVGElement
  x: number
}
interface Beat {
  x: number
  y: number
  kind: 'merge' | 'wait' | 'fail' | 'fork'
  color: string
}

export function initGraph(): void {
  const host = $('[data-graph]')
  const sec = $('[data-wt]')
  if (!host || !sec) return
  const steps = $$('[data-wt-steps] li', sec)
  const { W, H, YM, D } = GRAPH
  const TOP = 46
  const BOTTOM = 44

  const root = svg('svg', { viewBox: `0 ${-TOP} ${W} ${H + TOP + BOTTOM}`, preserveAspectRatio: 'xMidYMid meet' })
  const defs = svg('defs')
  const clip = svg('clipPath', { id: 'wt-reveal' })
  const reveal = svg('rect', { x: -12, y: -TOP, width: 0, height: H + TOP + BOTTOM })
  clip.append(reveal)
  defs.append(clip)
  const lanesG = svg('g', { 'clip-path': 'url(#wt-reveal)' })
  const nodesG = svg('g')
  const chipsG = svg('g')
  const overlay = svg('g')
  root.append(defs, lanesG, nodesG, chipsG, overlay)

  const pops: Pop[] = []
  const beats: Beat[] = []
  const fork = (x: number, y0: number, y1: number): string => `M${x} ${y0} C${x + D * 0.6} ${y0} ${x + D * 0.4} ${y1} ${x + D} ${y1}`
  const merge = (x: number, y0: number, y1: number): string => `C${x - D * 0.4} ${y0} ${x - D * 0.6} ${y1} ${x} ${y1}`
  const node = (x: number, y: number, color: string, cls = 'cm pop', r = 5.5): SVGCircleElement => {
    const c = svg('circle', { class: cls, cx: x, cy: y, r, stroke: color })
    nodesG.append(c)
    pops.push({ el: c, x })
    return c
  }

  // main
  lanesG.append(svg('path', { class: 'lane lane-main', d: `M-12 ${YM}H${W + 12}` }))
  const mainCommits = new Set(GRAPH.mainCommits)
  for (const l of GRAPH.lanes) if (l.parentY == null) mainCommits.add(l.from)
  for (const x of mainCommits) node(x, YM, LANE_HEX.idle)

  // branches
  const groups: SVGGElement[] = []
  const chips: { g: SVGGElement; name: SVGTextElement; note: SVGTextElement; rect: SVGRectElement; lane: string }[] = []
  for (const l of GRAPH.lanes) {
    const color = LANE_HEX[l.c]
    const y0 = l.parentY ?? YM
    let d = fork(l.from, y0, l.y)
    if (l.to != null) d += ` H${l.to - D} ${merge(l.to, l.y, y0)}`
    else d += ` H${l.end ?? W + 12}`
    const g = svg('g', { 'data-lane': l.name })
    g.append(svg('path', { class: 'lane', d, stroke: color }))
    if (l.open === 'run') g.append(svg('path', { class: 'flow', d, stroke: '#ffffff', pathLength: 1 }))
    g.append(svg('path', { class: 'hit', d }))
    lanesG.append(g)
    groups.push(g)

    for (const x of l.commits) node(x, l.y, color).setAttribute('data-for', l.name)
    if (l.parentY != null) {
      node(l.from, l.parentY, LANE_HEX.working)
      if (l.to != null) {
        const m = node(l.to, l.parentY, LANE_HEX.working, 'mg pop', 6.5)
        m.setAttribute('fill', LANE_HEX.working)
        beats.push({ x: l.to, y: l.parentY, kind: 'merge', color: LANE_HEX.done })
      }
    } else if (l.to != null) {
      const m = node(l.to, YM, LANE_HEX.idle, 'mg pop', 6.5)
      m.setAttribute('fill', LANE_HEX.idle)
      beats.push({ x: l.to, y: YM, kind: 'merge', color: color })
    }
    beats.push({ x: l.from, y: y0, kind: 'fork', color })
    if (l.open === 'wait' && l.end != null) {
      const ring = svg('circle', { class: 'ring pop-fade', cx: l.end, cy: l.y, r: 9 })
      nodesG.append(ring)
      pops.push({ el: ring, x: l.end })
      const dot = node(l.end, l.y, color, 'mg pop', 7.5)
      dot.setAttribute('fill', color)
      beats.push({ x: l.end, y: l.y, kind: 'wait', color })
    }
    if (l.open === 'fail' && l.end != null) {
      const x = l.end
      const fail = svg('g', { class: 'pop' })
      fail.append(svg('circle', { cx: x, cy: l.y, r: 8, fill: color }))
      fail.append(svg('path', { d: `M${x - 3.2} ${l.y - 3.2}L${x + 3.2} ${l.y + 3.2}M${x + 3.2} ${l.y - 3.2}L${x - 3.2} ${l.y + 3.2}`, stroke: '#000', 'stroke-width': 2, 'stroke-linecap': 'round' }))
      nodesG.append(fail)
      pops.push({ el: fail, x })
      beats.push({ x, y: l.y, kind: 'fail', color })
    }

    // the branch chip: name + which agent / what state
    const outer = svg('g', { transform: `translate(${l.from + D + 12} ${l.y - 32})` })
    const inner = svg('g', { class: 'chip pop-chip', 'data-for': l.name })
    const rect = svg('rect', { x: 0, y: 0, width: 150, height: 24, rx: 4, stroke: color })
    const name = svg('text', { x: 24, y: 16.5 })
    name.textContent = l.name
    const note = svg('text', { class: 'note', x: 120, y: 16.5 })
    note.textContent = l.note
    inner.append(rect, svg('circle', { cx: 12, cy: 12, r: 4, fill: color }), name, note)
    outer.append(inner)
    chipsG.append(outer)
    pops.push({ el: inner, x: l.from + D })
    chips.push({ g: inner, name, note, rect, lane: l.name })
  }

  // main label and release tags
  // Positioned by an outer group: the CSS transform that pops the inner one would replace a transform attribute.
  const placed = (x: number, y: number, cls: string): SVGGElement => {
    const outer = svg('g', { transform: `translate(${x} ${y})` })
    const inner = svg('g', { class: `${cls} pop-chip` })
    outer.append(inner)
    chipsG.append(outer)
    return inner
  }
  const mainRef = placed(0, YM + 16, 'main-ref')
  mainRef.append(svg('rect', { x: 0, y: 0, width: 58, height: 22, rx: 4 }))
  const mt = svg('text', { x: 10, y: 15.5 })
  mt.textContent = '⎇ main'
  mainRef.append(mt)
  pops.push({ el: mainRef, x: 0 })
  for (const [x, label] of GRAPH.tags) {
    const t = placed(x - 26, YM + 16, 'tag')
    t.append(svg('rect', { x: 0, y: 0, width: 52, height: 20, rx: 4 }))
    const tt = svg('text', { x: 26, y: 14, 'text-anchor': 'middle' })
    tt.textContent = label
    t.append(tt)
    pops.push({ el: t, x })
  }

  // conflict radar: two branches touch the same file
  const cl = GRAPH.clash
  const clash = svg('g', { class: 'clash pop-chip' })
  clash.append(svg('line', { x1: cl.x, y1: cl.y1 + 7, x2: cl.x, y2: cl.y2 - 7 }))
  clash.append(svg('circle', { cx: cl.x, cy: (cl.y1 + cl.y2) / 2, r: 9 }))
  const bang = svg('text', { x: cl.x, y: (cl.y1 + cl.y2) / 2 + 4, 'text-anchor': 'middle' })
  bang.textContent = '!'
  const cLabel = svg('text', { x: cl.x + 16, y: (cl.y1 + cl.y2) / 2 + 4 })
  cLabel.textContent = cl.label
  clash.append(bang, cLabel)
  overlay.append(clash)
  pops.push({ el: clash, x: cl.x })

  // playhead
  const ph = svg('g', { class: 'playhead' })
  ph.append(svg('line', { x1: 0, y1: -TOP + 18, x2: 0, y2: H + 8 }))
  const clock = svg('text', { x: 6, y: -TOP + 14 })
  ph.append(clock)
  overlay.append(ph)
  host.append(root)

  // chips sized to their text once the fonts are in
  const sizeChips = (): void => {
    for (const c of chips) {
      const w1 = c.name.getComputedTextLength()
      const w2 = c.note.getComputedTextLength()
      c.note.setAttribute('x', String(24 + w1 + 8))
      c.rect.setAttribute('width', String(24 + w1 + 8 + w2 + 10))
    }
  }
  void fontReady('400 13px "JetBrains Mono Web"').then(sizeChips)
  sizeChips()

  // hover a branch: it thickens, everything else steps back
  for (const g of groups) {
    const name = g.getAttribute('data-lane')
    const on = (): void => {
      groups.forEach((o) => {
        o.classList.toggle('is-hot', o === g)
        o.classList.toggle('is-dim', o !== g)
      })
      chips.forEach((c) => c.g.classList.toggle('is-dim', c.lane !== name))
    }
    const off = (): void => {
      groups.forEach((o) => o.classList.remove('is-hot', 'is-dim'))
      chips.forEach((c) => c.g.classList.remove('is-dim'))
    }
    g.addEventListener('pointerenter', on)
    g.addEventListener('pointerleave', off)
  }

  const clockText = (x: number): string => {
    const m = Math.round(540 + (Math.max(0, Math.min(W, x)) / W) * 570)
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }

  let lastX = -Infinity
  function fire(b: Beat): void {
    const ctm = root.getScreenCTM()
    if (!ctm) return
    const pt = root.createSVGPoint()
    pt.x = b.x
    pt.y = b.y
    const s = pt.matrixTransform(ctm)
    if (b.kind === 'merge') burst(s.x, s.y, { n: 26, speed: 4.5, size: [1.6, 3], colors: [b.color, '#ffffff'], life: 800, gravity: 0 })
    else if (b.kind === 'wait') burst(s.x, s.y, { n: 30, speed: 5, size: [1.6, 3.4], colors: ['#ff5fb0', '#ffffff'], life: 900, gravity: 0 })
    else if (b.kind === 'fail') burst(s.x, s.y, { n: 30, speed: 5.5, chars: ['×', '!'], size: [8, 13], colors: ['#ff5c5c'], life: 800 })
    else burst(s.x, s.y, { n: 8, speed: 2.2, size: [1.4, 2.4], colors: [b.color], life: 500, gravity: 0 })
  }

  function render(x: number): void {
    reveal.setAttribute('width', String(Math.max(0, x + 12)))
    for (const p of pops) p.el.classList.toggle('on', x >= p.x)
    ph.setAttribute('transform', `translate(${Math.max(0, Math.min(W, x))} 0)`)
    clock.textContent = clockText(x)
    const live = x >= W
    host?.classList.toggle('is-live', live)
    ph.style.opacity = live || x <= 0 ? '0' : '1'
    let on = -1
    GRAPH.stepAt.forEach((s, i) => {
      if (x >= s) on = i
    })
    steps.forEach((li, i) => {
      li.classList.toggle('is-on', i === on)
      li.classList.toggle('is-done', i < on)
    })
    if (x > lastX && x - lastX < 220 && !reduced()) for (const b of beats) if (b.x > lastX && b.x <= x) fire(b)
    lastX = x
  }

  const end = W + 20
  if (reduced()) {
    render(end)
    return
  }
  const proxy = { x: -20 }
  render(proxy.x)
  const mm = gsap.matchMedia()
  mm.add('(min-width: 901px)', () => {
    const t = gsap.to(proxy, {
      x: end,
      ease: 'none',
      onUpdate: () => render(proxy.x),
      scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.6 }
    })
    return () => t.kill()
  })
  mm.add('(max-width: 900px)', () => {
    // On a phone the graph is wider than the screen: keep the playhead in view until the reader scrolls it.
    let follow = true
    const stop = (): void => { follow = false }
    host.addEventListener('pointerdown', stop)
    host.addEventListener('wheel', stop, { passive: true })
    const t = gsap.to(proxy, {
      x: end,
      duration: 7,
      ease: 'none',
      onUpdate: () => {
        render(proxy.x)
        if (follow) host.scrollLeft = (proxy.x / W) * host.scrollWidth - host.clientWidth * 0.6
      },
      scrollTrigger: { trigger: host, start: 'top 80%', toggleActions: 'play none none none' }
    })
    return () => {
      t.kill()
      host.removeEventListener('pointerdown', stop)
      host.removeEventListener('wheel', stop)
    }
  })
}
