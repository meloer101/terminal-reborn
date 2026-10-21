/* 并排比: three agents take the same task. Their terminals type out side by side, the compare bars fill in,
   checks pop up (one fails and shakes), then you can open a diff or merge one; the rest get archived. */
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ATTEMPTS, CMP, type Attempt, type OutLine } from './data'
import { burst, glitch } from './fx'
import { $, esc, glyph, h, rand, reduced } from './util'

interface PaneUI {
  el: HTMLElement
  a: Attempt
  out: HTMLElement
  bar: HTMLElement
  stat: HTMLElement
  title: HTMLElement
  diffBtn: HTMLButtonElement | null
}

const MAX_LINES = 8

export function initCompare(): void {
  const box = $('[data-cmp]')
  const host = $('[data-cmp-panes]')
  const base = $('[data-cmp-base]')
  if (!box || !host) return
  const baseText = base?.textContent ?? ''

  const panes: PaneUI[] = ATTEMPTS.map((a, i) => {
    const el = h('div', 'pane')
    el.dataset.i = String(i)
    const diff = a.diff
      .map((d) => {
        const at = d.indexOf(':')
        return `<span class="${d.slice(0, at)}">${esc(d.slice(at + 1))}</span>`
      })
      .join('')
    el.innerHTML = `
      <div class="pane-title">${glyph('running')}<span>${esc(a.who)}</span><small>${esc(a.branch)}</small></div>
      <div class="pane-bar"><span class="pane-stat">${CMP.stat(0, 0, 0)}</span></div>
      <div class="pane-out"></div>
      <div class="pane-actions"><button class="pbtn" type="button" data-diff>${CMP.diff}</button><button class="pbtn pbtn-solid" type="button" data-merge>${CMP.merge}</button></div>
      <div class="pane-diff">${diff}</div>`
    host.append(el)
    return {
      el,
      a,
      out: $('.pane-out', el) as HTMLElement,
      bar: $('.pane-bar', el) as HTMLElement,
      stat: $('.pane-stat', el) as HTMLElement,
      title: $('.pane-title', el) as HTMLElement,
      diffBtn: $<HTMLButtonElement>('[data-diff]', el)
    }
  })

  const setGlyph = (p: PaneUI, status: 'running' | 'done_unread'): void => {
    $('use', p.title)?.setAttribute('href', `#g-${status}`)
  }

  function typeLine(p: PaneUI, line: OutLine, instant: boolean): void {
    const el = h('div', 'l')
    p.out.append(el)
    while (p.out.children.length > MAX_LINES) p.out.firstElementChild?.remove()
    const full = line.segs.map(([, t]) => t).join('')
    if (!full) {
      el.textContent = ' '
      return
    }
    const render = (n: number): void => {
      let left = n
      el.innerHTML =
        line.segs
          .map(([cls, t]) => {
            const part = t.slice(0, Math.max(0, left))
            left -= t.length
            return part ? `<span class="${cls}">${esc(part)}</span>` : ''
          })
          .join('') + (n < full.length ? '<span class="w">▌</span>' : '')
    }
    if (instant || reduced()) {
      render(full.length)
      return
    }
    const o = { n: 0 }
    gsap.to(o, { n: full.length, duration: Math.min(0.9, 0.022 * full.length + 0.08), ease: 'none', onUpdate: () => render(Math.round(o.n)) })
  }

  function addCheck(p: PaneUI, c: { ok: boolean; name: string }, quiet: boolean): void {
    const chk = h('span', `chk ${c.ok ? 'ok' : 'bad'}`, `<b>${c.ok ? '✓' : '✗'}</b>${esc(c.name)}`)
    p.bar.append(chk)
    if (quiet || reduced()) return
    gsap.from(chk, { scale: 0.3, opacity: 0, duration: 0.55, ease: 'back.out(3)' })
    const r = chk.getBoundingClientRect()
    if (c.ok) {
      burst(r.left + 8, r.top + 9, { n: 9, speed: 2.6, colors: ['#3dd68c', '#ffffff'], size: [1.5, 2.6], life: 520, gravity: 0 })
    } else {
      p.el.classList.remove('shake')
      void p.el.offsetWidth
      p.el.classList.add('shake')
      glitch(0.28, 200)
      burst(r.left + 8, r.top + 9, { n: 22, speed: 4.5, colors: ['#ff5c5c', '#ffffff'], size: [2, 3.4], life: 700 })
    }
  }

  function countUp(p: PaneUI, instant: boolean): void {
    const o = { a: 0, d: 0, f: 0 }
    const paint = (): void => {
      p.stat.textContent = CMP.stat(Math.round(o.a), Math.round(o.d), Math.round(o.f))
    }
    if (instant || reduced()) {
      Object.assign(o, { a: p.a.add, d: p.a.del, f: p.a.files })
      paint()
      return
    }
    gsap.to(o, { a: p.a.add, d: p.a.del, f: p.a.files, duration: 1.3, ease: 'power2.out', onUpdate: paint })
  }

  function finish(p: PaneUI, quiet: boolean): void {
    setGlyph(p, 'done_unread')
    if (quiet || reduced()) return
    const svgEl = $('svg', p.title)
    if (svgEl) gsap.fromTo(svgEl, { scale: 2.2 }, { scale: 1, duration: 0.6, ease: 'back.out(3)', transformOrigin: '50% 50%' })
  }

  let tl: gsap.core.Timeline | null = null
  let replay = 0

  function reset(): void {
    clearTimeout(replay)
    tl?.kill()
    tl = null
    for (const p of panes) {
      p.out.replaceChildren()
      p.bar.replaceChildren(p.stat)
      p.stat.textContent = CMP.stat(0, 0, 0)
      setGlyph(p, 'running')
      p.el.classList.remove('is-pick', 'is-merged', 'is-archived', 'show-diff', 'shake')
      if (p.diffBtn) p.diffBtn.textContent = CMP.diff
    }
    if (base) base.textContent = baseText
  }

  function settle(): void {
    reset()
    for (const p of panes) {
      p.a.lines.forEach((line) => {
        typeLine(p, line, true)
        if (line.check) addCheck(p, line.check, true)
      })
      countUp(p, true)
      finish(p, true)
    }
    panes[0]?.el.classList.add('is-pick')
  }

  function play(): void {
    if (reduced()) {
      settle()
      return
    }
    reset()
    const t0 = gsap.timeline()
    tl = t0
    panes.forEach((p, i) => {
      let t = 0.25 + i * 0.38
      p.a.lines.forEach((line) => {
        t0.add(() => typeLine(p, line, false), t)
        if (line.check) {
          const c = line.check
          t0.add(() => addCheck(p, c, false), t + 0.4)
        }
        t += line.segs.length ? rand(0.42, 0.72) : 0.12
      })
      t0.add(() => countUp(p, false), Math.max(0.5, t - 1.8))
      t0.add(() => finish(p, false), t + 0.1)
    })
    t0.add(() => panes[0]?.el.classList.add('is-pick'), '+=0.3')
  }

  function merge(i: number): void {
    const p = panes[i]
    if (!p) return
    if (tl && tl.progress() < 1) settle()
    clearTimeout(replay)
    panes.forEach((q, j) => {
      q.el.classList.remove('is-pick', 'show-diff')
      q.el.classList.toggle('is-merged', j === i)
      q.el.classList.toggle('is-archived', j !== i)
      q.el.dataset.badge = j === i ? CMP.merged : CMP.archived
    })
    if (base) {
      const text = CMP.done(p.a.branch, panes.length - 1)
      if (reduced()) base.textContent = text
      else gsap.to(base, { duration: 0.9, scrambleText: { text, chars: '▓▒░01', speed: 0.7 } })
    }
    const r = p.el.getBoundingClientRect()
    burst(r.left + r.width / 2, r.top + r.height * 0.42, { n: 90, speed: 10, chars: ['✓', '+', '·'], size: [10, 16], colors: ['#3dd68c', '#ffffff', '#7ef9ff'], life: 1200 })
    glitch(0.3, 200)
    replay = window.setTimeout(() => {
      if (box && ScrollTrigger.isInViewport(box)) play()
    }, 7000)
  }

  host.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null
    const pane = btn?.closest<HTMLElement>('.pane')
    if (!btn || !pane) return
    const i = Number(pane.dataset.i)
    if (btn.hasAttribute('data-diff')) {
      const on = pane.classList.toggle('show-diff')
      btn.textContent = on ? CMP.hideDiff : CMP.diff
      return
    }
    if (btn.hasAttribute('data-merge')) merge(i)
  })
  host.addEventListener('pointermove', (e) => {
    const pane = e.target instanceof Element ? e.target.closest<HTMLElement>('.pane') : null
    if (!pane) return
    const r = pane.getBoundingClientRect()
    pane.style.setProperty('--mx', `${e.clientX - r.left}px`)
    pane.style.setProperty('--my', `${e.clientY - r.top}px`)
  })

  if (reduced()) {
    settle()
    return
  }
  gsap.fromTo(box, { y: 90, opacity: 0, rotateX: 10 }, { y: 0, opacity: 1, rotateX: 0, duration: 1.3, ease: 'expo.out', scrollTrigger: { trigger: box, start: 'top 92%', toggleActions: 'play none none none' } })
  ScrollTrigger.create({ trigger: box, start: 'top 70%', onEnter: play })
}
