/* Wavi website: live replicas of the app and the page's motion. Plain browser JS, GSAP from the CDN. */
;(() => {
  'use strict'

  const G = window.gsap
  const ST = window.ScrollTrigger
  const FLIP = window.Flip
  const root = document.documentElement
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  const narrow = window.matchMedia('(max-width: 900px)')

  if (!G) root.classList.remove('js')
  if (G && ST) G.registerPlugin(ST)
  if (G && FLIP) G.registerPlugin(FLIP)

  const $ = (sel, el = document) => el.querySelector(sel)
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel))
  const h = (tag, cls, html) => {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    if (html != null) el.innerHTML = html
    return el
  }
  const glyph = (status) => `<svg viewBox="0 0 14 14"><use href="#g-${status}"/></svg>`
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  /* ───────── Nav ───────── */
  const nav = $('[data-nav]')
  const onScroll = () => nav.classList.toggle('is-stuck', window.scrollY > 8)
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  /* ───────── Hero: live window ───────── */
  const SESSIONS = [
    { project: 'acme-web', count: 4 },
    { id: 'cookie', title: 'Cookie 会话迁移', status: 'running', sub: '读取 src/auth/session.ts', time: '4m', diff: '+42 −18', selected: true },
    { id: 'checkout', title: '结算页性能优化', status: 'running', sub: '运行 pnpm test checkout', time: '12m', diff: '+128 −35' },
    { id: 'mobile', title: '修复移动端导航抖动', status: 'done_unread', sub: '滚动时导航不再抖动', time: '2m 前', diff: '+23 −9' },
    { id: 'main', title: 'main', status: 'idle', sub: '~/code/acme-web', time: '', diff: '' },
    { project: 'wavi', count: 2 },
    { id: 'agg', title: '侧边栏状态聚合', status: 'running', sub: '读取 src/state/agents.ts', time: '6m', diff: '+61 −4' },
    { id: 'lanes', title: 'Git 图谱布局算法', status: 'error', sub: 'pnpm build 失败 · 2 个错误', time: '18m', diff: '+210 −12' }
  ]

  const tree = $('[data-tree]')
  const rows = {}
  for (const s of SESSIONS) {
    if (s.project) {
      tree.append(h('div', 'w-project', `<span>${s.project}</span><small>${s.count}</small>`))
      continue
    }
    const row = h('div', 'w-row' + (s.selected ? ' is-selected' : ''))
    row.innerHTML = `${glyph(s.status)}<span class="t">${s.title}</span><span class="m"><span data-time>${s.time}</span><span>${s.diff}</span></span><span class="s" data-sub>${s.sub}</span>`
    row.dataset.status = s.status
    tree.append(row)
    rows[s.id] = row
  }

  function setRow(id, status, sub, time) {
    const row = rows[id]
    if (!row) return
    if (status && row.dataset.status !== status) {
      row.dataset.status = status
      $('use', row).setAttribute('href', `#g-${status}`)
      if (status === 'needs_you') ping($('svg', row))
    }
    if (sub != null) $('[data-sub]', row).textContent = sub
    if (time != null) $('[data-time]', row).textContent = time
  }

  function ping(el) {
    if (!el || reduce.matches) return
    el.classList.remove('is-ping')
    void el.getBoundingClientRect()
    el.classList.add('is-ping')
  }

  const term = $('[data-term]')
  const agent = $('[data-agent]')
  const count = $('[data-count]')

  function setAgent(status, label) {
    agent.classList.toggle('is-attn', status === 'needs_you')
    $('use', agent).setAttribute('href', `#g-${status}`)
    $('span', agent).textContent = label
  }

  // One Claude Code turn, as the TUI draws it.
  const SCRIPT = [
    { l: '<span class="t-dim">&gt;</span> 把登录态从 localStorage 挪到 httpOnly cookie，顺便加上刷新' },
    { l: '' },
    { l: '<span class="t-ok">●</span> <b>Read</b>(src/auth/session.ts)', act: '读取 src/auth/session.ts' },
    { l: '  <span class="t-dim">└ 读取 88 行</span>' },
    { l: '' },
    { l: '<span class="t-ok">●</span> <b>Update</b>(src/middleware.ts)', act: '编辑 src/middleware.ts' },
    { l: '  <span class="t-dim">└ 已更新 src/middleware.ts，新增 18 行</span>' },
    { l: '' },
    { l: '<span class="t-ok">●</span> <b>Write</b>(prisma/schema.prisma)', act: '编辑 prisma/schema.prisma' },
    { l: '  <span class="t-dim">└ 新增 model</span> Session <span class="t-dim">{ id, userId, expiresAt, refreshedAt }</span>' },
    { l: '' },
    { l: '<span class="t-ok">●</span> 表结构改了，需要生成一次迁移。' },
    { box: true }
  ]
  const BOX = [
    '<b>Bash command</b>',
    '',
    '  pnpm prisma migrate dev --name session_cookie',
    '  <span class="t-dim">为新的 Session 表创建并应用迁移</span>',
    '',
    'Do you want to proceed?',
    '<span class="t-sel">❯ 1. Yes</span>',
    '  2. Yes, and don’t ask again for <b>pnpm prisma</b> commands',
    '  3. No, and tell Claude what to do differently <span class="t-dim">(esc)</span>'
  ]

  const line = (html) => h('div', 'l', html || ' ')
  const boxEl = () => {
    const b = h('div', 'box')
    for (const l of BOX) b.append(line(l))
    return b
  }

  function renderStatic() {
    term.textContent = ''
    for (const s of SCRIPT) term.append(s.box ? boxEl() : line(s.l))
    setRow('cookie', 'needs_you', '等你确认：pnpm prisma migrate dev', '已等 1m')
    setAgent('needs_you', 'Claude Code · 等你确认')
    count.hidden = false
  }

  // A small scheduler that only runs while the hero is on screen.
  let timers = []
  let heroVisible = true
  let simRunning = false
  const later = (ms, fn) => timers.push(setTimeout(fn, ms))
  const clearTimers = () => { timers.forEach(clearTimeout); timers = [] }

  let waitTick = null
  function startWait() {
    let s = 0
    clearInterval(waitTick)
    waitTick = setInterval(() => {
      s += 1
      setRow('cookie', null, null, s < 60 ? `已等 ${s}s` : `已等 ${Math.floor(s / 60)}m`)
    }, 1000)
  }

  function runSim() {
    simRunning = true
    clearTimers()
    clearInterval(waitTick)
    term.textContent = ''
    count.hidden = true
    setAgent('running', 'Claude Code · 运行中')
    setRow('cookie', 'running', '读取 src/auth/session.ts', '4m')
    setRow('checkout', 'running', '运行 pnpm test checkout', '12m')
    setRow('agg', 'running', '读取 src/state/agents.ts', '6m')

    let t = 500
    for (const s of SCRIPT) {
      if (s.box) {
        t += 700
        later(t, () => {
          const b = boxEl()
          term.append(b)
          if (G && !reduce.matches) G.from(b, { opacity: 0, y: 8, duration: 0.5, ease: 'expo.out' })
          setRow('cookie', 'needs_you', '等你确认：pnpm prisma migrate dev', '已等 0s')
          setAgent('needs_you', 'Claude Code · 等你确认')
          count.hidden = false
          ping($('svg', count))
          startWait()
        })
        break
      }
      t += s.l ? 300 + Math.random() * 260 : 120
      later(t, () => {
        term.append(line(s.l))
        if (s.act) setRow('cookie', null, s.act)
      })
    }

    // The rest of the fleet keeps moving meanwhile.
    later(2200, () => setRow('checkout', null, '编辑 lib/price.ts'))
    later(4600, () => setRow('agg', 'done_unread', '聚合逻辑已提交，等你审阅', '刚刚'))
    later(5200, () => setRow('checkout', null, '读取 cart/useCart.ts'))
    later(8600, () => setRow('checkout', null, '运行 pnpm test checkout'))

    // You answer: "1", the agent carries on, and the loop starts over.
    const answered = t + 6400
    later(answered, () => {
      clearInterval(waitTick)
      const b = $('.box', term)
      if (b) b.remove()
      term.append(line('<span class="t-ok">●</span> <b>Bash</b>(pnpm prisma migrate dev --name session_cookie)'))
      setRow('cookie', 'running', '运行 pnpm prisma migrate dev', '4m')
      setAgent('running', 'Claude Code · 运行中')
      count.hidden = true
    })
    later(answered + 900, () => term.append(line('  <span class="t-dim">└</span> <span class="t-ok">✓</span> <span class="t-dim">迁移已应用</span>')))
    later(answered + 1500, () => { term.append(line('')); term.append(line('<span class="t-accent">✻</span> 正在写刷新逻辑… <span class="t-dim">(esc 中断)</span>')) })
    later(answered + 6500, () => { if (heroVisible) runSim(); else simRunning = false })
  }

  const heroWindow = $('[data-window]')
  if (reduce.matches) {
    renderStatic()
  } else {
    renderStatic() // visible from the first paint; the sim takes over after the intro
    term.textContent = ''
    count.hidden = true
    setRow('cookie', 'running', '读取 src/auth/session.ts', '4m')
    setAgent('running', 'Claude Code · 运行中')
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => {
        heroVisible = e.isIntersecting
        if (heroVisible && !simRunning) runSim()
      }, { threshold: 0.05 }).observe(heroWindow)
    }
    later(G ? 1300 : 0, () => { if (!simRunning) runSim() })
  }

  /* ───────── Hero intro ───────── */
  if (G) {
    const mm = G.matchMedia()
    mm.add({ motion: '(prefers-reduced-motion: no-preference)', still: '(prefers-reduced-motion: reduce)' }, (ctx) => {
      const { motion } = ctx.conditions
      if (!motion) {
        G.set('[data-rise]', { y: 0 })
        G.set('[data-fade], [data-window]', { opacity: 1 })
        return
      }
      const tl = G.timeline({ defaults: { ease: 'expo.out' } })
      tl.from('.nav', { opacity: 0, y: -12, duration: 0.8 }, 0)
        .to('[data-rise]', { y: 0, duration: 1.2, stagger: 0.12 }, 0.1)
        .to('[data-fade]', { opacity: 1, duration: 1 }, 0.55)
        .from('[data-fade]', { y: 16, duration: 1.2 }, 0.55)
        .fromTo('[data-window]', { opacity: 0, y: 80 }, { opacity: 1, y: 0, duration: 1.6 }, 0.7)
        .fromTo('.window', { rotateX: 16, scale: 0.94 }, { rotateX: 7, scale: 0.97, duration: 1.8 }, 0.7)
        .from('.w-row, .w-project', { opacity: 0, x: -10, duration: 0.8, stagger: 0.05 }, 1.1)

      if (ST) {
        G.fromTo('.window', { rotateX: 7, scale: 0.97 }, {
          rotateX: 0,
          scale: 1,
          ease: 'none',
          immediateRender: false,
          scrollTrigger: { trigger: '.window-wrap', start: 'top 85%', end: 'top 25%', scrub: 0.6 }
        })
      }
    })
  }

  /* ───────── Status: overview that regroups as you scroll ───────── */
  const GROUPS = [
    ['needs_you', '等你处理'],
    ['error', '出错'],
    ['done_unread', '待审阅'],
    ['running', '运行中'],
    ['idle', '空闲']
  ]
  const STATUS_TEXT = { needs_you: '等你处理', error: '出错', done_unread: '已完成', running: '运行中', idle: '空闲' }
  const OV = [
    { id: 'cookie', t: 'Cookie 会话迁移', d: '+42 −18' },
    { id: 'checkout', t: '结算页性能优化', d: '+128 −35' },
    { id: 'mobile', t: '修复移动端导航抖动', d: '+23 −9' },
    { id: 'agg', t: '侧边栏状态聚合', d: '+61 −4' },
    { id: 'lanes', t: 'Git 图谱布局算法', d: '+210 −12' },
    { id: 'webhook', t: '支付回调重试', d: '+19 −2' },
    { id: 'vite', t: '迁移到 Vite 7', d: '+40 −31' },
    { id: 'search', t: '文档站搜索', d: '+88 −14' }
  ]
  const R = (status, su, tm) => ({ status, su, tm })
  const STEPS = [
    {
      sub: '8 个会话 · 全部在运行',
      rows: {
        cookie: R('running', '编辑 src/middleware.ts', '4m'),
        checkout: R('running', '运行 pnpm test checkout', '12m'),
        mobile: R('running', '读取 components/Nav.tsx', '2m'),
        agg: R('running', '搜索 “needsAttention”', '6m'),
        lanes: R('running', '编辑 src/shared/git-graph/lanes.ts', '18m'),
        webhook: R('running', '运行 pnpm vitest webhook', '9m'),
        vite: R('running', '编辑 vite.config.ts', '3m'),
        search: R('running', '读取 docs/search/index.ts', '7m')
      }
    },
    {
      sub: '8 个会话 · 2 个待审阅 · 1 个出错',
      rows: {
        cookie: R('running', '编辑 prisma/schema.prisma', '5m'),
        checkout: R('running', '编辑 lib/price.ts', '13m'),
        mobile: R('done_unread', '滚动时导航不再抖动', '刚刚'),
        agg: R('running', '编辑 src/state/agents.ts', '7m'),
        lanes: R('error', 'pnpm build 失败 · 2 个类型错误', '1m 前'),
        webhook: R('running', '运行 pnpm vitest webhook', '10m'),
        vite: R('idle', '升级完成，测试全部通过', '20m 前'),
        search: R('done_unread', '搜索索引改为增量构建', '5m 前')
      }
    }
  ]
  STEPS[2] = {
    sub: '8 个会话 · 1 个等你处理',
    rows: { ...STEPS[1].rows, cookie: R('needs_you', '等你确认：pnpm prisma migrate dev', '已等 1m') }
  }

  const statusSec = $('[data-status-sec]')
  const ovList = $('[data-ov]')
  const ovSub = $('[data-ov-sub]')
  const stepEls = $$('[data-step]', statusSec)
  const dots = $$('.status-progress i', statusSec)
  const groupEls = {}
  const ovRows = {}

  for (const [key, label] of GROUPS) {
    const g = h('div', 'ov-group')
    g.innerHTML = `<div class="ov-gh">${label}<b data-n></b></div>`
    g.dataset.group = key
    groupEls[key] = g
    ovList.append(g)
  }
  for (const r of OV) {
    const row = h('div', 'ov-row')
    row.innerHTML = `<span class="g">${glyph('running')}<span data-st></span></span><span class="ti">${r.t}</span><span class="su" data-su></span><span class="sa">${r.d}</span><span class="tm" data-tm></span>`
    ovRows[r.id] = row
  }

  let currentStep = -1
  function applyStep(i, animate) {
    if (i === currentStep) return
    const prev = currentStep
    currentStep = i
    const step = STEPS[i]
    const canFlip = animate && FLIP && !reduce.matches
    const state = canFlip ? FLIP.getState($$('.ov-row, .ov-group', ovList)) : null

    for (const r of OV) {
      const d = step.rows[r.id]
      const row = ovRows[r.id]
      const was = row.dataset.status
      row.dataset.status = d.status
      $('use', row).setAttribute('href', `#g-${d.status}`)
      $('[data-st]', row).textContent = STATUS_TEXT[d.status]
      $('[data-su]', row).textContent = d.su
      $('[data-tm]', row).textContent = d.tm
      groupEls[d.status].append(row)
      if (d.status === 'needs_you' && was !== 'needs_you' && prev !== -1) ping($('.g svg', row))
    }
    for (const [key] of GROUPS) {
      const n = groupEls[key].querySelectorAll('.ov-row').length
      groupEls[key].hidden = n === 0
      $('[data-n]', groupEls[key]).textContent = n
    }
    ovSub.textContent = step.sub
    statusSec.dataset.step = String(i)
    stepEls.forEach((el) => el.classList.toggle('is-active', Number(el.dataset.step) === i))
    dots.forEach((d, k) => d.classList.toggle('on', k <= i))

    if (state) {
      FLIP.from(state, {
        duration: 0.8,
        ease: 'expo.out',
        stagger: 0.015,
        nested: true,
        onEnter: (els) => G.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.5 }),
        onLeave: (els) => G.to(els, { opacity: 0, duration: 0.3 })
      })
    }
  }

  // Desktop: the sticky section scrubs through the three steps. Narrow screens: it plays on its own while visible.
  let autoTimer = null
  function setupStatus() {
    clearInterval(autoTimer)
    if (ST) ST.getById('status')?.kill()
    if (!narrow.matches && ST) {
      applyStep(0, false)
      ST.create({
        id: 'status',
        trigger: statusSec,
        start: 'top top',
        end: 'bottom bottom',
        onUpdate: (self) => applyStep(self.progress < 0.3 ? 0 : self.progress < 0.62 ? 1 : 2, true)
      })
      return
    }
    if (reduce.matches || !('IntersectionObserver' in window)) {
      applyStep(2, false)
      return
    }
    applyStep(0, false)
    let visible = false
    new IntersectionObserver(([e]) => { visible = e.isIntersecting }, { threshold: 0.35 }).observe(statusSec)
    autoTimer = setInterval(() => { if (visible) applyStep((currentStep + 1) % 3, true) }, 3400)
  }
  setupStatus()
  narrow.addEventListener('change', () => { setupStatus(); ST?.refresh() })

  /* ───────── Terminal: two cells per CJK character ───────── */
  const tty = $('[data-tty]')
  const pre = $('[data-cjkify]', tty)
  const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦]/

  ;(function cjkify(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const text = child.textContent
        if (!WIDE.test(text)) continue
        const frag = document.createDocumentFragment()
        let buf = ''
        for (const ch of text) {
          if (WIDE.test(ch)) {
            if (buf) { frag.append(buf); buf = '' }
            frag.append(h('span', 'w', esc(ch)))
          } else buf += ch
        }
        if (buf) frag.append(buf)
        child.replaceWith(frag)
      } else if (child.nodeType === 1) cjkify(child)
    }
  })(pre)

  function measureCell() {
    const probe = h('span', null, '0000000000')
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
    pre.append(probe)
    const w = probe.getBoundingClientRect().width / 10
    probe.remove()
    if (w > 0) tty.style.setProperty('--cell-w', `${w}px`)
  }
  measureCell()
  if (document.fonts) document.fonts.ready.then(measureCell)
  window.addEventListener('resize', measureCell)

  const note = $('[data-tty-note]')
  const NOTES = {
    wavi: '两格对齐：每个汉字占两个单元格，三列对得齐。',
    plain: '不强制两格时，汉字按字体自己的宽度画，后面的列就错开了。'
  }

  function flashWide() {
    if (reduce.matches || !G) return
    const ws = $$('.w', pre)
    G.fromTo(ws, { backgroundColor: 'rgba(255,95,176,0.22)' }, { backgroundColor: 'rgba(255,95,176,0)', duration: 1.2, ease: 'expo.out', stagger: 0.004, clearProps: 'backgroundColor' })
  }

  // Segmented controls with the app's sliding thumb.
  for (const seg of $$('[data-seg]')) {
    const thumb = h('span', 'thumb')
    seg.prepend(thumb)
    seg.classList.add('has-thumb')
    const buttons = $$('button', seg)
    const place = () => {
      const on = buttons.find((b) => b.getAttribute('aria-checked') === 'true')
      thumb.style.width = `${on.offsetWidth}px`
      thumb.style.transform = `translateX(${on.offsetLeft}px)`
    }
    const select = (b) => {
      buttons.forEach((x) => {
        x.setAttribute('aria-checked', String(x === b))
        x.tabIndex = x === b ? 0 : -1
      })
      place()
      const v = b.dataset.v
      if (seg.dataset.seg === 'mode') {
        tty.dataset.mode = v
        note.textContent = NOTES[v]
      } else {
        tty.dataset.cjk = v
      }
      flashWide()
    }
    buttons.forEach((b, i) => {
      b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1
      b.addEventListener('click', () => select(b))
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
        if (!d) return
        e.preventDefault()
        const next = buttons[(i + d + buttons.length) % buttons.length]
        next.focus()
        select(next)
      })
    })
    place()
    if (document.fonts) document.fonts.ready.then(place)
    window.addEventListener('resize', place)
  }
  note.textContent = NOTES.wavi

  $('[data-grid-toggle]').addEventListener('change', (e) => tty.classList.toggle('show-grid', e.target.checked))

  /* ───────── Scroll choreography ───────── */
  if (G && ST) {
    const mm = G.matchMedia()

    mm.add({ motion: '(prefers-reduced-motion: no-preference)', wide: '(min-width: 901px)' }, (ctx) => {
      const { motion, wide } = ctx.conditions

      // Headlines settle in character by character, out of a blur.
      if (motion) {
        for (const el of $$('[data-reveal-words]')) {
          if (!el.dataset.split) {
            el.dataset.split = '1'
            el.setAttribute('aria-label', el.textContent)
            el.innerHTML = Array.from(el.textContent).map((c) => `<span class="ch" aria-hidden="true" style="display:inline-block">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('')
          }
          G.from($$('.ch', el), {
            opacity: 0,
            yPercent: 40,
            filter: 'blur(10px)',
            duration: 1.1,
            ease: 'expo.out',
            stagger: 0.035,
            scrollTrigger: { trigger: el, start: 'top 82%', once: true }
          })
        }

        // Principles: hairlines draw across before each rule speaks.
        for (const rule of $$('[data-rule]')) {
          const tl = G.timeline({ scrollTrigger: { trigger: rule, start: 'top 88%', once: true } })
          tl.fromTo(rule, { '--rule-s': 0 }, { '--rule-s': 1, duration: 1.1, ease: 'expo.inOut' }, 0)
            .from($$('dt, dd', rule), { opacity: 0, y: 14, duration: 0.9, stagger: 0.08, ease: 'expo.out' }, 0.3)
        }

        // Keyboard: the shortcuts rise in a wave, then each cap gets pressed once.
        G.timeline({ scrollTrigger: { trigger: '.key-grid', start: 'top 80%', once: true } })
          .from('.key-grid li', { opacity: 0, y: 24, duration: 0.9, ease: 'expo.out', stagger: { each: 0.06, grid: 'auto', from: 'start' } })
          .to('.key-grid kbd', { y: 3, boxShadow: 'inset 0 0 0 rgba(0,0,0,0)', duration: 0.09, ease: 'power2.out', yoyo: true, repeat: 1, stagger: 0.035 }, 0.35)

        // Download: the orbit mark turns with the page.
        G.fromTo('[data-orbit]', { rotate: -16, scale: 0.86, opacity: 0.4 }, {
          rotate: 12,
          scale: 1,
          opacity: 1,
          ease: 'none',
          scrollTrigger: { trigger: '[data-download]', start: 'top bottom', end: 'bottom bottom', scrub: 0.8 }
        })
      }

      // Worktree: the graph draws itself as you scroll; the six steps light up in order.
      const lanes = { main: $('.lane-main'), l1: $('.lane-1'), l2: $('.lane-2'), l3: $('.lane-3') }
      const stepsLi = $$('[data-wt-steps] li')
      if (!motion) {
        stepsLi.forEach((li) => li.classList.add('is-on'))
        return
      }
      const tl = G.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: wide
          ? { trigger: '[data-wt]', start: 'top top', end: 'bottom bottom', scrub: 0.5, onUpdate: (s) => markSteps(s.progress) }
          : { trigger: '.graph', start: 'top 85%', end: 'bottom 35%', scrub: 0.5 }
      })
      G.set([lanes.l1, lanes.l2, lanes.l3, lanes.main], { strokeDashoffset: 1 })
      G.set('.commits .c, .chips .chip', { opacity: 0 })
      tl.to(lanes.main, { strokeDashoffset: 0, duration: 1.2 }, 0)
        .to('.c-main', { opacity: 1, duration: 0.1, stagger: 0.25 }, 0.1)
        .to(lanes.l1, { strokeDashoffset: 0.2, duration: 2.6 }, 1)
        .to(lanes.l2, { strokeDashoffset: 0.2, duration: 2.6 }, 1.3)
        .to(lanes.l3, { strokeDashoffset: 0.2, duration: 2.2 }, 1.6)
        .to('.chips .chip-main', { opacity: 1, duration: 0.3 }, 0.4)
        .to('.chips .chip-1, .chips .chip-2, .chips .chip-3', { opacity: 1, duration: 0.4, stagger: 0.2 }, 1.9)
        .to('.c-1, .c-2, .c-3', { opacity: 1, duration: 0.1, stagger: 0.12 }, 2.2)
        .to(lanes.l3, { strokeDashoffset: 0, duration: 0.6 }, 4.4)
        .to('.c-m3', { opacity: 1, duration: 0.1 }, 5)
        .to(lanes.l1, { strokeDashoffset: 0, duration: 0.6 }, 5.1)
        .to('.c-m1', { opacity: 1, duration: 0.1 }, 5.7)
        .to(lanes.l2, { strokeDashoffset: 0, duration: 0.6 }, 5.6)
        .to('.c-m2', { opacity: 1, duration: 0.1 }, 6.2)
        .to([lanes.l1, lanes.l2, lanes.l3, '.c-1, .c-2, .c-3', '.chip-1, .chip-2, .chip-3'], { opacity: 0.22, duration: 0.8 }, 6.6)
        .to({}, { duration: 0.6 })

      if (!wide) stepsLi.forEach((li) => li.classList.add('is-on'))
      function markSteps(p) {
        const bounds = [0, 0.14, 0.3, 0.52, 0.66, 0.86]
        let on = 0
        bounds.forEach((b, i) => { if (p >= b) on = i })
        stepsLi.forEach((li, i) => {
          li.classList.toggle('is-on', i === on)
          li.classList.toggle('is-done', i < on)
        })
      }
      if (wide) markSteps(0)
      return () => stepsLi.forEach((li) => li.classList.remove('is-on', 'is-done'))
    })
  } else {
    $$('[data-wt-steps] li').forEach((li) => li.classList.add('is-on'))
  }

  /* ───────── Copy the install command ───────── */
  const copyBtn = $('[data-copy]')
  copyBtn.addEventListener('click', async () => {
    const text = $('[data-cmd]').textContent
    try {
      await navigator.clipboard.writeText(text)
      copyBtn.textContent = '已复制'
    } catch {
      const r = document.createRange()
      r.selectNodeContents($('[data-cmd]'))
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
      copyBtn.textContent = '已选中'
    }
    setTimeout(() => { copyBtn.textContent = '复制' }, 1600)
  })
})()
