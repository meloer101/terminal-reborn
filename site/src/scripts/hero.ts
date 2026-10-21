/* Hero: the app window is the stage (dimmed sidebars keep working), the sky type, the TV row of "?",
   the headline. Pointer parallax, an intro after the boot, and a pinned scroll that switches the tube off
   and pulls the real product into focus. */
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { CRT } from './crt'
import { GIT_ROWS, LANE_HEX, NEW_COMMITS, SIDEBAR, SIM, waited, ZH, type GitRow, type SideRow } from './data'
import { burst, glitch } from './fx'
import { $, $$, esc, fineMq, fontReady, glyph, h, narrowMq, rand, reduced, svg, typing, watch, type Status } from './util'

export interface Hero {
  /** Sets the hidden starting state of the intro (called before the page is revealed). */
  prepare(): void
  intro(): gsap.core.Timeline
  crt: CRT | null
}

const ROW_H = 28

export function initHero(): Hero | null {
  const section = $('[data-hero]')
  const app = $('[data-app]')
  const content = $('[data-hero-content]')
  if (!section || !app || !content) return null
  const sky = $('[data-sky]', section)
  const zone = $('[data-crt-zone]', section)
  const canvas = $<HTMLCanvasElement>('[data-crt]', section)
  const title = $('[data-hero-title]', section)
  const sub = $('[data-hero-sub]', section)
  const cta = $('[data-hero-cta]', section)
  let visible = true

  /* ───────── Sidebar: the fleet keeps moving ───────── */
  const tree = $('[data-app-tree]', app)
  const countEl = $('[data-app-count]', app)
  const rows: Record<string, HTMLElement> = {}
  if (tree) {
    for (const s of SIDEBAR) {
      if ('project' in s) {
        tree.append(h('div', 'app-project', `<span>${esc(s.project)}</span><small>${s.count}</small>`))
        continue
      }
      const r: SideRow = s
      const row = h('div', 'app-row' + (r.selected ? ' is-selected' : ''))
      row.innerHTML = `${glyph(r.status)}<span class="t">${esc(r.title)}</span><span class="m"><span data-time>${esc(r.time)}</span><span>${esc(r.diff)}</span></span><span class="s" data-sub>${esc(r.sub)}</span>`
      row.dataset.status = r.status
      tree.append(row)
      rows[r.id] = row
    }
  }
  const ping = (el: Element | null): void => {
    if (!el || reduced()) return
    el.classList.remove('is-ping')
    void (el as HTMLElement).offsetWidth
    el.classList.add('is-ping')
  }
  const syncCount = (): void => {
    if (!countEl) return
    const n = Object.values(rows).filter((r) => r.dataset.status === 'needs_you').length
    const b = $('b', countEl)
    if (b) b.textContent = String(n)
    countEl.classList.toggle('is-zero', n === 0)
  }
  function setRow(id: string, status: Status | null, sub?: string, time?: string): void {
    const row = rows[id]
    if (!row) return
    if (status && row.dataset.status !== status) {
      row.dataset.status = status
      $('use', row)?.setAttribute('href', `#g-${status}`)
      if (status === 'needs_you') ping($('svg', row))
    }
    if (sub != null) {
      const el = $('[data-sub]', row)
      if (el) el.textContent = sub
    }
    if (time != null) {
      const el = $('[data-time]', row)
      if (el) el.textContent = time
    }
    syncCount()
  }
  let waitTick = 0
  const startWait = (): void => {
    let s = 0
    clearInterval(waitTick)
    waitTick = window.setInterval(() => {
      s += 1
      setRow('cookie', null, undefined, waited(s))
    }, 1000)
  }
  const SCRIPT: [number, () => void][] = [
    [0, () => { setRow('cookie', 'needs_you', SIM.confirm, waited(0)); startWait() }],
    [3200, () => setRow('checkout', null, SIM.price)],
    [5200, () => setRow('agg', 'done_unread', SIM.rollupDone, SIM.justNow)],
    [7400, () => { clearInterval(waitTick); setRow('cookie', 'running', SIM.migrate, '4m') }],
    [8800, () => setRow('checkout', null, SIM.cart)],
    [10600, () => setRow('cookie', null, SIM.refresh)],
    [12200, () => setRow('agg', 'running', SIM.agents, '6m')],
    [13400, () => setRow('checkout', null, SIM.test)]
  ]
  let simTimers: number[] = []
  let simOn = false
  function runSim(): void {
    simOn = true
    simTimers.forEach(clearTimeout)
    simTimers = SCRIPT.map(([at, fn]) => window.setTimeout(fn, at))
    simTimers.push(window.setTimeout(() => (visible && !reduced() ? runSim() : (simOn = false)), 15000))
  }
  syncCount()

  /* ───────── Git pane: rows with lanes, new commits keep landing ───────── */
  const paneBox = $('[data-pane-graph]', app)
  let gitRows: GitRow[] = GIT_ROWS.slice()
  const lanesSvg = svg('svg', { class: 'pg-lanes', 'aria-hidden': 'true' })
  const laneX = (lane: number): number => 14 + lane * 11
  function drawLanes(): void {
    lanesSvg.replaceChildren()
    const height = gitRows.length * ROW_H
    lanesSvg.setAttribute('viewBox', `0 0 64 ${height}`)
    lanesSvg.setAttribute('height', String(height))
    lanesSvg.setAttribute('width', '64')
    const lanes = new Set(gitRows.map((r) => r.lane))
    for (const lane of lanes) {
      const idx = gitRows.map((r, i) => (r.lane === lane ? i : -1)).filter((i) => i >= 0)
      const first = idx[0] ?? 0
      const last = idx[idx.length - 1] ?? 0
      const color = LANE_HEX[gitRows[first]?.c ?? 'idle']
      const x = laneX(lane)
      if (lane === 0) {
        lanesSvg.append(svg('path', { d: `M${x} 0V${height}`, stroke: LANE_HEX.idle, 'stroke-width': 1.6, fill: 'none' }))
        continue
      }
      const y0 = first * ROW_H + ROW_H / 2
      const y1 = last * ROW_H + ROW_H / 2
      const yf = Math.min(height, y1 + ROW_H)
      lanesSvg.append(svg('path', { d: `M${x} ${y0}V${y1}C${x} ${yf - 6} ${laneX(0)} ${y1 + 6} ${laneX(0)} ${yf}`, stroke: color, 'stroke-width': 1.6, fill: 'none' }))
    }
    gitRows.forEach((r, i) => {
      const c = LANE_HEX[r.c ?? 'idle']
      lanesSvg.append(svg('circle', { cx: laneX(r.lane), cy: i * ROW_H + ROW_H / 2, r: 3.6, fill: '#121212', stroke: c, 'stroke-width': 1.6 }))
    })
  }
  const rowEl = (r: GitRow): HTMLElement => {
    const el = h('div', 'pg-row' + (r.sel ? ' is-sel' : ''))
    const color = LANE_HEX[r.c ?? 'idle']
    const ref = r.ref ? `<span class="ref" style="--c:${color}">${esc(r.ref)}</span>` : ''
    const ref2 = r.ref2 ? `<span class="ref" style="--c:${color}">${esc(r.ref2)}</span>` : ''
    el.innerHTML = `${ref}${ref2}<span class="msg">${esc(r.msg)}</span><span class="tm">${esc(r.tm)}</span>`
    return el
  }
  if (paneBox) {
    paneBox.append(lanesSvg)
    for (const r of gitRows) paneBox.append(rowEl(r))
    drawLanes()
  }
  let commitIdx = 0
  let commitTimer = 0
  function landCommit(): void {
    if (!paneBox) return
    const next = NEW_COMMITS[commitIdx++ % NEW_COMMITS.length]
    if (!next) return
    gitRows = [next, ...gitRows.slice(0, GIT_ROWS.length - 1)]
    const el = rowEl(next)
    paneBox.insertBefore(el, lanesSvg.nextSibling)
    const all = $$('.pg-row', paneBox)
    all.slice(GIT_ROWS.length).forEach((x) => x.remove())
    drawLanes()
    gsap.fromTo(el, { height: 0, opacity: 0 }, { height: ROW_H, opacity: 1, duration: 0.6, ease: 'expo.out', clearProps: 'height' })
    gsap.fromTo(el, { backgroundColor: 'rgba(94,161,255,0.22)' }, { backgroundColor: 'rgba(94,161,255,0)', duration: 1.6, delay: 0.2 })
  }
  const scheduleCommits = (): void => {
    clearTimeout(commitTimer)
    if (!visible || reduced()) return
    commitTimer = window.setTimeout(() => {
      landCommit()
      scheduleCommits()
    }, rand(3800, 6400))
  }

  /* ───────── Sidebars come into focus when you reach for them ───────── */
  const sideW = (): number => parseFloat(getComputedStyle(app).gridTemplateColumns.split(' ')[0] ?? '264') || 264
  section.addEventListener('pointermove', (e) => {
    if (narrowMq.matches) return
    const w = sideW()
    app.classList.toggle('focus-left', e.clientX < w)
    app.classList.toggle('focus-right', e.clientX > window.innerWidth - w)
  })
  section.addEventListener('pointerleave', () => app.classList.remove('focus-left', 'focus-right'))

  /* ───────── Sky type: a cloud texture to fill the letters ───────── */
  const skyFill = $('.sky-fill', section)
  if (skyFill) {
    const cloud = `<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='700'><filter id='f' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.0032 0.012' numOctaves='5' seed='11'/><feColorMatrix values='2.3 0 0 0 -0.55  2.1 0 0 0 -0.32  0.9 0 0 0 0.58  0 0 0 0 1'/></filter><rect width='1600' height='700' filter='url(#f)'/></svg>`
    skyFill.style.setProperty('--sky', `url("data:image/svg+xml;utf8,${encodeURIComponent(cloud)}")`)
  }

  /* ───────── The TV ───────── */
  let crt: CRT | null = null
  if (canvas && zone) {
    crt = new CRT(canvas)
    const tv = crt
    const layout = (): void => tv.resize()
    void fontReady(`800 100px "Wavi Archivo"`).then(() => fontReady('900 100px "Wavi Hei"')).then(layout)
    new ResizeObserver(layout).observe(zone)
    layout()

    const answerAt = (idx: number): void => {
      const i = tv.answer(idx)
      if (i < 0) return
      const r = tv.canvas.getBoundingClientRect()
      const x = r.left + (tv.centers[i] ?? r.width / 2)
      const y = r.top + r.height * 0.5
      burst(x, y, { n: 46, speed: 8, chars: ['?', '?', '·', '░', '▒', '▓'], size: [9, 18], life: 1000, gravity: 0.18, colors: ['#ffffff', '#7ef9ff', '#ff5fb0', '#ffd000'] })
      burst(x, y, { n: 30, speed: 5, size: [2, 4], life: 700, gravity: 0.05 })
      // Answering a "?" answers the agent waiting in the sidebar too.
      if (rows.cookie?.dataset.status === 'needs_you') {
        clearInterval(waitTick)
        setRow('cookie', 'running', SIM.migrate, '4m')
      }
    }
    zone.addEventListener('click', (e) => {
      const r = tv.canvas.getBoundingClientRect()
      answerAt(tv.nearest(e.clientX - r.left))
    })
    zone.addEventListener('pointermove', (e) => {
      const r = tv.canvas.getBoundingClientRect()
      tv.setPointer(e.clientX - r.left, e.clientY - r.top)
    })
    zone.addEventListener('pointerleave', () => tv.clearPointer())
    window.addEventListener('keydown', (e) => {
      if (!visible || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return
      if (e.key === 'j' || e.key === 'J') answerAt(-1)
    })
    tv.onAllAnswered = () => {
      glitch(0.5, 320)
      const r = tv.canvas.getBoundingClientRect()
      burst(r.left + r.width / 2, r.top + r.height / 2, { n: 120, speed: 12, life: 1400, spreadX: r.width * 0.25, chars: ['✓', '·', '+'], size: [10, 18], colors: ['#3dd68c', '#ffffff', '#7ef9ff'] })
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) tv.stop()
      else if (visible) tv.start()
    })
  }

  watch(section, (on) => {
    visible = on
    if (on) {
      crt?.start()
      if (!simOn && !reduced()) runSim()
      scheduleCommits()
    } else {
      crt?.stop()
      clearTimeout(commitTimer)
    }
  }, '0px')

  /* ───────── Pointer parallax (CSS `translate`, so it never fights the GSAP transforms) ───────── */
  if (fineMq.matches && !reduced()) {
    const layers: [HTMLElement, number, number][] = $$('[data-px]', section).map((el) => {
      const [sx, sy] = (el.dataset.px ?? '0,0').split(',').map(Number)
      return [el, sx ?? 0, sy ?? 0]
    })
    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0
    let raf = 0
    const step = (): void => {
      cx += (tx - cx) * 0.06
      cy += (ty - cy) * 0.06
      for (const [el, sx, sy] of layers) el.style.translate = `${(cx * sx).toFixed(2)}px ${(cy * sy).toFixed(2)}px`
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.001 ? requestAnimationFrame(step) : 0
    }
    section.addEventListener('pointermove', (e) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2
      ty = (e.clientY / window.innerHeight - 0.5) * 2
      if (!raf) raf = requestAnimationFrame(step)
    })
  }

  /* ───────── Headline: split into characters; now and then one of them slips ───────── */
  let split: SplitText | null = null
  const splitTitle = (): void => {
    if (!title || split) return
    // English keeps word wrappers so a wrapped headline never breaks inside a word.
    split = SplitText.create(title, { type: ZH ? 'chars' : 'words,chars', charsClass: 'char' })
  }
  let flickTimer = 0
  const flick = (): void => {
    clearTimeout(flickTimer)
    flickTimer = window.setTimeout(() => {
      if (visible && split && !reduced()) {
        const ch = split.chars[(Math.random() * split.chars.length) | 0]
        if (ch) {
          gsap.timeline()
            .set(ch, { x: rand(-6, 6), skewX: rand(-12, 12), textShadow: '-4px 0 #7ef9ff, 4px 0 #ff2a12', opacity: 0.85 })
            .set(ch, { x: rand(-3, 3), skewX: 0, textShadow: '3px 0 #7ef9ff, -3px 0 #ff2a12', opacity: 1 }, 0.06)
            .set(ch, { x: 0, textShadow: 'none' }, 0.13)
        }
      }
      flick()
    }, rand(1600, 4200))
  }

  function prepare(): void {
    splitTitle()
    if (reduced()) return
    gsap.set(app, { opacity: 0 })
    gsap.set([sky, zone, sub, cta], { opacity: 0 })
    if (split) gsap.set(split.chars, { opacity: 0 })
  }

  function intro(): gsap.core.Timeline {
    splitTitle()
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } })
    if (reduced()) {
      crt?.start()
      return tl
    }
    tl.to(app, { opacity: 1, duration: 1.4 }, 0)
      .fromTo(app, { scale: 1.06, filter: 'brightness(2.4) blur(8px)' }, { scale: 1, filter: 'brightness(1) blur(0px)', duration: 1.7, clearProps: 'filter' }, 0)
      .fromTo(sky, { opacity: 0, y: -60, filter: 'blur(20px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.5, clearProps: 'filter' }, 0.15)
      .set(zone, { opacity: 1 }, 0.35)
      .add(() => { crt?.powerOn(1.2) }, 0.35)
    if (split) {
      tl.fromTo(split.chars, { opacity: 0, yPercent: 70, filter: 'blur(14px)' }, { opacity: 1, yPercent: 0, filter: 'blur(0px)', stagger: 0.045, duration: 1.1, clearProps: 'filter' }, 0.8)
    }
    tl.fromTo(sub, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 1 }, 1.25)
      .fromTo(cta, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 1 }, 1.4)
      .add(flick, 2.2)
    return tl
  }

  /* ───────── Scroll: switch the tube off, bring the product into focus ───────── */
  const mm = gsap.matchMedia()
  mm.add({ wide: '(min-width: 901px)', motion: '(prefers-reduced-motion: no-preference)' }, (ctx) => {
    const { wide, motion } = ctx.conditions as { wide: boolean; motion: boolean }
    if (!wide || !motion) return
    const fade = $('.hero-fade', section)
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger: section, start: 'top top', end: '+=90%', pin: true, scrub: 0.7, anticipatePin: 1 }
    })
    // fromTo with explicit starts: ScrollTrigger records start values early (before the intro has run),
    // so a plain .to() would remember the hidden pre-intro state and restore it at the top of the page.
    const off = { immediateRender: false }
    tl.fromTo(sky, { yPercent: 0, opacity: 1, filter: 'blur(0px)' }, { yPercent: -45, opacity: 0, filter: 'blur(16px)', duration: 0.5, ...off }, 0)
      .fromTo([title, sub, cta], { y: 0, opacity: 1 }, { y: -70, opacity: 0, stagger: 0.04, duration: 0.45, ...off }, 0.08)
      .fromTo(app, { '--sf': 0 }, { '--sf': 1, duration: 0.6, ...off }, 0.2)
      .fromTo(fade, { opacity: 1 }, { opacity: 0, duration: 0.5, ...off }, 0.3)
      .fromTo(app, { scale: 1, borderRadius: 0 }, { scale: 0.88, borderRadius: 18, duration: 1, ...off }, 0)
    // The tube switches off between 12% and 57% of the pin (read from the scrubbed timeline, so it eases too).
    if (crt) {
      const tv = crt
      tl.eventCallback('onUpdate', () => {
        tv.scrollPower = 1 - Math.min(1, Math.max(0, (tl.progress() - 0.12) / 0.45))
      })
    }
    // Narrowing the window drops the pin; the tube must not stay switched off.
    return () => {
      if (crt) crt.scrollPower = 1
    }
  })

  return { prepare, intro, crt }
}
