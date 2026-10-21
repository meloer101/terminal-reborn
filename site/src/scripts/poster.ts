/* Download poster: a live line-screen orbit (turns slowly, ripples, bends away from the pointer),
   WAVI letters that squeeze under the pointer (Archivo's width and weight axes), a barcode that settles on the
   release commit, mirrored type flickering in, and the UNATTENDED sticker. */
import { gsap } from 'gsap'
import orbitSvg from '../assets/orbit.svg?raw'
import { RELEASE } from './data'
import { slap } from './flow'
import { glitch } from './fx'
import { $, $$, clamp, dpr, fineMq, h, loop, rand, reduced, smooth, watch } from './util'

const ORBIT_D = /\sd="([^"]+)"/.exec(orbitSvg)?.[1] ?? ''
const VB = { x: 231, y: 172, w: 562.1, h: 680 }

/* ───────── Line-screen orbit ───────── */
function initOrbit(canvas: HTMLCanvasElement, sec: HTMLElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx || !ORBIT_D) return
  const path = new Path2D(ORBIT_D)
  let W = 0
  let H = 0
  let MW = 0
  let MH = 0
  let map = new Float32Array(0)
  const state = { appear: reduced() ? 1 : 0, reveal: reduced() ? 1 : 0, spin: 0 }
  let ptr: { x: number; y: number } | null = null
  let visible = false

  function bake(): void {
    const r = canvas.getBoundingClientRect()
    if (!r.width || !r.height) return
    const k = dpr(1.5)
    W = canvas.width = Math.round(r.width * k)
    H = canvas.height = Math.round(r.height * k)
    MW = Math.max(2, Math.round(W / 2))
    MH = Math.max(2, Math.round(H / 2))
    const off = document.createElement('canvas')
    off.width = MW
    off.height = MH
    const o = off.getContext('2d', { willReadFrequently: true })
    if (!o) return
    o.fillStyle = '#000'
    o.fillRect(0, 0, MW, MH)
    const s = Math.min(MW / VB.w, MH / VB.h) * 0.82
    const place = (): void => {
      o.translate(MW * 0.52, MH * 0.5)
      o.scale(s, s)
      o.translate(-(VB.x + VB.w / 2), -(VB.y + VB.h / 2))
    }
    o.save()
    place()
    o.filter = `blur(${Math.round(MW * 0.035)}px)`
    o.fillStyle = 'rgba(255,255,255,0.42)'
    o.fill(path, 'evenodd')
    o.restore()
    o.save()
    place()
    const g = o.createRadialGradient(470, 420, 10, 512, 512, 430)
    g.addColorStop(0, '#fff')
    g.addColorStop(0.55, '#cfcfcf')
    g.addColorStop(1, '#5a5a5a')
    o.fillStyle = g
    o.fill(path, 'evenodd')
    o.restore()
    const d = o.getImageData(0, 0, MW, MH).data
    map = new Float32Array(MW * MH)
    for (let i = 0; i < map.length; i++) {
      const j = i * 4
      map[i] = ((d[j] ?? 0) * 0.299 + (d[j + 1] ?? 0) * 0.587 + (d[j + 2] ?? 0) * 0.114) / 255
    }
    draw(performance.now())
  }

  function draw(now: number): void {
    if (!ctx || !W) return
    const t = reduced() ? 0 : now
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#fff'
    const ang = -0.14 + (reduced() ? 0 : Math.sin(t * 0.00016) * 0.1) + state.spin
    const cos = Math.cos(-ang)
    const sin = Math.sin(-ang)
    const cxm = W / 2
    const cym = H / 2
    const lum = (x: number, y: number): number => {
      const dx = x - cxm
      const dy = y - cym
      const rx = ((cos * dx - sin * dy + cxm) / 2) | 0
      const ry = ((sin * dx + cos * dy + cym) / 2) | 0
      if (rx < 0 || ry < 0 || rx >= MW || ry >= MH) return 0
      return map[ry * MW + rx] ?? 0
    }
    const gap = Math.max(6, H / 78)
    const step = Math.max(2, Math.round(gap / 4))
    const amp = 0.6
    const R = 150 * (W / canvas.clientWidth || 1)
    const revealX = state.reveal * (W + 240) - 120
    for (let y0 = gap / 2; y0 < H + gap; y0 += gap) {
      const top: number[] = []
      const bot: number[] = []
      for (let px = 0; px <= W + step; px += step) {
        let v = smooth(0.06, 0.9, (lum(px, y0 - gap * 0.33) + lum(px, y0) + lum(px, y0 + gap * 0.33)) / 3)
        v *= state.appear * smooth(revealX, revealX - 160, px)
        let yc = y0 - v * gap * amp + Math.sin(px / W * 9 + y0 / H * 5 + t * 0.0011) * gap * 0.12
        if (ptr) {
          const dx = px - ptr.x
          const dy = y0 - ptr.y
          const f = Math.exp(-(dx * dx + dy * dy) / (R * R))
          yc += (dy >= 0 ? 1 : -1) * f * gap * 1.7
          v = Math.min(1, v * (1 + f * 0.6))
        }
        const th = v * gap * 0.96
        top.push(px, yc - th / 2)
        bot.push(px, yc + th / 2)
      }
      ctx.beginPath()
      ctx.moveTo(top[0] ?? 0, top[1] ?? 0)
      for (let i = 2; i < top.length; i += 2) ctx.lineTo(top[i] ?? 0, top[i + 1] ?? 0)
      for (let i = bot.length - 2; i >= 0; i -= 2) ctx.lineTo(bot[i] ?? 0, bot[i + 1] ?? 0)
      ctx.closePath()
      ctx.fill()
    }
  }

  let acc = 0
  const run = loop((now, dt) => {
    if (!visible) return false
    acc += dt
    if (acc < 33) return
    acc = 0
    draw(now)
  })

  const relayout = (): void => bake()
  new ResizeObserver(relayout).observe(canvas)
  bake()

  watch(canvas, (on) => {
    visible = on
    if (on && !reduced()) run.start()
  }, '120px')
  if (fineMq.matches && !reduced()) {
    sec.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect()
      const k = W / r.width
      ptr = { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }
    })
    sec.addEventListener('pointerleave', () => { ptr = null })
  }
  if (reduced()) return
  gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top 75%', toggleActions: 'play none none none' } })
    .to(state, { reveal: 1, duration: 2.2, ease: 'power2.inOut' }, 0)
    .to(state, { appear: 1, duration: 1.6, ease: 'power2.out' }, 0)
  gsap.fromTo(state, { spin: -0.35 }, { spin: 0.3, ease: 'none', scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: 0.8 } })
}

