/* Wavi website entry: plugins, smooth scroll, the boot sequence, page-wide motion, then every section. */
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import Lenis from 'lenis'
import Snap from 'lenis/snap'
import { initCompare } from './compare'
import { BOOT, ZH } from './data'
import { initFlow } from './flow'
import { burst, glitch, grain, initFx, initMagnetic, initScramble } from './fx'
import { initGraph } from './graph'
import { initHero, type Hero } from './hero'
import { initOutro } from './outro'
import { initPoster } from './poster'
import { initStatus } from './status'
import { $, $$, fontReady, reduced, root, sleep, typing } from './util'

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin, Flip)

/* ───────── Smooth scroll ───────── */
// A little less glide than Lenis's default, so a flick doesn't sail past a section.
const lenis = reduced() ? null : new Lenis({ lerp: 0.16, wheelMultiplier: 0.85, smoothWheel: true })
// Dev only: reach GSAP and Lenis from the browser console.
if (import.meta.env.DEV) Object.assign(window, { gsap, ScrollTrigger, lenis })
if (lenis) {
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
}
document.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href^="#"]') : null
  if (!a) return
  const id = a.getAttribute('href') ?? '#'
  const target: HTMLElement | number | null = id === '#' || id === '#top' ? 0 : document.querySelector<HTMLElement>(id)
  if (target == null) return
  e.preventDefault()
  if (lenis) lenis.scrollTo(target, { duration: 1.6 })
  else if (typeof target === 'number') window.scrollTo({ top: 0 })
  else target.scrollIntoView()
  glitch(0.25, 160)
})

/* ───────── Boot: a terminal wakes up, then the tube powers on ───────── */

async function boot(open: () => void): Promise<void> {
  const el = $('[data-boot]')
  const log = $('[data-boot-log]')
  if (!el || !log || reduced()) {
    el?.classList.add('is-done')
    open()
    return
  }
  lenis?.stop()
  let skip = false
  const skipNow = (): void => { skip = true }
  window.addEventListener('keydown', skipNow, { once: true })
  window.addEventListener('wheel', skipNow, { once: true, passive: true })
  el.addEventListener('pointerdown', skipNow, { once: true })
  for (const line of BOOT) {
    if (skip) break
    const tmp = document.createElement('div')
    tmp.innerHTML = line
    const plain = tmp.textContent ?? ''
    const row = document.createElement('div')
    log.append(row)
    for (let i = 1; i <= plain.length && !skip; i += 2) {
      row.textContent = plain.slice(0, i)
      row.insertAdjacentHTML('beforeend', '<span class="caret"></span>')
      await sleep(16)
    }
    row.innerHTML = line
    if (!skip) await sleep(140)
  }
  log.lastElementChild?.insertAdjacentHTML('beforeend', '<span class="caret"></span>')
  if (!skip) await sleep(320)
  await gsap
    .timeline()
    .to(log, { opacity: 0, duration: 0.12 })
    .fromTo('.boot-line', { opacity: 0, scaleX: 0 }, { opacity: 1, scaleX: 1, duration: 0.26, ease: 'expo.out' })
    .add(open)
    .to('.boot-top', { yPercent: -100, duration: 0.85, ease: 'expo.inOut' }, '+=0.04')
    .to('.boot-bottom', { yPercent: 100, duration: 0.85, ease: 'expo.inOut' }, '<')
    .to('.boot-line', { scaleY: 40, opacity: 0, duration: 0.5, ease: 'expo.out' }, '<+0.05')
  el.classList.add('is-done')
  lenis?.start()
}

/* ───────── Nav, progress, section reveals ───────── */
function initNav(): void {
  const nav = $('[data-nav]')
  const bar = $('[data-progress]')
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      nav?.classList.toggle('is-hidden', self.direction === 1 && self.scroll() > 240)
      bar?.style.setProperty('--p', self.progress.toFixed(4))
    }
  })
  for (const a of $$('[data-nav-link]')) {
    const sec = document.getElementById(a.dataset.navLink ?? '')
    if (!sec) continue
    ScrollTrigger.create({ trigger: sec, start: 'top 55%', end: 'bottom 45%', onToggle: (s) => a.classList.toggle('is-current', s.isActive) })
  }
}

function rgbFlash(el: HTMLElement): void {
  gsap.fromTo(el, { textShadow: '-5px 0 #7ef9ff, 5px 0 #ff2a12' }, { textShadow: '0px 0 rgba(126,249,255,0), 0px 0 rgba(255,42,18,0)', duration: 0.7, ease: 'power2.out', clearProps: 'textShadow' })
}

