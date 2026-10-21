/* 叫你: the overview regroups in three steps as the section scrolls by. On the last step a macOS
   notification slides in and the Dock icon bounces with its badge. */
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { GROUPS, OV, STATUS_TEXT, STEPS, waited } from './data'
import { $, $$, glyph, h, narrowMq, reduced, watch, type Status } from './util'

export function initStatus(): void {
  const sec = $('[data-status-sec]')
  const list = $('[data-ov]')
  if (!sec || !list) return
  const ovList: HTMLElement = list
  const sub = $('[data-ov-sub]', sec)
  const idx = $$('[data-steps-index] li', sec)
  const notif = $('[data-notif]', sec)
  const dock = $('[data-dock]', sec)
  const badge = $('[data-dock-badge]', sec)

  const groups = {} as Record<Status, HTMLElement>
  for (const [key, label] of GROUPS) {
    const g = h('div', 'ov-group')
    g.innerHTML = `<div class="ov-gh">${label}<b data-n></b></div>`
    groups[key] = g
    list.append(g)
  }
  const rows: Record<string, HTMLElement> = {}
  for (const r of OV) {
    const row = h('div', 'ov-row')
    row.innerHTML = `<span class="g">${glyph('running')}<span data-st></span></span><span class="ti">${r.t}</span><span class="su" data-su></span><span class="sa">${r.d}</span><span class="tm" data-tm></span>`
    rows[r.id] = row
  }

  let current = -1
  let waitTick = 0
  const ping = (el: Element | null): void => {
    if (!el || reduced()) return
    el.classList.remove('is-ping')
    void (el as HTMLElement).offsetWidth
    el.classList.add('is-ping')
  }

  function showAlert(on: boolean): void {
    clearInterval(waitTick)
    if (narrowMq.matches) return
    if (reduced()) {
      gsap.set(notif, { x: on ? 0 : '120%', opacity: on ? 1 : 0 })
      gsap.set(dock, { yPercent: on ? 0 : 140, opacity: on ? 1 : 0 })
      return
    }
    if (on) {
      gsap.to(notif, { x: 0, opacity: 1, duration: 0.9, ease: 'expo.out', overwrite: true })
      gsap.to(dock, { yPercent: 0, opacity: 1, duration: 0.8, ease: 'expo.out', overwrite: true })
      const wavi = dock ? $('.dock-wavi', dock) : null
      if (wavi) gsap.fromTo(wavi, { y: 0 }, { y: -26, duration: 0.32, ease: 'power2.out', yoyo: true, repeat: 5, delay: 0.3 })
      if (badge) gsap.fromTo(badge, { scale: 0 }, { scale: 1, duration: 0.6, ease: 'back.out(3)', delay: 0.25 })
      let s = 60
      const tm = rows.cookie ? $('[data-tm]', rows.cookie) : null
      waitTick = window.setInterval(() => {
        s += 1
        if (tm) tm.textContent = waited(s)
      }, 1000)
    } else {
      gsap.to(notif, { x: '120%', opacity: 0, duration: 0.5, ease: 'expo.in', overwrite: true })
      gsap.to(dock, { yPercent: 140, opacity: 0, duration: 0.5, ease: 'expo.in', overwrite: true })
    }
  }

  function apply(i: number, animate: boolean): void {
    if (i === current) return
    const prev = current
    current = i
    const step = STEPS[i]
    if (!step) return
    const flip = animate && !reduced()
    const state = flip ? Flip.getState($$('.ov-row, .ov-group', ovList)) : null
    for (const r of OV) {
      const d = step.rows[r.id]
      const row = rows[r.id]
      if (!d || !row) continue
      const was = row.dataset.status
      row.dataset.status = d.status
      $('use', row)?.setAttribute('href', `#g-${d.status}`)
      const st = $('[data-st]', row)
      const su = $('[data-su]', row)
      const tm = $('[data-tm]', row)
      if (st) st.textContent = STATUS_TEXT[d.status]
      if (su) su.textContent = d.su
      if (tm) tm.textContent = d.tm
      groups[d.status].append(row)
      if (d.status === 'needs_you' && was !== 'needs_you' && prev !== -1) ping($('.g svg', row))
    }
    for (const [key] of GROUPS) {
      const n = groups[key].querySelectorAll('.ov-row').length
      groups[key].hidden = n === 0
      const nEl = $('[data-n]', groups[key])
      if (nEl) nEl.textContent = String(n)
    }
    if (sub) sub.textContent = step.sub
    sec?.setAttribute('data-step', String(i))
    idx.forEach((li, k) => {
      li.classList.toggle('is-on', k === i)
      li.classList.toggle('is-done', k < i)
    })
    if (state) {
      Flip.from(state, {
        duration: 0.8,
        ease: 'expo.out',
        stagger: 0.015,
        nested: true,
        onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.5 }),
        onLeave: (els) => gsap.to(els, { opacity: 0, duration: 0.3 })
      })
    }
    if ((i === 2) !== (prev === 2)) showAlert(i === 2)
  }

  gsap.set(notif, { x: '120%', opacity: 0 })
  gsap.set(dock, { yPercent: 140, opacity: 0 })

  // Desktop: the sticky section scrubs through the three steps. Narrow screens: it plays on its own while visible.
  const mm = gsap.matchMedia()
  mm.add('(min-width: 901px)', () => {
    apply(0, false)
    const bars = idx.map((li) => $('i', li))
    const st = ScrollTrigger.create({
      trigger: sec,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        const p = self.progress
        apply(p < 0.3 ? 0 : p < 0.62 ? 1 : 2, true)
        const local = [p / 0.3, (p - 0.3) / 0.32, (p - 0.62) / 0.38]
        bars.forEach((b, k) => b && gsap.set(b, { scaleX: Math.min(1, Math.max(0, local[k] ?? 0)) }))
      }
    })
    return () => st.kill()
  })
  mm.add('(max-width: 900px)', () => {
    gsap.set([notif, dock], { clearProps: 'all' })
    if (reduced()) {
      apply(2, false)
      return
    }
    apply(0, false)
    let on = false
    const stop = watch(sec, (v) => { on = v }, '-20%')
    const timer = window.setInterval(() => { if (on) apply((current + 1) % 3, true) }, 3200)
    return () => {
      stop()
      clearInterval(timer)
    }
  })
}