/* ───────── Barcode from the release commit ───────── */
function barcode(el: SVGSVGElement, hash: string, noise = false): void {
  const bits = noise
    ? Array.from({ length: 40 }, () => (Math.random() < 0.5 ? '1' : '0')).join('')
    : [...hash].map((c) => parseInt(c, 16).toString(2).padStart(4, '0')).join('')
  let x = 0
  let out = ''
  for (let i = 0; i < bits.length && x < 272; i++) {
    const w = bits[i] === '1' ? 5 : 2
    out += `<rect x="${x}" y="0" width="${w}" height="52"/>`
    x += w + (i % 3) + 2
  }
  el.innerHTML = out
}

export function initPoster(): void {
  const sec = $('[data-poster]')
  if (!sec) return
  const orbit = $<HTMLCanvasElement>('[data-orbit]', sec)
  if (orbit) initOrbit(orbit, sec)

  const bar = $<SVGSVGElement>('[data-barcode]', sec)
  if (bar) barcode(bar, RELEASE.commit)
  const label = $('[data-barcode-label]', sec)
  const term = $('[data-p-term]', sec)
  const letters = $$('[data-p-wavi] span', sec)
  const mirror = $('[data-mirror]', sec)
  const sticker = $('[data-stamp]', sec)

  // mirrored type, one span per character so it can flicker in
  const mchars: HTMLElement[] = []
  if (mirror) {
    const frag = document.createDocumentFragment()
    for (const n of Array.from(mirror.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) {
        for (const ch of n.textContent ?? '') {
          const s = h('span', 'mc', ch)
          mchars.push(s)
          frag.append(s)
        }
      } else frag.append(n.cloneNode(true))
    }
    mirror.replaceChildren(frag)
  }

  /* WAVI squeezes under the pointer: each letter's width and weight follow its distance to the cursor */
  if (letters.length && fineMq.matches && !reduced()) {
    const st = letters.map(() => ({ w: 125, g: 900, tw: 125, tg: 900 }))
    let raf = 0
    const step = (): void => {
      let moving = false
      letters.forEach((el, i) => {
        const s = st[i]
        if (!s) return
        s.w += (s.tw - s.w) * 0.14
        s.g += (s.tg - s.g) * 0.14
        if (Math.abs(s.tw - s.w) + Math.abs(s.tg - s.g) > 0.3) moving = true
        el.style.setProperty('--w', s.w.toFixed(1))
        el.style.setProperty('--wg', s.g.toFixed(0))
      })
      raf = moving ? requestAnimationFrame(step) : 0
    }
    sec.addEventListener('pointermove', (e) => {
      letters.forEach((el, i) => {
        const r = el.getBoundingClientRect()
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2))
        const f = Math.exp(-(d * d) / (280 * 280))
        const s = st[i]
        if (!s) return
        s.tw = clamp(125 - 63 * f, 62, 125)
        s.tg = clamp(900 - 520 * f, 100, 900)
      })
      if (!raf) raf = requestAnimationFrame(step)
    })
    sec.addEventListener('pointerleave', () => {
      st.forEach((s) => {
        s.tw = 125
        s.tg = 900
      })
      if (!raf) raf = requestAnimationFrame(step)
    })
  }

  if (reduced()) {
    if (sticker) gsap.set(sticker, { rotation: -2 })
    return
  }

  if (sticker) gsap.set(sticker, { opacity: 0, rotation: -2 })
  if (mchars.length) gsap.set(mchars, { opacity: 0 })
  const tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top 68%', toggleActions: 'play none none none' } })
  if (letters.length) tl.fromTo(letters, { yPercent: 110, opacity: 0, filter: 'blur(20px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 1.2, ease: 'expo.out', stagger: 0.09, clearProps: 'filter' }, 0)
  if (term) tl.to(term, { duration: 1.1, scrambleText: { text: 'TERMINAL', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', speed: 0.5 } }, 0.35)
  if (bar) {
    const o = { n: 0 }
    tl.to(o, { n: 14, duration: 0.9, ease: 'none', onUpdate: () => barcode(bar, RELEASE.commit, true), onComplete: () => barcode(bar, RELEASE.commit) }, 0.5)
  }
  if (label) tl.to(label, { duration: 1, scrambleText: { text: 'PARALLELAGENTS', chars: '01', speed: 0.6 } }, 0.6)
  if (mchars.length) tl.to(mchars, { opacity: 1, duration: 0.04, stagger: { each: 0.012, from: 'random' } }, 0.8)
  if (sticker) tl.add(() => { slap(sticker) }, 1.4)

  // after that: the accent type slips now and then, and a few mirrored characters flicker
  const p = $('.p-wavi', sec)
  let visible = false
  watch(sec, (on) => { visible = on })
  const tick = (): void => {
    window.setTimeout(() => {
      if (visible) {
        if (p && Math.random() < 0.5) {
          gsap.timeline()
            .set(p, { textShadow: '-6px 0 #7ef9ff, 6px 0 #ffd000', x: rand(-6, 6) })
            .set(p, { textShadow: '4px 0 #7ef9ff, -4px 0 #ffd000', x: rand(-3, 3) }, 0.06)
            .set(p, { textShadow: 'none', x: 0 }, 0.12)
          if (Math.random() < 0.3) glitch(0.2, 140)
        }
        const few = mchars.filter(() => Math.random() < 0.08)
        if (few.length) gsap.timeline().set(few, { opacity: 0.15 }).set(few, { opacity: 1 }, 0.08).set(few, { opacity: 0.3 }, 0.14).set(few, { opacity: 1 }, 0.2)
      }
      tick()
    }, rand(1400, 3600))
  }
  tick()
}
