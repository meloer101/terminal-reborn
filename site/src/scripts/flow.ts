/* 从开工到合进主干: the overprint (two thin song layers that drift apart with the pointer under a heavy hei),
   periodic misregistration, the six columns, and the advisory stickers being slapped on. */
import { gsap } from 'gsap'
import { burst, glitch } from './fx'
import { $, $$, fineMq, rand, reduced, watch } from './util'

const SCRAMBLE = '▓▒░█<>/\\'

/** A sticker hits the page: drops in big and turned, lands with a shake and a puff of particles. */
export function slap(el: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline()
  tl.fromTo(el, { opacity: 0, scale: 2.8, rotation: -24 }, { opacity: 1, scale: 1, rotation: -2, duration: 0.42, ease: 'power4.in' })
    .add(() => {
      const r = el.getBoundingClientRect()
      burst(r.left + r.width / 2, r.top + r.height / 2, { n: 44, speed: 7.5, size: [2, 4.5], colors: ['#ffffff', '#ff5fb0', '#bdbdbd'], life: 800, spreadX: r.width / 3, spreadY: r.height / 3 })
      glitch(0.35, 180)
    })
    .to(el, { x: -5, duration: 0.04, yoyo: true, repeat: 3, ease: 'none' })
    .set(el, { x: 0 })
  return tl
}

export function initFlow(): void {
  const sec = $('[data-flow]')
  if (!sec) return
  const lines = $$('.ovp-line', sec)
  const advisory = $('[data-stamp]', sec)
  const six = $('[data-six]', sec)
  const items = six ? $$('li', six) : []
  let visible = false
  watch(sec, (on) => { visible = on })

  /* pointer: the two song layers drift apart (CSS reads --mx / --my) */
  if (fineMq.matches && !reduced()) {
    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0
    let raf = 0
    const step = (): void => {
      cx += (tx - cx) * 0.07
      cy += (ty - cy) * 0.07
      sec.style.setProperty('--mx', cx.toFixed(3))
      sec.style.setProperty('--my', cy.toFixed(3))
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.001 ? requestAnimationFrame(step) : 0
    }
    sec.addEventListener('pointermove', (e) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2
      const r = sec.getBoundingClientRect()
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2
      if (!raf) raf = requestAnimationFrame(step)
    })
    sec.addEventListener('pointerleave', () => {
      tx = 0
      ty = 0
      if (!raf) raf = requestAnimationFrame(step)
    })
  }

  if (reduced()) {
    if (advisory) gsap.set(advisory, { rotation: -2 })
    return
  }

  /* entrance: the layers converge out of a blur, then the sticker lands */
  const tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top 70%', toggleActions: 'play none none none' } })
  lines.forEach((line, i) => {
    const [a, b, k] = Array.from(line.children).map((c) => c.firstElementChild as HTMLElement | null)
    const at = i * 0.2
    if (a) tl.fromTo(a, { y: -90, opacity: 0, filter: 'blur(18px)' }, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 1.5, ease: 'expo.out', clearProps: 'filter' }, at)
    if (b) tl.fromTo(b, { y: 90, opacity: 0, filter: 'blur(18px)' }, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 1.5, ease: 'expo.out', clearProps: 'filter' }, at)
    if (k) tl.fromTo(k, { scale: 1.4, opacity: 0, filter: 'blur(26px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 1.25, ease: 'expo.out', clearProps: 'filter' }, at + 0.28)
  })
  if (advisory) {
    gsap.set(advisory, { opacity: 0, rotation: -2 })
    tl.add(() => { slap(advisory) }, '-=0.5')
  }

  /* now and then the plates slip out of register */
  const slip = (): void => {
    window.setTimeout(() => {
      if (visible && lines.length) {
        const line = lines[(Math.random() * lines.length) | 0]
        const [a, b, k] = line ? Array.from(line.children).map((c) => c.firstElementChild as HTMLElement | null) : []
        const g = gsap.timeline()
        if (a) g.set(a, { x: rand(-14, 14), y: rand(-6, 6) }, 0).set(a, { x: 0, y: 0 }, 0.09)
        if (b) g.set(b, { x: rand(-14, 14), y: rand(-6, 6) }, 0.02).set(b, { x: 0, y: 0 }, 0.12)
        if (k && Math.random() < 0.5) g.set(k, { skewX: rand(-10, 10), x: rand(-6, 6) }, 0.03).set(k, { skewX: 0, x: 0 }, 0.1)
      }
      slip()
    }, rand(1800, 4200))
  }
  slip()

  /* six columns: hairlines draw across, titles decode, lines rise */
  if (six && items.length) {
    const titles = items.map((li) => $('b', li)).filter((b): b is HTMLElement => !!b)
    const bodies = items.map((li) => $('span', li)).filter((s): s is HTMLElement => !!s)
    gsap.set(titles, { opacity: 0 })
    const t6 = gsap.timeline({ scrollTrigger: { trigger: six, start: 'top 82%', toggleActions: 'play none none none' } })
    t6.fromTo(items, { '--rule-s': 0 }, { '--rule-s': 1, duration: 1.1, ease: 'expo.inOut', stagger: 0.08 }, 0)
    titles.forEach((b, i) => {
      const at = 0.25 + i * 0.08
      t6.set(b, { opacity: 1 }, at)
      t6.to(b, { duration: 1, scrambleText: { text: b.dataset.text ?? '', chars: SCRAMBLE, speed: 0.6, revealDelay: 0.2 } }, at)
    })
    t6.fromTo(bodies, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', stagger: 0.08 }, 0.5)
    items.forEach((li) => {
      const b = $('b', li)
      if (!b) return
      li.addEventListener('pointerenter', () => {
        gsap.to(b, { duration: 0.5, scrambleText: { text: b.dataset.text ?? '', chars: SCRAMBLE, speed: 1 }, overwrite: true })
      })
    })
  }
}
