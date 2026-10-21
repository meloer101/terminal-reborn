/* Footer: WAVI made of monospace particles. They gather as the page reaches the end, scatter under the
   pointer and spring back; a slow band of light keeps shifting the glyph density. */
import { gsap } from 'gsap'
import { $, clamp, dpr, fineMq, fontReady, loop, pick, reduced, watch } from './util'

interface P {
  hx: number
  hy: number
  cov: number
  sx: number
  sy: number
  d: number
  x: number
  y: number
  vx: number
  vy: number
  g: number
  gch: string
}

const RAMP = '.:-=+*#%@'
const NOISE = [...'01/\\<>{}[]|_+~^;?']

export function initOutro(): void {
  const box = $('[data-outro]')
  if (!box) return
  const canvas = document.createElement('canvas')
  box.append(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  let parts: P[] = []
  let W = 0
  let H = 0
  let font = ''
  let ptr: { x: number; y: number } | null = null
  let visible = false
  const state = { p: reduced() ? 1 : 0 }

  function sample(): void {
    if (!ctx) return
    W = box?.clientWidth ?? 0
    H = box?.clientHeight ?? 0
    if (!W || !H) return
    const k = dpr(2)
    canvas.width = Math.round(W * k)
    canvas.height = Math.round(H * k)
    ctx.setTransform(k, 0, 0, k, 0, 0)
    const size = clamp(W / 130, 6.5, 11)
    const cw = size * 0.62
    const rh = size * 1.05
    const cols = Math.floor(W / cw)
    const rows = Math.floor(H / rh)
    const S = 4
    const off = document.createElement('canvas')
    off.width = cols * S
    off.height = rows * S
    const o = off.getContext('2d', { willReadFrequently: true })
    if (!o) return
    o.fillStyle = '#fff'
    o.textAlign = 'center'
    o.textBaseline = 'middle'
    o.font = `900 100px "Wavi Archivo", Archivo, sans-serif`
    o.fontStretch = 'expanded'
    const fs = Math.min(off.height * 0.95, (off.width * 0.86) / (o.measureText('WAVI').width / 100))
    o.font = `900 ${fs}px "Wavi Archivo", Archivo, sans-serif`
    o.fontStretch = 'expanded'
    o.fillText('WAVI', off.width / 2, off.height * 0.55)
    const data = o.getImageData(0, 0, off.width, off.height).data
    const old = parts
    parts = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0
        for (let y = 0; y < S; y++) {
          const base = ((r * S + y) * off.width + c * S) * 4 + 3
          for (let x = 0; x < S; x++) sum += data[base + x * 4] ?? 0
        }
        const cov = sum / (S * S * 255)
        if (cov < 0.12) continue
        const ang = Math.random() * Math.PI * 2
        const far = (0.4 + Math.random() * 0.8) * Math.max(W, H) * 0.6
        const prev = old[parts.length]
        parts.push({
          hx: (c + 0.5) * cw,
          hy: (r + 0.5) * rh,
          cov,
          sx: Math.cos(ang) * far,
          sy: Math.sin(ang) * far,
          d: Math.random() * 0.35,
          x: prev ? prev.x : W / 2,
          y: prev ? prev.y : H / 2,
          vx: 0,
          vy: 0,
          g: 0,
          gch: ''
        })
      }
    }
    font = `500 ${size}px "JetBrains Mono Web", "SF Mono", monospace`
    frame(true)
  }

  function frame(settle: boolean): void {
    if (!ctx) return
    const gather = Math.min(1, state.p / 0.75)
    const now = reduced() ? 0 : performance.now()
    const R = 90
    ctx.clearRect(0, 0, W, H)
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const hot: [string, number, number, number][] = []
    for (const q of parts) {
      const t = clamp((gather - q.d) / 0.65, 0, 1)
      const e = 1 - (1 - t) ** 3
      const tx = q.hx + q.sx * (1 - e)
      const ty = q.hy + q.sy * (1 - e)
      if (settle) {
        q.x = tx
        q.y = ty
      } else {
        if (ptr) {
          const dx = q.x - ptr.x
          const dy = q.y - ptr.y
          const d2 = dx * dx + dy * dy
          if (d2 < R * R) {
            const d = Math.sqrt(d2) || 1
            const f = (1 - d / R) * 3.4
            q.vx += (dx / d) * f
            q.vy += (dy / d) * f
            q.g = 1
          }
        }
        if (q.g <= 0 && Math.random() < 0.0012) q.g = 0.6
        q.vx = (q.vx + (tx - q.x) * 0.085) * 0.8
        q.vy = (q.vy + (ty - q.y) * 0.085) * 0.8
        q.x += q.vx
        q.y += q.vy
      }
      const shade = 0.5 + 0.5 * Math.sin(now * 0.0011 - (q.hx * 0.5 + q.hy) / 80)
      const level = q.cov * (0.4 + 0.6 * shade)
      const a = (0.1 + 0.9 * e) * (0.5 + 0.5 * level)
      if (q.g > 0) {
        if (!q.gch || Math.random() < 0.3) q.gch = pick(NOISE)
        q.g -= 0.022
        hot.push([q.gch, q.x, q.y, a])
        continue
      }
      ctx.globalAlpha = a
      ctx.fillStyle = '#8c8c8c'
      ctx.fillText(RAMP[Math.min(RAMP.length - 1, Math.floor(level * RAMP.length))] ?? '.', q.x, q.y)
    }
    for (const [ch, x, y, a] of hot) {
      ctx.globalAlpha = Math.min(1, a + 0.3)
      ctx.fillStyle = Math.random() < 0.5 ? '#ff5fb0' : '#ffffff'
      ctx.fillText(ch, x, y)
    }
    ctx.globalAlpha = 1
  }

  const run = loop(() => {
    if (!visible) return false
    frame(false)
  })

  void fontReady('900 100px "Wavi Archivo"').then(sample)
  sample()
  let size = `${box.clientWidth}x${box.clientHeight}`
  const relayout = (): void => {
    const next = `${box.clientWidth}x${box.clientHeight}`
    if (next === size) return
    size = next
    sample()
  }
  new ResizeObserver(relayout).observe(box)
  watch(box, (on) => {
    visible = on
    if (on && !reduced()) run.start()
  }, '100px')

  if (fineMq.matches && !reduced()) {
    box.addEventListener('pointermove', (e) => {
      const r = box.getBoundingClientRect()
      ptr = { x: e.clientX - r.left, y: e.clientY - r.top }
    })
    box.addEventListener('pointerleave', () => { ptr = null })
  }
  if (reduced()) return
  // The footer bar sits below, so the box never reaches the viewport's bottom edge: finish at the page's end.
  gsap.fromTo(state, { p: 0 }, { p: 1, ease: 'none', scrollTrigger: { trigger: box, start: 'top bottom', end: 'max', scrub: 0.8 } })
}
