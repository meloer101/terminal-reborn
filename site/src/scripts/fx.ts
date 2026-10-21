/* Page-wide effects: film grain, one overlay canvas for particles and signal glitches,
   magnetic buttons, sparks and scrambled hovers. The pointer itself stays the system cursor. */
import { gsap } from 'gsap'
import { $$, clamp, dpr, fineMq, h, loop, pick, rand, reduced, root } from './util'

/* ───────── Film grain (a noise tile the CSS shifts around) ───────── */
export function grain(): void {
  const c = document.createElement('canvas')
  c.width = c.height = 200
  const x = c.getContext('2d')
  if (!x) return
  const d = x.createImageData(200, 200)
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 255
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v
    d.data[i + 3] = 255
  }
  x.putImageData(d, 0, 0)
  root.style.setProperty('--grain', `url(${c.toDataURL()})`)
}

/* ───────── Overlay canvas: particles + glitch bars ───────── */
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  ch: string
  drag: number
  g: number
  rot: number
  vr: number
}
export interface BurstOptions {
  n: number
  speed: number
  colors: string[]
  chars: string[]
  size: [number, number]
  life: number
  gravity: number
  drag: number
  spreadX: number
  spreadY: number
  /** direction in radians; with `arc` the burst is a cone instead of a ring */
  angle: number | null
  arc: number
}

const canvas = h('canvas', 'fx')
canvas.setAttribute('aria-hidden', 'true')
const ctx = canvas.getContext('2d')
let W = 0
let H = 0
const parts: Particle[] = []
let glitchEnd = 0
let glitchLen = 1
let glitchAmt = 0
const GLITCH_COLORS = ['#7ef9ff', '#ff5fb0', '#ffffff', '#2141ff', '#ffd000']

function size(): void {
  const r = dpr(1.5)
  W = window.innerWidth
  H = window.innerHeight
  canvas.width = Math.round(W * r)
  canvas.height = Math.round(H * r)
  ctx?.setTransform(r, 0, 0, r, 0, 0)
}

const run = loop((now, dt) => {
  if (!ctx) return false
  ctx.clearRect(0, 0, W, H)
  const k = dt / 16.67
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (!p) continue
    p.life -= dt
    if (p.life <= 0) {
      parts.splice(i, 1)
      continue
    }
    const drag = Math.pow(p.drag, k)
    p.vx *= drag
    p.vy = p.vy * drag + p.g * k
    p.x += p.vx * k
    p.y += p.vy * k
    p.rot += p.vr * k
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1)
    ctx.fillStyle = p.color
    if (p.ch) {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.font = `700 ${p.size}px "JetBrains Mono Web", "SF Mono", monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(p.ch, 0, 0)
      ctx.restore()
    } else {
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
    }
  }
  ctx.globalAlpha = 1
  if (now < glitchEnd) {
    const t = (glitchEnd - now) / glitchLen
    const n = 2 + Math.round(t * glitchAmt * 16)
    for (let i = 0; i < n; i++) {
      ctx.globalAlpha = rand(0.05, 0.14 + 0.32 * t * glitchAmt)
      ctx.fillStyle = pick(GLITCH_COLORS)
      ctx.fillRect(rand(-W * 0.3, W * 0.6), Math.random() * H, rand(W * 0.2, W), rand(1, 3 + t * glitchAmt * 42))
    }
    ctx.globalAlpha = 1
  }
  if (!parts.length && now >= glitchEnd) {
    ctx.clearRect(0, 0, W, H)
    return false
  }
})

function add(p: Particle): void {
  if (parts.length > 1200) parts.shift()
  parts.push(p)
  run.start()
}

export function initFx(): void {
  document.body.append(canvas)
  size()
  window.addEventListener('resize', size)
}

/** Particles flying out of a point. */
export function burst(x: number, y: number, opts: Partial<BurstOptions> = {}): void {
  if (reduced()) return
  const o: BurstOptions = {
    n: 24,
    speed: 6,
    colors: ['#ffffff', '#ff5fb0', '#7ef9ff'],
    chars: [],
    size: [2, 4],
    life: 900,
    gravity: 0.12,
    drag: 0.95,
    spreadX: 0,
    spreadY: 0,
    angle: null,
    arc: Math.PI * 2,
    ...opts
  }
  for (let i = 0; i < o.n; i++) {
    const ang = o.angle == null ? rand(0, Math.PI * 2) : o.angle + rand(-o.arc / 2, o.arc / 2)
    const sp = rand(0.3, 1) * o.speed
    const life = o.life * rand(0.6, 1.15)
    add({
      x: x + rand(-o.spreadX, o.spreadX),
      y: y + rand(-o.spreadY, o.spreadY),
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life,
      max: life,
      size: rand(o.size[0], o.size[1]),
      color: pick(o.colors),
      ch: o.chars.length ? pick(o.chars) : '',
      drag: o.drag,
      g: o.gravity,
      rot: rand(-1, 1),
      vr: rand(-0.12, 0.12)
    })
  }
}

/** A short burst of horizontal signal bars across the whole screen. */
export function glitch(amount = 0.6, ms = 260): void {
  if (reduced()) return
  const now = performance.now()
  glitchEnd = Math.max(glitchEnd, now + ms)
  glitchLen = ms
  glitchAmt = Math.max(amount, now < glitchEnd ? glitchAmt * 0.5 : 0)
  run.start()
}

/* ───────── Magnetic buttons + sparks ───────── */
export function initMagnetic(): void {
  if (!fineMq.matches || reduced()) return
  for (const el of $$('[data-magnetic]')) {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.45, ease: 'power3' })
    const yTo = gsap.quickTo(el, 'y', { duration: 0.45, ease: 'power3' })
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect()
      xTo((e.clientX - (r.left + r.width / 2)) * 0.32)
      yTo((e.clientY - (r.top + r.height / 2)) * 0.45)
    })
    el.addEventListener('pointerleave', () => {
      gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.35)', overwrite: 'auto' })
    })
  }
  for (const el of $$('[data-spark]')) {
    el.addEventListener('pointerenter', () => {
      const r = el.getBoundingClientRect()
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          burst(r.left + rand(0, r.width), r.top + rand(0, r.height), {
            n: 10,
            speed: 3.5,
            size: [1.5, 3],
            life: 700,
            gravity: 0.05,
            colors: ['#ffffff', '#ff5fb0', '#7ef9ff', '#ffd000']
          })
        }, i * 90)
      }
    })
    el.addEventListener('click', () => {
      const r = el.getBoundingClientRect()
      burst(r.left + r.width / 2, r.top + r.height / 2, { n: 60, speed: 9, life: 1100, chars: ['✦', '·', '+', '*'], size: [8, 14] })
      glitch(0.35, 220)
    })
  }
}

/* ───────── Scrambled hovers on links ───────── */
const SCRAMBLE = '▓▒░<>/\\|_01'
export function initScramble(): void {
  if (reduced()) return
  for (const el of $$('[data-scramble]')) {
    let target: HTMLElement = el
    if (el.children.length) {
      const node = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      if (!node) continue
      const span = h('span', 'sc', node.textContent?.trim() ?? '')
      node.replaceWith(span, ' ')
      target = span
    }
    const text = target.textContent ?? ''
    el.addEventListener('pointerenter', () => {
      gsap.to(target, { duration: 0.55, scrambleText: { text, chars: SCRAMBLE, speed: 0.9, revealDelay: 0.08 }, overwrite: true })
    })
  }
}