function initReveals(): void {
  if (reduced()) return
  for (const el of $$('[data-split]')) {
    // English needs word wrappers, or lines break inside words; Chinese breaks between characters anyway.
    SplitText.create(el, {
      type: ZH ? 'chars' : 'words,chars',
      charsClass: 'char',
      onSplit: (self) =>
        gsap.from(self.chars, {
          opacity: 0,
          yPercent: 60,
          filter: 'blur(12px)',
          duration: 1.1,
          ease: 'expo.out',
          stagger: 0.035,
          clearProps: 'filter',
          onComplete: () => rgbFlash(el),
          scrollTrigger: { trigger: el, start: 'top 82%', toggleActions: 'play none none none' }
        })
    })
  }
  for (const el of $$('[data-fade-up]')) {
    gsap.from(el, { opacity: 0, y: 24, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none none' } })
  }
  for (const id of ['status', 'compare', 'merge', 'flow', 'download']) {
    const sec = document.getElementById(id)
    if (!sec) continue
    ScrollTrigger.create({ trigger: sec, start: 'top 62%', onEnter: () => glitch(0.45, 240), onEnterBack: () => glitch(0.25, 160) })
  }
}

/* ───────── Snap: settle on whole screens ─────────
   Pinned sections (hero, status, graph) already hold the screen while they play; the free-scrolling ones
   (compare, flow, poster) used to glide past. Proximity snapping lands on a section's frame when you stop
   near it and leaves you alone in between. Points are rebuilt after every ScrollTrigger refresh (pins move them). */
function initSnap(): void {
  if (!lenis) return
  const snap = new Snap(lenis, { type: 'proximity', distanceThreshold: '28%', debounce: 380, duration: 0.9 })
  let removers: (() => void)[] = []
  const topOf = (id: string): number | null => {
    const el = document.getElementById(id)
    return el ? el.getBoundingClientRect().top + window.scrollY : null
  }
  const runOf = (id: string): number => {
    const el = document.getElementById(id)
    return el ? Math.max(0, el.offsetHeight - window.innerHeight) : 0
  }
  const build = (): void => {
    removers.forEach((r) => r())
    removers = []
    if (window.innerWidth <= 900) return
    const points: number[] = [0]
    const status = topOf('status')
    // the three steps of the overview (they switch at 30% and 62% of the section's run)
    if (status != null) for (const p of [0.12, 0.46, 0.84]) points.push(status + runOf('status') * p)
    const compare = topOf('compare')
    if (compare != null) points.push(compare)
    const merge = topOf('merge')
    // the graph's first frame and its finished frame
    if (merge != null) points.push(merge, merge + runOf('merge'))
    for (const id of ['flow', 'download']) {
      const y = topOf(id)
      if (y != null) points.push(y)
    }
    points.push(document.documentElement.scrollHeight - window.innerHeight)
    for (const y of points) removers.push(snap.add(Math.round(y)))
  }
  ScrollTrigger.addEventListener('refresh', build)
  build()
}

/* ───────── Type "wavi" anywhere ───────── */
function easterEgg(hero: Hero | null): void {
  let buf = ''
  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return
    buf = (buf + e.key.toLowerCase()).slice(-4)
    if (buf !== 'wavi') return
    buf = ''
    glitch(1, 900)
    hero?.crt?.shock(1)
    burst(window.innerWidth / 2, window.innerHeight / 2, { n: 240, speed: 17, chars: ['W', 'A', 'V', 'I', '?', '·'], size: [10, 24], life: 1700, gravity: 0.2 })
    if (reduced()) return
    root.classList.add('is-storm')
    window.setTimeout(() => root.classList.remove('is-storm'), 900)
  })
}

/* ───────── Start ───────── */
grain()
initFx()
const hero = initHero()
if (import.meta.env.DEV) Object.assign(window, { hero })
initStatus()
initCompare()
initGraph()
initFlow()
initPoster()
initOutro()
initNav()
initReveals()
initSnap()
initMagnetic()
initScramble()
easterEgg(hero)
hero?.prepare()
root.classList.add('ready')
void Promise.all([fontReady('900 100px "Wavi Hei"'), fontReady('800 100px "Wavi Archivo"')]).then(() => ScrollTrigger.refresh())
void boot(() => { hero?.intro() })

console.log('%cWAVI', 'font: 900 40px sans-serif; color: #ff5fb0; letter-spacing: -1px', ZH ? '\n一个人，多线程。试试在页面上输入 wavi。' : '\nOne person, many threads. Try typing “wavi” on the page.')
