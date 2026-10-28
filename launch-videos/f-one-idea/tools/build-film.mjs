// Builds film F's scenes (compositions/*.html) and the root (index.html) from one source of truth.
// Run from the project root: node tools/build-film.mjs
// Times are film seconds inside each scene; the grid is 120 BPM, a beat every 0.5 s.
//
// The app is rebuilt from the glass shell (PRD §5 玻璃外壳, Figma 28E split / 28H split + right panel, 21D drag,
// 13B Git graph) with the numbers of the app's own CSS (styles/tokens.css, SplitArea, SessionRow, graph-model).
// World coordinates are the 1440 x 900 window at 2x (2880 x 1800); a camera scales the world into the frame.
import fs from 'node:fs'
import path from 'node:path'

const W = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s) }
const r2 = (n) => +n.toFixed(2)
const K = 2 // world px per real px
const k = (n) => r2(n * K)

/* ───────── shared bits ───────── */
const FONTS = `
    @font-face { font-family: 'Wavi Archivo'; src: url('assets/fonts/archivo-wdth-wght-subset.woff2') format('woff2'); font-weight: 100 900; font-stretch: 62% 125%; }
    @font-face { font-family: 'Wavi Sans SC'; src: url('assets/fonts/noto-sans-sc-film-subset.woff') format('woff'); font-weight: 100 900; }
    @font-face { font-family: 'Wavi Mono'; src: url('assets/fonts/jetbrains-mono-latin-wght-normal.woff2') format('woff2'); font-weight: 100 800; }`
const SANS = `Inter, 'Wavi Sans SC', sans-serif`
const MONO = `'Wavi Mono', 'JetBrains Mono', 'Wavi Sans SC', monospace`
const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>")`

// Tokens (styles/tokens.css, dark).
const T = {
  glass: 'rgba(30, 30, 32, 0.62)', card: '#0a0a0a', float: '#121212', raised: '#161616',
  selected: 'rgba(255, 255, 255, 0.07)', borderDefault: 'rgba(255, 255, 255, 0.11)',
  t1: '#ededed', t2: '#a1a1a1', t3: '#6b6b6b', focus: '#5ea1ff',
  run: '#5ea1ff', done: '#3dd68c', error: '#ff5c5c',
  lanes: ['#a1a1a1', '#5ea1ff', '#c79bff', '#3dd68c', '#ffb224', '#6ccfd6']
}

// lucide icons, stroke 1.75.
const ICON = {
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  fork: '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clip: '<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  list: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7"/><path d="M14 9h7"/><path d="M14 15h7"/><path d="M14 20h7"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  term: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'
}
const icon = (name, s, extra = '') => `<svg class="ic"${extra} width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`
/** StatusGlyph at s px. */
const glyph = (status, s) => {
  const v = 'viewBox="0 0 14 14"'
  if (status === 'running') return `<svg class="glyph" width="${s}" height="${s}" ${v}><g class="spin"><circle cx="7" cy="7" r="5.1" fill="none" stroke="#ffffff2e" stroke-width="1.8"/><path d="M7 1.9 A5.1 5.1 0 0 1 9.32 11.54" fill="none" stroke="${T.run}" stroke-width="1.8"/></g></svg>`
  if (status === 'done') return `<svg class="glyph" width="${s}" height="${s}" ${v}><circle cx="7" cy="7" r="4" fill="${T.done}"/></svg>`
  if (status === 'error') return `<svg class="glyph" width="${s}" height="${s}" ${v}><circle cx="7" cy="7" r="4" fill="${T.error}"/></svg>`
  return `<svg class="glyph" width="${s}" height="${s}" ${v}><circle cx="7" cy="7" r="3.25" fill="none" stroke="${T.t3}" stroke-width="1.5"/></svg>`
}
const agentMark = (ag, s) => (ag === 'shell' ? `<span class="term-mark">${icon('term', s)}</span>` : `<img src="assets/brand/${ag}.svg" alt="" />`)

/** The sessions of Figma 28E. `a2` is what the row says once shot 2 has run a while. */
const S = {
  cookie: { t: 'Cookie 会话迁移', a: '编辑 src/auth/session.ts', a2: '运行 pnpm test src/auth', ag: 'claude', br: 'session-cookie', tm: '4m', d: '+42 −18', st: 'running' },
  checkout: { t: '结算页性能优化', a: '运行 pnpm test checkout', a2: '编辑 src/checkout/PriceList.tsx', ag: 'claude', br: 'perf-checkout', tm: '12m', d: '+128 −35', st: 'running' },
  mobile: { t: '修复移动端导航抖动', a: '已完成 · 等你审阅', ag: 'codex', br: 'fix-nav-jitter', tm: '2m', d: '+23 −9', st: 'done' },
  main: { t: '终端', a: '~/code/acme-web', ag: 'shell', br: 'main', tm: '', d: '', st: 'idle' },
  agg: { t: '侧栏状态聚合', a: '读取 src/state/agents.ts', a2: '编辑 src/state/agents.ts', ag: 'claude', br: 'sidebar-agg', tm: '6m', d: '+61 −4', st: 'running' },
  lanes: { t: 'Git 图谱布局算法', a: 'pnpm build 失败 · 2 个类型错误', ag: 'codex', br: 'graph-layout', tm: '18m', d: '+210 −12', st: 'error' },
  webhook: { t: '支付回调重试', a: '运行 pnpm vitest webhook', ag: 'codex', br: 'webhook-retry', tm: '9m', d: '+19 −2', st: 'running' },
  search: { t: '文档站搜索', a: '读取 docs/search/index.ts', ag: 'claude', br: 'docs-search', tm: '7m', d: '+88 −14', st: 'running' },
  i18n: { t: '文案国际化', a: '编辑 locales/zh.json', ag: 'codex', br: 'i18n-copy', tm: '5m', d: '+73 −20', st: 'running' },
  roadmap: { t: '更新路线图', a: '已完成 · 等你审阅', ag: 'claude', br: 'docs-roadmap', tm: '1m', d: '+12 −3', st: 'done' }
}
const PROJECTS = [['acme-web', ['cookie', 'checkout', 'mobile', 'main']], ['terminal-reborn', ['agg', 'lanes']]]

/* ───────── the window, in real px (Sidebar 14:3, ProjectHeader 50:1473, SessionRow 11:51, Figma 28) ───────── */
const WIN = { w: 1440, h: 900, r: 12 }
const SB = { w: 264, rowX: 8, rowW: 248, row: 70, head: 28 }
const NAV = [['folder', '打开项目…', '⌘O', 48], ['search', '跳转到…', '⌘K', 80], ['list', '总览', '⇧⌘A', 112]]
const SLOT = {}
const HEAD_Y = []
{
  let y = 158
  PROJECTS.forEach(([, ids], i) => {
    if (i) y += 16
    HEAD_Y.push(y)
    y += SB.head + 2
    ids.forEach((id) => { SLOT[id] = y; y += SB.row + 2 })
  })
}
// Panes: header strip on the glass (44), card below; cards 6 from the window's right and bottom and from each other.
const H44 = 44, GAP = 6
const COLW = (WIN.w - SB.w - GAP - GAP) / 2
const ROWH = (WIN.h - GAP - GAP) / 2
const RECT = {
  full: { x: SB.w, y: 0, w: WIN.w - SB.w - GAP, h: WIN.h - GAP },
  left: { x: SB.w, y: 0, w: COLW, h: WIN.h - GAP },
  right: { x: SB.w + COLW + GAP, y: 0, w: COLW, h: WIN.h - GAP },
  tl: { x: SB.w, y: 0, w: COLW, h: ROWH },
  tr: { x: SB.w + COLW + GAP, y: 0, w: COLW, h: ROWH },
  bl: { x: SB.w, y: ROWH + GAP, w: COLW, h: ROWH },
  br: { x: SB.w + COLW + GAP, y: ROWH + GAP, w: COLW, h: ROWH }
}
const card = (r) => ({ x: r.x, y: r.y + H44, w: r.w, h: r.h - H44 })
// With the right panel open (Figma 28H): a 480 card at the right, the panes share what is left.
const PANEL = { w: 480 }
PANEL.x = WIN.w - GAP - PANEL.w
const COLW2 = (PANEL.x - GAP - SB.w - GAP) / 2
const RECT2 = {
  tl: { x: SB.w, y: 0, w: COLW2, h: ROWH }, bl: { x: SB.w, y: ROWH + GAP, w: COLW2, h: ROWH },
  tr: { x: SB.w + COLW2 + GAP, y: 0, w: COLW2, h: ROWH }, br: { x: SB.w + COLW2 + GAP, y: ROWH + GAP, w: COLW2, h: ROWH }
}
const wr = (r) => ({ x: k(r.x), y: k(r.y), w: k(r.w), h: k(r.h) })
// The git-branch icon in a focused pane's header: … and × at the right end, the five tools before them.
const gitIconX = (r) => k(r.x + r.w - 8 - 28 - 2 - 28 - 8 - 2 * 30 - 14)

/* ───────── window CSS (world px) ───────── */
const winCss = `
    .win { position: absolute; left: 0; top: 0; width: ${k(WIN.w)}px; height: ${k(WIN.h)}px; border-radius: ${k(WIN.r)}px; background: ${T.glass}; box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.1), inset 0 2px 0 rgba(255, 255, 255, 0.06); }
    .lights { position: absolute; left: ${k(16)}px; top: ${k(16)}px; display: flex; gap: ${k(8)}px; }
    .lights i { width: ${k(12)}px; height: ${k(12)}px; border-radius: 50%; }
    .sbtoggle { position: absolute; left: ${k(230)}px; top: ${k(8)}px; width: ${k(28)}px; height: ${k(28)}px; display: flex; align-items: center; justify-content: center; color: ${T.t2}; }
    .nav { position: absolute; left: ${k(8)}px; width: ${k(248)}px; height: ${k(30)}px; display: flex; align-items: center; gap: ${k(8)}px; padding: 0 ${k(8)}px; border-radius: ${k(5)}px; color: ${T.t1}; }
    .nav .ic { flex: none; color: ${T.t2}; }
    .nav b { flex: 1; font: 400 ${k(13)}px/${k(18)}px ${SANS}; }
    .nav span { font: 400 ${k(12)}px/${k(16)}px ${MONO}; color: ${T.t3}; }
    .sb-head { position: absolute; left: ${k(8)}px; width: ${k(248)}px; height: ${k(28)}px; display: flex; align-items: center; gap: ${k(4)}px; padding: 0 ${k(12)}px 0 ${k(8)}px; color: ${T.t1}; }
    .sb-head .ic { color: ${T.t3}; }
    .sb-head b { font: 600 ${k(13)}px/${k(18)}px ${SANS}; }
    .row { position: absolute; display: flex; align-items: flex-start; gap: ${k(8)}px; padding: ${k(8)}px ${k(12)}px ${k(8)}px ${k(28)}px; border-radius: ${k(5)}px; }
    .row .glyph { flex: none; margin-top: ${k(2)}px; }
    .row .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${k(2)}px; }
    .row .t { font: 400 ${k(13)}px/${k(18)}px ${SANS}; color: ${T.t1}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row .a { position: relative; height: ${k(16)}px; font: 400 ${k(12)}px/${k(16)}px ${SANS}; color: ${T.t2}; white-space: nowrap; }
    .row .a span { position: absolute; left: 0; top: 0; right: 0; overflow: hidden; text-overflow: ellipsis; }
    .row .a .a2 { opacity: 0; }
    .row .w { display: flex; align-items: center; gap: ${k(4)}px; height: ${k(16)}px; font: 400 ${k(12)}px/${k(16)}px ${SANS}; color: ${T.t3}; white-space: nowrap; overflow: hidden; }
    .row .w img, .row .w .term-mark { width: ${k(12)}px; height: ${k(12)}px; flex: none; display: flex; }
    .row .w .ic { flex: none; }
    .row .meta { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: ${k(2)}px; font: 400 ${k(12)}px/${k(16)}px ${MONO}; color: ${T.t3}; white-space: nowrap; }
    .row .meta span:first-child { line-height: ${k(18)}px; }
    .row.sel { background: ${T.selected}; }
    .row.shown { box-shadow: inset 0 0 0 ${k(1)}px ${T.borderDefault}; }
    .ph { position: absolute; height: ${k(H44)}px; display: flex; align-items: center; gap: ${k(12)}px; padding: 0 ${k(8)}px 0 ${k(16)}px; }
    .ph b { flex: 1; min-width: 0; font: 600 ${k(15)}px/${k(20)}px ${SANS}; letter-spacing: -0.2px; color: ${T.t2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ph b.f { position: absolute; left: ${k(16)}px; color: ${T.t1}; opacity: 0; }
    .ph.focus b.f { opacity: 1; }
    .tools { position: relative; flex: none; display: flex; align-items: center; gap: ${k(8)}px; color: ${T.t2}; }
    .tools .grp { display: flex; gap: ${k(2)}px; }
    .ib { width: ${k(28)}px; height: ${k(28)}px; display: flex; align-items: center; justify-content: center; border-radius: ${k(5)}px; }
    .cardbox { position: absolute; border-radius: ${k(10)}px; background: ${T.card}; box-shadow: 0 ${k(1)}px ${k(3)}px #00000059; overflow: hidden; }
    .cardbox::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 ${k(1)}px #ffffff14, inset 0 ${k(1)}px 0 #ffffff0f; pointer-events: none; }
    .term { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: ${k(20)}px ${k(24)}px ${k(16)}px; font: 400 ${k(13)}px/${k(20)}px ${MONO}; color: #e5e5e5; white-space: pre-wrap; overflow-wrap: anywhere; }
    .term > * { flex: none; }
    .term .ln { min-height: ${k(20)}px; }
    .term .rule { flex: none; height: ${k(1)}px; margin: ${k(9.5)}px 0; background: #5c5c5c; }
    .term .g { color: ${T.done}; } .term .bl { color: ${T.run}; } .term .o { color: #e08a5e; } .term .d { color: #808080; } .term .r { color: ${T.error}; } .term .w { color: #f2f2f2; } .term .bd { font-weight: 700; color: #f2f2f2; }
    .grip { position: absolute; border-radius: ${k(3)}px; background: ${T.borderDefault}; }
    .drop { position: absolute; display: grid; place-items: center; border: ${k(2)}px solid ${T.focus}; border-radius: ${k(10)}px; background: ${T.selected}; }
    .hint { padding: ${k(6)}px ${k(12)}px; border: ${k(1)}px solid ${T.borderDefault}; border-radius: ${k(5)}px; background: ${T.float}; box-shadow: 0 ${k(4)}px ${k(16)}px #00000029, 0 ${k(1)}px ${k(3)}px #0000001a; font: 500 ${k(12)}px/${k(16)}px ${SANS}; color: ${T.t1}; white-space: nowrap; }
    .ghost { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: ${k(8)}px; padding: ${k(6)}px ${k(12)}px ${k(6)}px ${k(8)}px; border: ${k(1)}px solid ${T.borderDefault}; border-radius: ${k(5)}px; background: ${T.raised}; box-shadow: 0 ${k(4)}px ${k(16)}px #00000029, 0 ${k(1)}px ${k(3)}px #0000001a; font: 500 ${k(13)}px/${k(18)}px ${SANS}; color: ${T.t1}; white-space: nowrap; opacity: 0; z-index: 30; }
    .cursor { position: absolute; left: 0; top: 0; z-index: 40; }`

const row = (pre, id, { cls = '', later = false, top = SLOT[id], left = SB.rowX } = {}) => {
  const s = S[id]
  const a = later && s.a2 ? `<span>${s.a2}</span>` : `<span class="a1">${s.a}</span>${s.a2 ? `<span class="a2">${s.a2}</span>` : ''}`
  const meta = s.tm || s.d ? `<div class="meta"><span>${s.tm}</span><span>${s.d}</span></div>` : ''
  return `<div class="row ${cls}" id="${pre}row-${id}" style="left:${k(left)}px;top:${k(top)}px;width:${k(SB.rowW)}px">${glyph(s.st, k(14))}<div class="main"><div class="t">${s.t}</div><div class="a">${a}</div><div class="w">${agentMark(s.ag, k(12))}${icon('branch', k(12))}<span>${s.br}</span></div></div>${meta}</div>`
}
const heads = (pre) => PROJECTS.map(([name], i) => `<div class="sb-head" id="${pre}head-${i}" style="top:${k(HEAD_Y[i])}px">${icon('chev', k(16))}<b>${name}</b></div>`).join('\n')
const sessionRows = (pre, opts = {}) => PROJECTS.flatMap(([, ids]) => ids).map((id) => row(pre, id, { cls: (opts.cls ?? {})[id] ?? '', later: opts.later })).join('\n')
/** The sidebar chrome that is not the session list: lights, the toggle, the nav, 设置. */
const chrome = (pre) => `<div class="lights" id="${pre}lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
<div class="sbtoggle" id="${pre}sbtoggle">${icon('panel', k(16))}</div>
${NAV.map(([ic, label, kbd, y], i) => `<div class="nav" id="${pre}nav${i}" style="top:${k(y)}px">${icon(ic, k(16))}<b>${label}</b><span>${kbd}</span></div>`).join('\n')}
<div class="nav" id="${pre}nav3" style="top:${k(WIN.h - 12 - 30)}px">${icon('sliders', k(16))}<b>设置</b><span>⌘,</span></div>`

/* ───────── terminal content (Figma 28E / 28H; mobile is Codex) ───────── */
const L = (...segs) => segs
const CLAUDE_FOOT = [null, 'RULE', [['d', '> ']], 'RULE', [['o', '  ▸▸ auto mode on'], ['d', ' (shift+tab to cycle)']]]
const TERM = {
  cookie: [
    L(['d', '> 把登录态从 localStorage 迁移到 httpOnly cookie，过期后自动刷新']), null,
    L(['g', '● '], ['bd', 'Read'], ['', '(src/auth/session.ts)']), L(['d', '  ⎿  Read 84 lines']), null,
    L(['w', '● 现在 token 存在 localStorage，每次请求由客户端手动附带。我会改成由 /api/session 写入 httpOnly cookie，并在 middleware 里统一处理过期刷新。']), null,
    L(['g', '● '], ['bd', 'Update'], ['', '(src/auth/session.ts)']), L(['d', '  ⎿  Updated '], ['bd', 'src/auth/session.ts'], ['d', ' with 12 additions and 9 removals']),
    L(['r', '       19 -   const token = await issueToken(user)']), L(['r', '       20 -   localStorage.setItem(KEY, token)']), L(['g', "       19 +   await fetch('/api/session', { method: 'POST' })"]), null,
    L(['bl', '● '], ['bd', 'Bash'], ['', '(pnpm test src/auth)']), L(['d', '  ⎿  Running…']), null,
    L(['o', '✻ Simmering… '], ['d', '(42s · ↓ 2.1k tokens · esc to interrupt)']), ...CLAUDE_FOOT
  ],
  checkout: [
    L(['d', '> 结算页首屏太慢，先找出瓶颈再改']), null,
    L(['w', '● 我先跑一遍性能测试，拿到现在的基线。']), null,
    L(['g', '● '], ['bd', 'Bash'], ['', '(pnpm test:perf checkout)']), L(['d', '  ⎿  checkout › first paint    1840 ms']), L(['d', '     checkout › price render    620 ms']), null,
    L(['w', '● 首屏主要卡在价格计算：每个商品都同步调用了一次 formatPrice。改成批量计算，并缓存汇率。']), null,
    L(['g', '● '], ['bd', 'Update'], ['', '(src/checkout/PriceList.tsx)']), L(['d', '  ⎿  Updated with 6 additions and 11 removals']), null,
    L(['bl', '● '], ['bd', 'Bash'], ['', '(pnpm test checkout)']), L(['d', '  ⎿  Running…']), null,
    L(['o', '✻ Pondering… '], ['d', '(1m 12s · ↓ 3.4k tokens · esc to interrupt)']), ...CLAUDE_FOOT
  ],
  mobile: [
    L(['d', '› 修复 iOS Safari 下滚动时顶部导航抖动']), null,
    L(['w', '• 问题出在 MobileNav 直接用 scrollY 驱动 transform，iOS 回弹时 scrollY 会变成负值。']), null,
    L(['o', '• '], ['bd', 'Edited'], ['', ' src/components/MobileNav.tsx (+14 -6)']),
    L(['o', '• '], ['bd', 'Edited'], ['', ' src/styles/nav.css (+6 -2)']),
    L(['o', '• '], ['bd', 'Ran'], ['', ' pnpm test MobileNav']), L(['d', '  └ '], ['g', 'PASS'], ['d', ' src/components/MobileNav.test.tsx (6 tests)']), null,
    L(['w', '• 已修复：scrollY 限制在 [0, maxScroll]，导航改为 sticky。等你审阅。']), null, 'RULE', [['d', '› ']], 'RULE', [['d', '  100% context left']]
  ],
  agg: [
    L(['d', '> 侧栏按状态把会话聚合起来']), null,
    L(['g', '● '], ['bd', 'Read'], ['', '(src/state/agents.ts)']), L(['d', '  ⎿  Read 92 lines']), null,
    L(['g', '● '], ['bd', 'Search'], ['', '(pattern: "needsAttention")']), L(['d', '  ⎿  Found 7 files']), null,
    L(['bl', '● '], ['bd', 'Update'], ['', '(src/state/agents.ts)']), L(['d', '  ⎿  Group rows by status']), null,
    L(['o', '✻ Thinking… '], ['d', '(18s · ↓ 640 tokens · esc to interrupt)']), ...CLAUDE_FOOT
  ]
}
/** The CLI's lines; the ones before the prompt box print one by one (class .out). */
const term = (pre, id) => {
  const lines = TERM[id]
  const foot = lines.indexOf('RULE') - 1
  return `<div class="term" id="${pre}term-${id}">${lines.map((l, i) => {
    const out = i < foot ? ' out' : ''
    if (l === 'RULE') return '<div class="rule"></div>'
    if (l === null) return `<div class="ln${out}">&nbsp;</div>`
    return `<div class="ln${out}">${l.map(([c, t]) => (c ? `<span class="${c}">${t}</span>` : t)).join('')}</div>`
  }).join('')}</div>`
}
/** A pane: its header on the glass, its card below. `tools` puts the session tools in this header. The title is drawn
 *  twice (secondary and primary) so focus can cross-fade without animating colour. */
const paneHtml = (pre, id, r, { focus = false, tools = false, close = true } = {}) => {
  const c = card(r)
  const t = `<span class="grp" id="${pre}pt-${id}" style="opacity:${tools ? 1 : 0}">${['clip', 'globe', 'branch', 'fork', 'folder'].map((n) => `<span class="ib" id="${pre}ib-${id}-${n}">${icon(n, k(16))}</span>`).join('')}</span>`
  return `<div class="ph${focus ? ' focus' : ''}" id="${pre}ph-${id}" style="left:${k(r.x)}px;top:${k(r.y)}px;width:${k(r.w)}px"><b>${S[id].t}</b><b class="f" id="${pre}pf-${id}">${S[id].t}</b><span class="tools">${t}<span class="grp"><span class="ib">${icon('dots', k(16))}</span><span class="ib" id="${pre}x-${id}" style="opacity:${close ? 1 : 0}">${icon('x', k(16))}</span></span></span></div>
<div class="cardbox" id="${pre}card-${id}" style="left:${k(c.x)}px;top:${k(c.y)}px;width:${k(c.w)}px;height:${k(c.h)}px">${term(pre, id)}</div>`
}

/** The macOS arrow, tip at the element's (2, 2). */
const cursor = (id, h) => `<svg id="${id}" class="cursor" width="${Math.round(h * 0.68)}" height="${h}" viewBox="-1 -1 19 27"><path d="M0 0 L0 22.5 L5.4 17.4 L8.9 25.6 L12.6 24 L9.2 16 L16.4 16 Z" fill="#ffffff" stroke="#000000" stroke-width="1.4" stroke-linejoin="round"/></svg>`
const CUR_H = 96

/* The site's chrome-and-fringe treatment for big glyphs (WAVI, "?"), as SVG text. */
const chromeDefs = (p) => `<defs><linearGradient id="${p}-chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfd8ff"/><stop offset="0.5" stop-color="#ffffff"/><stop offset="0.72" stop-color="#ffd3e8"/><stop offset="0.92" stop-color="#fff6cd"/></linearGradient><pattern id="${p}-lines" width="8" height="14" patternUnits="userSpaceOnUse"><rect y="11" width="8" height="2" fill="#000" opacity="0.45"/></pattern></defs>`
const chromeText = (p, x, y, text, f, gid = '') => `<g data-layout-ignore${gid ? ` id="${gid}"` : ''}><text x="${x - f}" y="${y - f * 0.5}" text-anchor="middle" fill="#2141ff">${text}</text><text x="${x + f * 0.8}" y="${y + f * 0.6}" text-anchor="middle" fill="#ff2a12">${text}</text><text x="${x + f * 0.2}" y="${y + f}" text-anchor="middle" fill="#ffd000">${text}</text><text x="${x}" y="${y}" text-anchor="middle" fill="#000">${text}</text></g><text x="${x}" y="${y}" text-anchor="middle" fill="url(#${p}-chrome)">${text}</text><text x="${x}" y="${y}" text-anchor="middle" fill="url(#${p}-lines)">${text}</text>`

const scene = (id, dur, css, body, script, vars = '') => `<template>
  <style>${FONTS}
    #root { position: absolute; inset: 0; overflow: hidden; background: #050505; }
    .stage { position: absolute; inset: 0; }
    .grain { position: absolute; inset: -40px; opacity: 0.04; background-image: ${GRAIN}; }
${css}
  </style>
  <div id="root" data-composition-id="${id}" data-width="1920" data-height="1080"${vars}>
    <div id="${id}-stage" class="clip stage" data-start="0" data-duration="${dur}" data-layout-allow-overflow data-layout-allow-overlap data-layout-allow-occlusion>
${body}
    </div>
  </div>
  <script>
    (() => {
      const tl = gsap.timeline({ paused: true });
${script}
      window.__timelines = window.__timelines || {};
      window.__timelines['${id}'] = tl;
    })();
  </script>
</template>
`

/** Camera that puts world point (px, py) at the frame's centre at scale s, keeping the window filling the frame where
 *  it is larger than the frame and centred where it is smaller. */
const camOn = (px, py, s) => {
  const fit = (c, size, frame) => {
    const span = size * s
    if (span <= frame) return r2((frame - span) / 2)
    return r2(Math.min(0, Math.max(frame - span, frame / 2 - c * s)))
  }
  return { x: fit(px, k(WIN.w), 1920), y: fit(py, k(WIN.h), 1080), scale: s }
}
const FULL = camOn(0, 0, 0.6)
// Shot 2's frame: the session list centred at scale 0.9 (shot 3 opens on exactly this).
const LIST = { s: 0.9 }
{
  const top = k(HEAD_Y[0]), bottom = k(SLOT.lanes + SB.row)
  LIST.x = r2(960 - k(SB.w / 2) * LIST.s)
  LIST.y = r2(540 - ((top + bottom) / 2) * LIST.s)
}

/* ═════════ Shots 1-2 · idea (0-10 s): the "?" bursts into sessions, which then line up as the sidebar ═════════ */
{
  // Where each row flies to: screen offset of its centre from the frame's centre, depth, tilt, rest blur.
  const BURST = {
    cookie: [-560, -330, 260, -12, 26, -7, 10], checkout: [560, -310, -160, 10, -22, 6, 0], mobile: [-600, 300, -60, 14, 30, 5, 2],
    agg: [620, 330, 300, -16, -30, -9, 12], lanes: [40, -470, -520, 38, 0, 3, 0], main: [-980, -20, -380, 0, 52, 0, 3],
    webhook: [990, 20, -460, 0, -50, 0, 3], search: [80, 480, -400, -34, 4, -2, 1], i18n: [-470, -250, -1000, 4, 18, -4, 0], roadmap: [520, 220, -900, -6, -14, 5, 0]
  }
  const AWAY = ['webhook', 'search', 'i18n', 'roadmap']
  AWAY.forEach((id, i) => { SLOT[id] = r2((1080 - LIST.y) / LIST.s / K + 40 + i * 80) })
  // Per row, in world units: [dx, dy, z, rx, ry, rz, blur, cx, cy] where (cx, cy) moves the row's centre to the frame's centre.
  const B = {}
  for (const [id, [bx, by, z, rx, ry, rz, blur]] of Object.entries(BURST)) {
    const cx = k(SB.rowX + SB.rowW / 2), cy = k(SLOT[id] + SB.row / 2)
    const ox = (960 - LIST.x) / LIST.s - cx, oy = (540 - LIST.y) / LIST.s - cy
    B[id] = [r2(ox + bx / LIST.s), r2(oy + by / LIST.s), r2(z / LIST.s), rx, ry, rz, blur, r2(ox), r2(oy)]
  }
  const css = `${winCss}
    #i-q { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }
    #i-q text { font-family: 'Wavi Archivo', sans-serif; font-weight: 900; font-stretch: 112%; font-size: 360px; }
    #i-band { position: absolute; left: 0; right: 0; top: 0; height: 120px; background: linear-gradient(to bottom, transparent, rgba(255, 255, 255, 0.05), transparent); }
    #i-cam { position: absolute; left: 0; top: 0; width: ${k(WIN.w)}px; height: ${k(WIN.h)}px; transform-origin: 0 0; perspective: ${r2(1400 / LIST.s)}px; perspective-origin: ${r2((960 - LIST.x) / LIST.s)}px ${r2((540 - LIST.y) / LIST.s)}px; }
    .row.slab { background: rgb(17, 17, 17); box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.08); border-radius: 20px; outline: 1px solid transparent; }`
  const extras = AWAY.map((id) => row('i-', id, { cls: 'slab' })).join('\n')
  const body = `      <div class="grain" id="i-grain"></div>
      <svg id="i-q" viewBox="0 0 1920 1080" aria-label="?">${chromeDefs('iq')}${chromeText('iq', 960, 680, '?', 6, 'i-fringe')}</svg>
      <div id="i-band"></div>
      <div id="i-cam">
${heads('i-')}
${sessionRows('i-', { cls: Object.fromEntries(Object.keys(BURST).map((id) => [id, 'slab'])) })}
${extras}
      </div>`
  const script = `
      const B = ${JSON.stringify(B)};
      const LAND = ${JSON.stringify(PROJECTS.flatMap(([, ids]) => ids))};
      const AWAY = ${JSON.stringify(AWAY)};
      tl.set('#i-cam', { x: ${LIST.x}, y: ${LIST.y}, scale: ${LIST.s} }, 0);
      tl.fromTo('#i-grain', { x: 0, y: 0 }, { x: 53, y: -31, duration: 10, ease: 'steps(120)' }, 0);
      tl.fromTo('#i-cam .spin', { rotation: 0 }, { rotation: 360 * 12, duration: 10, ease: 'none', svgOrigin: '7 7' }, 0);

      // 0-1.5 · the "?" alone on the tube, two pulses on the beat.
      tl.fromTo('#i-band', { y: -140 }, { y: 1100, duration: 1.5, ease: 'none' }, 0);
      tl.fromTo('#i-q', { scale: 1.1, opacity: 1, filter: 'blur(0px)' }, { scale: 1.1, duration: 0.01 }, 0);
      [0.5, 1.0].forEach((t, i) => {
        tl.fromTo('#i-q', { scale: 1.1 }, { scale: 1.1 + 0.08 * (i + 1), duration: 0.07, ease: 'power2.out', immediateRender: false }, t);
        tl.to('#i-q', { scale: 1.1, duration: 0.3, ease: 'power2.out' }, t + 0.07);
        tl.fromTo('#i-fringe', { x: -10 * (i + 1) }, { x: 0, duration: 0.35, ease: 'power3.out', immediateRender: false }, t);
      });
      // 1.5 · it bursts.
      tl.to('#i-q', { scale: 2.3, opacity: 0, filter: 'blur(22px)', duration: 0.28, ease: 'power3.in' }, 1.36);
      Object.keys(B).forEach((id) => {
        const [dx, dy, z, rx, ry, rz, blur, cx, cy] = B[id];
        const el = '#i-row-' + id;
        const t0 = 1.5 + Math.hypot(dx - cx, dy - cy) * 0.00004;
        tl.fromTo(el, { x: cx, y: cy, z: -1000, rotationX: 0, rotationY: 0, rotationZ: 0, opacity: 0, filter: 'blur(16px)' },
          { x: dx, y: dy, z, rotationX: rx, rotationY: ry, rotationZ: rz, opacity: 1, filter: 'blur(' + blur + 'px)', duration: 0.9, ease: 'power4.out' }, t0);
        // 2.4-4.9 · they keep drifting outwards.
        tl.to(el, { x: cx + (dx - cx) * 1.12, y: cy + (dy - cy) * 1.12, z: z + 150, rotationZ: rz * 1.4, rotationY: ry * 1.15, duration: 2.5, ease: 'sine.inOut' }, t0 + 0.9);
      });
      // 4.9-6.5 · they brake, turn flat and drop into their slots, one after another.
      LAND.forEach((id, i) => {
        const el = '#i-row-' + id, t = 4.9 + i * 0.1;
        tl.to(el, { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, filter: 'blur(0px)', duration: 1.0, ease: 'expo.inOut' }, t);
        tl.to(el, { backgroundColor: 'rgba(17, 17, 17, 0)', boxShadow: 'inset 0 0 0 2px rgba(255, 255, 255, 0)', borderRadius: '10px', duration: 0.35, ease: 'power2.out' }, t + 0.7);
      });
      AWAY.forEach((id, i) => {
        tl.to('#i-row-' + id, { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, filter: 'blur(10px)', duration: 0.9, ease: 'power3.in' }, 4.9 + i * 0.06);
      });
      tl.fromTo('#i-head-0', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.3, ease: 'expo.out' }, 5.6);
      tl.fromTo('#i-head-1', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.3, ease: 'expo.out' }, 6.0);
      // 6.5-10 · the list is live: activities change as the agents work.
      [['cookie', 7.5], ['agg', 8.5], ['checkout', 9.5]].forEach(([id, t]) => {
        tl.to('#i-row-' + id + ' .a1', { opacity: 0, filter: 'blur(4px)', duration: 0.12, ease: 'power2.in' }, t);
        tl.fromTo('#i-row-' + id + ' .a2', { opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.15, ease: 'power2.out' }, t + 0.1);
      });`
  W('compositions/idea.html', scene('idea', 10, css, body, script))
}

/* ═════════ Shot 3 · app (10-20 s): the glass window builds round the list; click one, drag three more in ═════════ */
{
  const C = Object.fromEntries(Object.entries(RECT).map(([n, r]) => [n, wr(card(r))]))
  const css = `${winCss}
    #a-cam { position: absolute; left: 0; top: 0; width: ${k(WIN.w)}px; height: ${k(WIN.h)}px; transform-origin: 0 0; }`
  const ghosts = ['checkout', 'mobile', 'agg'].map((id) => `<div class="ghost" id="a-ghost-${id}">${glyph(S[id].st, k(14))}<span>${S[id].t}</span></div>`).join('\n')
  const drops = [['b', 'right'], ['c', 'br'], ['d', 'bl']].map(([n, r]) => `<div class="drop" id="a-drop-${n}" style="left:${C[r].x}px;top:${C[r].y}px;width:${C[r].w}px;height:${C[r].h}px;opacity:0"><span class="hint">松开在这里显示这个会话</span></div>`).join('\n')
  const grip = (id, x, y, w, h) => `<div class="grip" id="${id}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;opacity:0"></div>`
  const gx = k(SB.w + COLW + GAP / 2)
  const body = `      <div id="a-cam">
        <div class="win" id="a-win"></div>
        <div id="a-chrome">
${chrome('a-')}
        </div>
${heads('a-')}
${sessionRows('a-', { later: true })}
${paneHtml('a-', 'cookie', RECT.full, { focus: true, tools: true, close: false })}
${paneHtml('a-', 'checkout', RECT.right)}
${paneHtml('a-', 'mobile', RECT.br)}
${paneHtml('a-', 'agg', RECT.bl)}
        ${grip('a-gv', gx - k(1), k(H44 + (WIN.h - GAP - H44) / 2 - 16), k(2), k(32))}
        ${grip('a-gr', k(RECT.br.x + COLW / 2 - 16), k(ROWH + GAP / 2) - k(1), k(32), k(2))}
        ${grip('a-gl', k(RECT.bl.x + COLW / 2 - 16), k(ROWH + GAP / 2) - k(1), k(32), k(2))}
${drops}
${ghosts}
        ${cursor('a-cursor', CUR_H)}
      </div>`
  // World points the cursor visits (its tip).
  const rowPt = (id) => [k(SB.rowX + 70), k(SLOT[id] + 18)]
  const mid = (r) => [k(r.x + r.w / 2), k(r.y + H44 + (r.h - H44) / 2)]
  const low = (r) => [k(r.x + r.w * 0.42), k(r.y + H44 + (r.h - H44) * 0.8)]
  const P = {
    enter: [k(WIN.w) + 200, k(WIN.h) + 160], cookie: rowPt('cookie'), checkout: rowPt('checkout'), mobile: rowPt('mobile'), agg: rowPt('agg'),
    right: low(RECT.right), br: low(RECT.br), bl: low(RECT.bl), focusB: mid(RECT.tr), git: [gitIconX(RECT.tr), k(H44 / 2)]
  }
  const CAM = {
    list: { x: LIST.x, y: LIST.y, scale: LIST.s }, full: FULL, rows: { x: 0, y: 0, scale: 1.0 }, one: FULL,
    b: { ...camOn((P.checkout[0] + P.right[0]) / 2, 0, 0.66), y: 0 },
    c: { ...camOn((P.mobile[0] + P.br[0]) / 2, 0, 0.66), y: r2(1080 - k(WIN.h) * 0.66) },
    d: { ...camOn((P.agg[0] + P.bl[0]) / 2, 0, 0.66), y: r2(1080 - k(WIN.h) * 0.66) }
  }
  const R = Object.fromEntries(Object.entries(RECT).map(([n, r]) => [n, wr(r)]))
  const script = `
      const P = ${JSON.stringify(P)};
      const CAM = ${JSON.stringify(CAM)};
      const R = ${JSON.stringify(R)};
      const C = ${JSON.stringify(C)};
      const H44 = ${k(H44)};
      tl.fromTo('#a-cam .spin', { rotation: 0 }, { rotation: 360 * 12, duration: 10, ease: 'none', svgOrigin: '7 7' }, 0);
      const cam = (t, d, c, ease) => tl.to('#a-cam', { x: c.x, y: c.y, scale: c.scale, duration: d, ease: ease || 'power2.inOut' }, t);
      const move = (t, d, p, ease) => tl.to('#a-cursor', { x: p[0] - 2, y: p[1] - 2, duration: d, ease: ease || 'power2.inOut' }, t);
      const press = (t) => tl.fromTo('#a-cursor', { scale: 1 }, { keyframes: [{ scale: 0.86, duration: 0.07 }, { scale: 1, duration: 0.14 }], transformOrigin: '2px 2px', immediateRender: false }, t);
      const lines = (id, t0, gap) => gsap.utils.toArray('#a-term-' + id + ' .out').forEach((el, i) => tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.01 }, t0 + i * gap));
      // A pane's header and card move together from rect o (where CSS puts them) to rect r.
      const place = (id, o, r, t, d) => {
        tl.to('#a-ph-' + id, { x: r.x - o.x, y: r.y - o.y, width: r.w, duration: d, ease: 'power3.out' }, t);
        tl.to('#a-card-' + id, { x: r.x - o.x, y: r.y - o.y, width: r.w, height: r.h - H44, duration: d, ease: 'power3.out' }, t);
      };
      // The keyboard moves: the tools go with it and its title steps forward.
      const focus = (on, off, t) => {
        tl.to(['#a-pt-' + on, '#a-pf-' + on], { opacity: 1, duration: 0.15 }, t);
        if (off) tl.to(['#a-pt-' + off, '#a-pf-' + off], { opacity: 0, duration: 0.15 }, t);
      };
      const select = (id, prev, t) => {
        tl.to('#a-row-' + id, { backgroundColor: 'rgba(255, 255, 255, 0.07)', boxShadow: 'inset 0 0 0 2px rgba(255, 255, 255, 0)', opacity: 1, duration: 0.1 }, t);
        if (prev) tl.to('#a-row-' + prev, { backgroundColor: 'rgba(255, 255, 255, 0)', boxShadow: 'inset 0 0 0 2px rgba(255, 255, 255, 0.11)', duration: 0.1 }, t);
      };
      // DragGhost 21D: the row steps back, a small pill follows the pointer (14 right, 16 below its tip); the DropTarget rings where it lands.
      const drag = (id, to, drop, t, d) => {
        tl.to('#a-row-' + id, { opacity: 0.4, duration: 0.1 }, t);
        tl.fromTo('#a-ghost-' + id, { x: P[id][0] + 28, y: P[id][1] + 32, opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'power2.out' }, t);
        tl.to('#a-ghost-' + id, { x: to[0] + 28, y: to[1] + 32, duration: d, ease: 'power2.inOut' }, t + 0.05);
        move(t + 0.05, d, to);
        tl.fromTo('#a-drop-' + drop, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: 'power2.out' }, t + 0.05 + d * 0.6);
      };
      const release = (id, drop, t) => {
        tl.to('#a-ghost-' + id, { opacity: 0, duration: 0.12, ease: 'power3.in' }, t);
        tl.to('#a-drop-' + drop, { opacity: 0, duration: 0.2, ease: 'power2.out' }, t + 0.05);
        tl.fromTo(['#a-ph-' + id, '#a-card-' + id], { opacity: 0, scale: 0.97, filter: 'blur(8px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.4, ease: 'expo.out' }, t + 0.05);
        lines(id, t + 0.3, 0.07);
      };

      // Initial: exactly the frame shot 2 ended on (the list, nothing else).
      tl.set('#a-cam', { x: CAM.list.x, y: CAM.list.y, scale: CAM.list.scale }, 0);
      tl.set('#a-cursor', { x: P.enter[0], y: P.enter[1] }, 0);
      tl.set(['#a-ph-checkout', '#a-card-checkout', '#a-ph-mobile', '#a-card-mobile', '#a-ph-agg', '#a-card-agg', '#a-ph-cookie', '#a-card-cookie'], { opacity: 0 }, 0);
      // 0-0.8 · the glass window builds round the list as the camera pulls back to the whole window on black.
      cam(0, 0.8, CAM.full);
      tl.fromTo('#a-win', { opacity: 0, scale: 0.985, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out' }, 0.15);
      tl.fromTo('#a-chrome > *', { opacity: 0, x: -24, filter: 'blur(8px)' }, { opacity: 1, x: 0, filter: 'blur(0px)', duration: 0.45, ease: 'expo.out', stagger: 0.04 }, 0.3);
      // 0.7-1.5 · the cursor comes in; the camera leans in on it.
      move(0.7, 0.8, P.cookie);
      cam(0.9, 0.7, CAM.rows);
      // 1.6 · click: the row widens into the terminal card; its name lands on the glass above it.
      press(1.6);
      select('cookie', null, 1.6);
      tl.fromTo('#a-card-cookie', { opacity: 1, x: ${k(SB.rowX)} - C.full.x, y: ${k(SLOT.cookie)} - C.full.y, width: ${k(SB.rowW)}, height: ${k(SB.row)}, filter: 'blur(0px)' },
        { x: 0, y: 0, width: C.full.w, height: C.full.h, duration: 0.5, ease: 'power3.out', immediateRender: false }, 1.62);
      tl.to('#a-card-cookie', { keyframes: [{ filter: 'blur(8px)', duration: 0.18 }, { filter: 'blur(0px)', duration: 0.3 }] }, 1.62);
      tl.fromTo('#a-ph-cookie', { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.35, ease: 'expo.out', immediateRender: false }, 1.85);
      lines('cookie', 2.0, 0.08);
      cam(1.9, 0.8, CAM.one);

      // 3.0-4.4 · drag the checkout session to the right half.
      move(3.0, 0.45, P.checkout);
      cam(3.2, 1.0, CAM.b);
      press(3.5);
      drag('checkout', P.right, 'b', 3.5, 0.6);
      tl.set('#a-x-cookie', { opacity: 1 }, 4.2);
      place('cookie', R.full, R.left, 4.2, 0.4);
      tl.to('#a-gv', { opacity: 1, duration: 0.2 }, 4.3);
      release('checkout', 'b', 4.2);
      select('checkout', 'cookie', 4.2);
      focus('checkout', 'cookie', 4.25);

      // 5.0-6.3 · the mobile session to the bottom right.
      move(5.0, 0.4, P.mobile);
      cam(5.1, 1.0, CAM.c);
      press(5.45);
      drag('mobile', P.br, 'c', 5.45, 0.6);
      place('checkout', R.right, R.tr, 6.1, 0.4);
      tl.to('#a-gr', { opacity: 1, duration: 0.2 }, 6.2);
      release('mobile', 'c', 6.1);
      select('mobile', 'checkout', 6.1);
      focus('mobile', 'checkout', 6.15);

      // 6.9-8.2 · the sidebar rollup session to the bottom left.
      move(6.9, 0.4, P.agg);
      cam(7.0, 1.0, CAM.d);
      press(7.35);
      drag('agg', P.bl, 'd', 7.35, 0.6);
      place('cookie', R.full, R.tl, 8.1, 0.4);
      tl.to('#a-gl', { opacity: 1, duration: 0.2 }, 8.2);
      release('agg', 'd', 8.1);
      select('agg', 'mobile', 8.1);
      focus('agg', 'mobile', 8.15);
      cam(8.25, 0.7, CAM.full);

      // 8.6-10 · click into the top-right pane, then head for its git-branch icon.
      move(8.6, 0.45, P.focusB);
      press(9.08);
      select('checkout', 'agg', 9.08);
      focus('checkout', 'agg', 9.1);
      move(9.3, 0.6, P.git);`
  W('compositions/app.html', scene('app', 10, css, body, script))
}

/* ═════════ Shots 4-5 · git (20-33 s): the Git panel opens, the window lies down, the graph becomes a runway ═════════ */
{
  // Git graph (graph-model.ts): rows 28, lanes from 18 every 17, lines 2, turns of radius 8, nodes 4 (HEAD 5) with a 2 px gap.
  const G = { row: k(28), x0: k(18), gap: k(17), line: k(2), turn: k(8), node: k(4), head: k(5), cut: k(2) }
  const LX = (c) => G.x0 + c * G.gap
  const PW = k(PANEL.w), PX = k(PANEL.x)
  const CARD_TOP = k(H44), CARD_BOT = k(WIN.h - GAP)
  const GRAPH_TOP = CARD_TOP + k(40) + k(30) // card header 40, view row 24 + 6
  const TEXT_X = LX(5) + k(15)
  const H = 9800 // runway height (world)
  const ROW = G.row
  const YNODE = 480 // the release node, near the runway's far end
  // Merges: lane c folds into main on its own row below the release (lane 5 first).
  const MERGE_Y = (c) => YNODE + (6 - c) * ROW
  const SUBJ = ['Refresh session before expiry', 'Batch formatPrice per render', 'Pack lanes left to right', 'Clamp scrollY during iOS bounce', 'Group rows by status', 'Cache exchange rates', 'Rotate refresh token on use', 'Snapshot nav at three breakpoints', 'Route merge edges around dots', 'Read status from hooks', 'Move session token to httpOnly cookie', 'Split checkout bundle by route', 'Virtualise long histories', 'Count sessions per project', 'Add Session model and migration', 'Add bounce scenario tests', 'Memoize cart totals per render', 'Upgrade vitest', 'Bump next to 15.3', 'Retry webhooks with backoff', 'Index docs incrementally', 'Debounce search input', 'Add search API route', 'Tidy env loading']
  const REFS = [null, ['session-cookie', 'run'], ['perf-checkout', 'run'], ['fix-nav-jitter', 'done'], ['sidebar-agg', 'run'], ['origin/graph-layout', 'remote']]
  let seed = 11
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const rows = []
  for (let y = H - ROW / 2, n = 0; y > MERGE_Y(1) + ROW * 8; y -= ROW, n++) rows.push({ y, lane: Math.floor(rnd() * 6), s: SUBJ[n % SUBJ.length], n })
  const laneTop = (c) => MERGE_Y(c) + G.turn
  const lanesSvg = T.lanes.map((col, c) => c === 0
    ? `<path d="M${LX(0)} ${YNODE} V${H}" fill="none" stroke="${col}" stroke-width="${G.line}"/><path d="M${LX(0)} 0 V${YNODE}" fill="none" stroke="${col}" stroke-width="${G.line}" opacity="0.35"/>`
    : `<path d="M${LX(0)} ${MERGE_Y(c)} H${LX(c) - G.turn} A${G.turn} ${G.turn} 0 0 1 ${LX(c)} ${laneTop(c)} V${H}" fill="none" stroke="${col}" stroke-width="${G.line}"/>`).join('')
  const node = (x, y, r, col) => `<circle cx="${x}" cy="${r2(y)}" r="${r + G.cut}" fill="${T.card}"/><circle cx="${x}" cy="${r2(y)}" r="${r}" fill="${col}"/>`
  const dots = rows.map((r) => node(LX(r.lane), r.y, G.node, T.lanes[r.lane])).join('')
  const mergeDots = [1, 2, 3, 4, 5].map((c) => `<g class="mdot" id="g-m${c}">${node(LX(0), MERGE_Y(c), G.node, T.lanes[0])}</g>`).join('')
  const pill = (name, kind, col) => `<span class="pill${kind === 'remote' ? ' remote' : ''}" style="--pill:${col}">${kind === 'remote' ? icon('globe', k(14)) : glyph(kind === 'done' ? 'done' : 'running', k(14))}<span>${name}</span></span>`
  const labels = rows.map((r) => {
    const ref = r.n % 6 === 2 && r.lane > 0 ? pill(REFS[r.lane][0], REFS[r.lane][1], T.lanes[r.lane]) : ''
    return `<div class="cm" style="top:${r.y - ROW / 2}px">${ref}<span class="s">${r.s}</span><span class="tm">${Math.max(1, Math.round((H - r.y) / ROW / 4))}h</span></div>`
  }).join('\n')

  const PANE_AT = { cookie: 'tl', checkout: 'tr', mobile: 'br', agg: 'bl' }
  const runTop = CARD_BOT - H
  const PANEL_CX = PX + PW / 2
  // The run's camera reproduces the approved key frame: the panel's bottom edge 40 px below the frame at scale 1.8,
  // a 900 px screen perspective whose origin sits 4 % above the frame; the camera centred between lanes and text.
  const RUNCAM = { cx: PX + k(150), s: 1.8 }
  RUNCAM.x = r2(960 - RUNCAM.cx * RUNCAM.s)
  RUNCAM.y = r2(1120 - CARD_BOT * RUNCAM.s)
  RUNCAM.persp = r2(900 / RUNCAM.s)
  RUNCAM.py = r2((-43 - RUNCAM.y) / RUNCAM.s)
  // The run ends with the release node 300 px ahead of the floor's hinge, so it barely moves while the floor stands up.
  // Accelerate 3 s, cruise 2 s, brake 1.8 s at one top speed v: 1.5v + 2v + 0.9v = the distance.
  const Y3 = CARD_BOT - 300 - runTop - YNODE, V = Y3 / 4.4
  const RUN = { y1: Math.round(1.5 * V), y2: Math.round(3.5 * V), y3: Math.round(Y3) }
  // The camera at the end of shot 5: the release node at (560, 330), lanes 75 px apart.
  const SHIP = { s: 75 / G.gap, nx: 560, ny: 330 }
  const nodeWX = PX + LX(0), nodeWY = runTop + YNODE + RUN.y3

  const css = `${winCss}
    #g-cam { position: absolute; left: 0; top: 0; width: ${k(WIN.w)}px; height: ${k(WIN.h)}px; transform-origin: 0 0; perspective: ${RUNCAM.persp}px; perspective-origin: ${RUNCAM.cx}px ${RUNCAM.py}px; }
    #g-tilt { position: absolute; left: 0; top: 0; width: ${k(WIN.w)}px; height: ${k(WIN.h)}px; transform-style: preserve-3d; }
    #g-win { position: absolute; left: 0; top: 0; width: ${k(WIN.w)}px; height: ${k(WIN.h)}px; }
    #g-panel { left: ${PX}px; top: ${CARD_TOP}px; width: ${PW}px; height: ${CARD_BOT - CARD_TOP}px; }
    #g-panel .gh { position: absolute; left: 0; right: 0; top: 0; height: ${k(40)}px; display: flex; align-items: center; gap: ${k(8)}px; padding: 0 ${k(6)}px 0 ${k(14)}px; }
    #g-panel .gh b { font: 500 ${k(13)}px/${k(18)}px ${SANS}; color: ${T.t1}; }
    #g-panel .gh span { flex: 1; font: 400 ${k(12)}px/${k(16)}px ${MONO}; color: ${T.t3}; }
    #g-panel .gh .ib { color: ${T.t2}; }
    #g-panel .vr { position: absolute; left: ${k(10)}px; right: ${k(14)}px; top: ${k(40)}px; height: ${k(24)}px; display: flex; align-items: center; }
    #g-panel .seg { display: flex; gap: ${k(2)}px; font: 400 ${k(12)}px/${k(16)}px ${SANS}; color: ${T.t2}; }
    #g-panel .seg span { padding: ${k(4)}px ${k(10)}px; border-radius: ${k(3)}px; }
    #g-panel .seg .on { background: ${T.selected}; color: ${T.t1}; }
    #g-panel .vr i { flex: 1; }
    #g-panel .vr em { display: flex; align-items: center; gap: ${k(2)}px; font: 400 ${k(12)}px/${k(16)}px ${SANS}; font-style: normal; color: ${T.t2}; }
    #g-wintools { position: absolute; right: ${k(GAP + 2)}px; top: 0; height: ${k(H44)}px; display: flex; align-items: center; gap: ${k(12)}px; color: ${T.t2}; opacity: 0; }
    #g-wintools .chip { display: flex; align-items: center; gap: ${k(6)}px; font: 400 ${k(12)}px/${k(16)}px ${SANS}; color: ${T.t3}; }
    #g-wintools .chip b { font: 400 ${k(12)}px/${k(16)}px ${MONO}; color: ${T.t2}; }
    #g-wintools .meter { width: ${k(24)}px; height: ${k(3)}px; border-radius: ${k(2)}px; background: #ffffff1f; overflow: hidden; }
    #g-wintools .meter i { display: block; height: 100%; background: ${T.t2}; }
    #g-wintools .ib.on { background: ${T.selected}; color: ${T.t1}; }
    #g-run { position: absolute; left: ${PX}px; top: ${runTop}px; width: ${PW}px; height: ${H}px; }
    #g-run svg { position: absolute; left: 0; top: 0; }
    #g-run .cm { position: absolute; left: ${TEXT_X}px; right: ${k(14)}px; height: ${ROW}px; display: flex; align-items: center; gap: ${k(6)}px; white-space: nowrap; }
    #g-run .cm .s { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font: 400 ${k(13)}px/${k(18)}px ${SANS}; color: ${T.t2}; }
    #g-run .cm .tm { font: 400 ${k(12)}px/${k(16)}px ${MONO}; color: ${T.t3}; }
    #g-run .pill { flex: none; display: inline-flex; align-items: center; gap: ${k(4)}px; height: ${k(20)}px; padding: 0 ${k(7)}px 0 ${k(5)}px; border: ${k(1)}px solid var(--pill); border-radius: ${k(3)}px; font: 400 ${k(12)}px/${k(16)}px ${SANS}; color: ${T.t1}; }
    #g-run .pill.remote { border-style: dashed; }
    #g-run .pill .ic { color: var(--pill); }
    #g-fog { position: absolute; inset: 0; background: linear-gradient(to bottom, #050505 0%, #050505 12%, #05050500 36%); opacity: 0; }
    #g-tag { position: absolute; padding: 0 22px; border-radius: 12px; background: #ededed; color: #0a0a0a; font: 600 40px/60px ${MONO}; opacity: 0; }
    #g-title { position: absolute; left: 1100px; top: 250px; font: 900 190px/1 'Wavi Sans SC', sans-serif; letter-spacing: -0.02em; color: #ededed; opacity: 0; }`
  const panes = Object.entries(PANE_AT).map(([id, at]) => paneHtml('g-', id, RECT[at], { focus: id === 'checkout', tools: id === 'checkout' })).join('\n')
  const gx = k(SB.w + COLW + GAP / 2)
  const body = `      <div id="g-cam">
        <div id="g-tilt">
          <div id="g-win">
            <div class="win"></div>
${chrome('g-')}
${heads('g-')}
${sessionRows('g-', { later: true, cls: { checkout: 'sel', cookie: 'shown', mobile: 'shown', agg: 'shown' } })}
${panes}
            <div class="grip" id="g-gv" style="left:${gx - k(1)}px;top:${k(H44 + (WIN.h - GAP - H44) / 2 - 16)}px;width:${k(2)}px;height:${k(32)}px"></div>
            <div id="g-wintools"><span class="chip">context <span class="meter"><i style="width:6%"></i></span><b>6%</b></span><span class="chip">Claude <span class="meter"><i style="width:65%"></i></span><b>7d 65%</b></span><span class="grp" style="display:flex;gap:${k(2)}px">${['clip', 'globe', 'branch', 'fork', 'folder'].map((n) => `<span class="ib${n === 'branch' ? ' on' : ''}">${icon(n, k(16))}</span>`).join('')}<span class="ib">${icon('dots', k(16))}</span></span></div>
          </div>
          <div class="cardbox" id="g-panel"><div class="gh"><b>Git</b><span>acme-web</span><i class="ib">${icon('rotate', k(16))}</i><i class="ib">${icon('dots', k(16))}</i><i class="ib">${icon('x', k(16))}</i></div><div class="vr"><span class="seg"><span class="on">图谱</span><span>变更 3</span></span><i></i><em>全部分支 ${icon('chev', k(14))}</em></div></div>
          <div id="g-run">
            <svg width="${PW}" height="${H}" viewBox="0 0 ${PW} ${H}">${lanesSvg}${dots}${mergeDots}
              <g id="g-node">${node(LX(0), YNODE, G.head + k(2), T.done)}</g>
            </svg>
${labels}
          </div>
          ${cursor('g-cursor', CUR_H)}
        </div>
      </div>
      <div id="g-fog"></div>
      <div id="g-tag" style="left:${SHIP.nx + 46}px;top:${SHIP.ny - 30}px" data-var-text="tag">v1.0.0</div>
      <div id="g-title" data-var-text="ship">上线。</div>`
  const script = `
      const H = ${H}, CLIP0 = ${H - (CARD_BOT - GRAPH_TOP)}, H44 = ${k(H44)};
      const R = ${JSON.stringify(Object.fromEntries(Object.entries(PANE_AT).map(([id, at]) => [id, wr(RECT[at])])))};
      const R2 = ${JSON.stringify(Object.fromEntries(Object.entries(PANE_AT).map(([id, at]) => [id, wr(RECT2[at])])))};
      tl.fromTo('#g-win .spin', { rotation: 0 }, { rotation: 360 * 15, duration: 13, ease: 'none', svgOrigin: '7 7' }, 0);
      tl.set('#g-cam', { x: ${FULL.x}, y: ${FULL.y}, scale: ${FULL.scale} }, 0);
      tl.set('#g-tilt', { rotationX: 0, transformOrigin: '${PANEL_CX}px ${CARD_BOT}px' }, 0);
      tl.set('#g-cursor', { x: ${gitIconX(RECT.tr) - 2}, y: ${k(H44 / 2) - 2} }, 0);
      tl.fromTo('#g-panel', { x: 80, scale: 0.97, opacity: 0, filter: 'blur(8px)', transformOrigin: '100% 50%' }, { x: 80, opacity: 0, duration: 0.01 }, 0);
      tl.fromTo('#g-run', { clipPath: 'inset(' + H + 'px 0px 0px 0px)', y: 0, x: 80, opacity: 0 }, { clipPath: 'inset(' + H + 'px 0px 0px 0px)', duration: 0.01 }, 0);
      tl.set('#g-node', { scale: 0, transformOrigin: '50% 50%' }, 0);

      // 0.2 · click git-branch: the panel springs in from the right (drawer: 40 px, 0.97, blur 8), the panes make room,
      // and the session tools move to the window's top right above it (Figma 28H).
      tl.fromTo('#g-cursor', { scale: 1 }, { keyframes: [{ scale: 0.86, duration: 0.07 }, { scale: 1, duration: 0.14 }], transformOrigin: '2px 2px', immediateRender: false }, 0.2);
      tl.to('#g-ib-checkout-branch', { backgroundColor: 'rgba(255, 255, 255, 0.07)', color: '#ededed', duration: 0.08 }, 0.22);
      tl.to(['#g-panel', '#g-run'], { x: 0, scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.46, ease: 'back.out(1.1)' }, 0.25);
      tl.set('#g-run', { clipPath: 'inset(' + CLIP0 + 'px 0px 0px 0px)' }, 0.25);
      Object.keys(R).forEach((id) => {
        const o = R[id], r = R2[id];
        tl.to('#g-ph-' + id, { x: r.x - o.x, y: r.y - o.y, width: r.w, duration: 0.46, ease: 'back.out(1.1)' }, 0.25);
        tl.to('#g-card-' + id, { x: r.x - o.x, y: r.y - o.y, width: r.w, duration: 0.46, ease: 'back.out(1.1)' }, 0.25);
      });
      tl.to('#g-gv', { x: ${k(SB.w + COLW2 + GAP / 2) - gx}, duration: 0.46, ease: 'back.out(1.1)' }, 0.25);
      tl.to('#g-pt-checkout', { opacity: 0, duration: 0.15 }, 0.25);
      tl.to('#g-wintools', { opacity: 1, duration: 0.25 }, 0.35);
      tl.to('#g-cursor', { opacity: 0, duration: 0.3 }, 1.0);

      // 1.2-2.2 · the camera goes to the graph.
      tl.to('#g-cam', { x: ${r2(960 - PANEL_CX)}, y: ${r2(540 - (CARD_TOP + CARD_BOT) / 2)}, scale: 1.0, duration: 1.0, ease: 'power2.inOut' }, 1.2);
      // 2.2-3.6 · the whole window lies down; the graph runs on far beyond it.
      tl.to('#g-tilt', { rotationX: 70, duration: 1.4, ease: 'power2.inOut' }, 2.2);
      tl.to('#g-run', { clipPath: 'inset(0px 0px 0px 0px)', duration: 1.2, ease: 'power2.in' }, 2.4);
      tl.to(['#g-win', '#g-panel'], { opacity: 0.18, duration: 1.0, ease: 'power2.inOut' }, 2.4);
      tl.to('#g-fog', { opacity: 1, duration: 1.0 }, 2.6);
      tl.to('#g-cam', { x: ${RUNCAM.x}, y: ${RUNCAM.y}, scale: ${RUNCAM.s}, duration: 1.4, ease: 'power2.inOut' }, 2.2);
      // 3.6-8.6 · the run: the graph pours under the camera, faster and faster.
      tl.to('#g-run', { y: ${RUN.y1}, duration: 3.0, ease: 'power2.in' }, 3.6);
      tl.to('#g-run', { y: ${RUN.y2}, duration: 2.0, ease: 'none' }, 6.6);
      tl.to(['#g-win', '#g-panel'], { opacity: 0, duration: 0.8 }, 4.0);
      // 8.6-10.4 · it brakes as the lanes fold into main; the camera rises to look straight down on the release.
      tl.to('#g-run', { y: ${RUN.y3}, duration: 1.8, ease: 'power2.out' }, 8.6);
      tl.to('#g-tilt', { rotationX: 0, duration: 1.8, ease: 'power2.inOut' }, 8.6);
      tl.to('#g-fog', { opacity: 0, duration: 1.0 }, 9.0);
      tl.to('#g-cam', { x: ${r2(SHIP.nx - nodeWX * SHIP.s)}, y: ${r2(SHIP.ny - nodeWY * SHIP.s)}, scale: ${r2(SHIP.s)}, duration: 1.8, ease: 'power2.inOut' }, 8.6);
      for (let c = 5; c >= 1; c--) tl.fromTo('#g-m' + c, { scale: 1, transformOrigin: '50% 50%' }, { keyframes: [{ scale: 1.9, duration: 0.08 }, { scale: 1, duration: 0.25 }], immediateRender: false }, 9.15 + (5 - c) * 0.2);
      // 10.4 · v1.0.0.
      tl.to('#g-node', { scale: 1, duration: 0.45, ease: 'back.out(2)' }, 10.4);
      tl.fromTo('#g-tag', { opacity: 0, y: -36, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.35, ease: 'expo.out' }, 10.6);
      tl.fromTo('#g-title', { opacity: 0, filter: 'blur(10px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.2, ease: 'power2.out' }, 10.9);`
  const vars = ` data-composition-variables='[{"id":"tag","type":"string","label":"Release tag","default":"v1.0.0"},{"id":"ship","type":"string","label":"Ship line","default":"上线。"}]'`
  W('compositions/git.html', scene('git', 13, css, body, script, vars))
}

/* ═════════ Shot 6 · end (33-40 s): the site's hero on the CRT ═════════ */
{
  const qs = Array.from({ length: 10 }, (_, i) => `<g class="q" id="e-q${i}">${chromeText('eq', 106 + i * 190, 150, '?', 5)}</g>`).join('')
  const css = `
    #e-screen { position: absolute; inset: 0; transform-origin: 50% 50%; }
    #e-mark, #e-qs { position: absolute; left: 0; width: 1920px; }
    #e-mark { top: 40px; height: 250px; }
    #e-mark text { font-family: 'Wavi Archivo', sans-serif; font-weight: 900; font-stretch: 125%; font-size: 230px; letter-spacing: -5px; }
    #e-qs { top: 300px; height: 190px; }
    #e-qs text { font-family: 'Wavi Archivo', sans-serif; font-weight: 900; font-stretch: 112%; font-size: 190px; }
    #e-title { position: absolute; left: 0; right: 0; top: 520px; text-align: center; font: 900 150px/1 'Wavi Sans SC', sans-serif; letter-spacing: -0.02em; color: #ededed; }
    #e-sub { position: absolute; left: 0; right: 0; top: 712px; text-align: center; font: 400 32px/50px ${SANS}; color: #a1a1a1; }
    #e-sub div { height: 50px; }
    #e-sub em { font-style: normal; color: #ff5fb0; }
    #e-btns { position: absolute; left: 0; right: 0; top: 842px; display: flex; justify-content: center; gap: 22px; }
    #e-btns span { padding: 0 40px; font: 600 34px/88px ${SANS}; }
    #e-btns .p { background: #ededed; color: #0a0a0a; }
    #e-btns .s { box-shadow: inset 0 0 0 2px #ffffff52; color: #ededed; }
    #e-note { position: absolute; left: 0; right: 0; top: 976px; text-align: center; font: 400 28px/1 ${SANS}; color: #a1a1a1; }
    #e-scan { position: absolute; inset: 0; background: repeating-linear-gradient(to bottom, transparent 0 3px, rgba(0, 0, 0, 0.28) 3px 4px); }
    #e-band { position: absolute; left: 0; right: 0; top: 0; height: 140px; background: linear-gradient(to bottom, transparent, rgba(255, 255, 255, 0.05), transparent); }`
  const body = `      <div class="grain" id="e-grain"></div>
      <div id="e-screen">
        <svg id="e-mark" viewBox="0 0 1920 250" aria-label="WAVI">${chromeDefs('em')}${chromeText('em', 960, 215, 'WAVI', 6, 'e-fringe')}</svg>
        <svg id="e-qs" viewBox="0 0 1920 190" aria-label="??????????">${chromeDefs('eq')}${qs}</svg>
        <div id="e-title" data-var-text="title">一个人，多线程。</div>
        <div id="e-sub"><div id="e-sub1" data-var-text="sub1">给同时跑好几个 Claude Code 和 Codex 的个人开发者。</div><div id="e-sub2">agent 各干各的，只在需要你时<em>叫你</em>。</div></div>
        <div id="e-btns"><span class="p" id="e-dl" data-var-text="cta">下载 macOS 版</span><span class="s" id="e-gh">GitHub ↗</span></div>
        <div id="e-note" data-var-text="note">免费开源 · macOS 13+ · Apple 芯片与 Intel</div>
      </div>
      <div id="e-band"></div>
      <div id="e-scan"></div>`
  const script = `
      tl.fromTo('#e-grain', { x: 0, y: 0 }, { x: 53, y: -31, duration: 7, ease: 'steps(84)' }, 0);
      // 0 · hard cut: the tube switches on, a bright line opening into the picture.
      tl.fromTo('#e-screen', { scaleY: 0.02, scaleX: 0.7, filter: 'brightness(3)' }, { scaleY: 1, scaleX: 1, filter: 'brightness(1)', duration: 0.28, ease: 'expo.out' }, 0);
      tl.fromTo('#e-band', { y: -160 }, { y: 1120, duration: 2.6, ease: 'none' }, 0.1);
      tl.fromTo('#e-band', { y: -160 }, { y: 1120, duration: 2.6, ease: 'none', immediateRender: false }, 4.2);
      // 0.3 · WAVI wipes in, its fringe settling.
      tl.fromTo('#e-mark', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.45, ease: 'power3.out' }, 0.3);
      tl.fromTo('#e-fringe', { x: -12 }, { keyframes: [{ x: 0, duration: 0.3 }, { x: -5, y: 2, duration: 0.03, delay: 1.6 }, { x: 0, y: 0, duration: 0.03 }] }, 0.3);
      // 0.9 · ten "?" flick on, one after another.
      for (let i = 0; i < 10; i++) {
        tl.fromTo('#e-q' + i, { opacity: 0 }, { keyframes: [{ opacity: 1, duration: 0.02 }, { opacity: 0.3, duration: 0.03 }, { opacity: 1, duration: 0.02 }] }, 0.9 + i * 0.06);
      }
      // 1.7 · the line; 2.6 the sub; 3.4 the buttons and the note.
      tl.fromTo('#e-title', { opacity: 0, filter: 'blur(12px)', scale: 1.02 }, { opacity: 1, filter: 'blur(0px)', scale: 1, duration: 0.2, ease: 'power2.out' }, 1.7);
      tl.fromTo('#e-sub1', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.18, ease: 'power2.out' }, 2.6);
      tl.fromTo('#e-sub2', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.18, ease: 'power2.out' }, 2.9);
      tl.fromTo('#e-btns span', { opacity: 0, scale: 0.94, filter: 'blur(6px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.3, ease: 'expo.out', stagger: 0.08 }, 3.4);
      tl.fromTo('#e-note', { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' }, 3.7);`
  const vars = ` data-composition-variables='[{"id":"title","type":"string","label":"Claim","default":"一个人，多线程。"},{"id":"sub1","type":"string","label":"Sub line","default":"给同时跑好几个 Claude Code 和 Codex 的个人开发者。"},{"id":"cta","type":"string","label":"Download button","default":"下载 macOS 版"},{"id":"note","type":"string","label":"Note","default":"免费开源 · macOS 13+ · Apple 芯片与 Intel"}]'`
  W('compositions/end.html', scene('end', 7, css, body, script, vars))
}

/* ═════════ root: scenes and the mix ═════════ */
const SCENES = [['idea', 0, 10], ['app', 10, 10], ['git', 20, 13], ['end', 33, 7]]
// [id, file, start, duration, volume, mediaStart] — each placed so its peak lands a frame after its picture.
const SFX = [
  ['sfx-pulse1', 'glitch-1', 0.3, 0.45, 0.3, 0.6],
  ['sfx-pulse2', 'glitch-1', 0.8, 0.45, 0.4, 0.6],
  ['sfx-burst', 'whoosh-cinematic', 0.93, 1.6, 0.8, 1.9],
  ['sfx-burst-hit', 'impact-bass-1', 1.46, 1.4, 0.55],
  ['sfx-land1', 'click-soft', 5.73, 0.37, 1.1], ['sfx-land2', 'pop', 5.72, 0.5, 0.45], ['sfx-land3', 'click-soft', 5.93, 0.37, 1.1],
  ['sfx-land4', 'pop', 5.92, 0.5, 0.45], ['sfx-land5', 'click-soft', 6.13, 0.37, 1.1], ['sfx-land6', 'pop', 6.12, 0.5, 0.45],
  ['sfx-click1', 'click', 11.55, 0.37, 1.3],
  ['sfx-morph', 'whoosh-short', 11.5, 0.57, 0.35],
  ['sfx-grab1', 'click-soft', 13.45, 0.37, 1.1], ['sfx-drop1', 'whoosh', 14.07, 0.57, 0.3], ['sfx-drop1b', 'pop', 14.13, 0.5, 0.5],
  ['sfx-grab2', 'click-soft', 15.4, 0.37, 1.1], ['sfx-drop2', 'whoosh-short', 15.97, 0.57, 0.3], ['sfx-drop2b', 'pop', 16.03, 0.5, 0.5],
  ['sfx-grab3', 'click-soft', 17.3, 0.37, 1.1], ['sfx-drop3', 'whoosh', 17.97, 0.57, 0.3], ['sfx-drop3b', 'pop', 18.03, 0.5, 0.5],
  ['sfx-focus', 'click', 19.03, 0.37, 1.1],
  ['sfx-git', 'click', 20.15, 0.37, 1.3], ['sfx-panel', 'whoosh-short', 20.12, 0.57, 0.35],
  ['sfx-tilt', 'whoosh-cinematic', 22.3, 1.6, 0.6, 1.9],
  ['sfx-riser', 'riser', 26.93, 3.5, 0.45],
  ['sfx-merge1', 'click-soft', 29.08, 0.37, 0.9], ['sfx-merge2', 'click-soft', 29.28, 0.37, 0.9], ['sfx-merge3', 'click-soft', 29.48, 0.37, 0.9], ['sfx-merge4', 'click-soft', 29.68, 0.37, 0.9], ['sfx-merge5', 'click-soft', 29.88, 0.37, 0.9],
  ['sfx-ship', 'impact-bass-1', 30.36, 1.8, 0.75],
  ['sfx-tag', 'pop', 30.5, 0.5, 0.5],
  ['sfx-tube', 'glitch-1', 32.81, 0.6, 0.45, 0.6],
  ['sfx-mark', 'whoosh-short', 33.15, 0.57, 0.4],
  ['sfx-cta', 'pop', 36.3, 0.5, 0.45]
]
// The first Studio lane (from 10) that is free when the clip starts.
const laneEnds = []
const lane = (s, d) => {
  let i = laneEnds.findIndex((end) => end <= s)
  if (i < 0) i = laneEnds.push(0) - 1
  laneEnds[i] = s + d
  return 10 + i
}
const auto = (o) => JSON.stringify(o).replace(/"/g, '&quot;')
const fx = auto({ version: 1, nodes: [{ type: 'lowpass', id: 'lp', label: 'Muffled until the burst', params: { frequency: 700 } }, { type: 'limiter', id: 'lim', params: { limit: -1 } }] })
const automation = auto({ version: 1, lanes: [
  { target: 'volume', points: [{ t: 0, v: 0.55 }, { t: 1.45, v: 0.55 }, { t: 1.5, v: 0.8 }, { t: 22.0, v: 0.8 }, { t: 23.5, v: 0.7 }, { t: 30.3, v: 0.7 }, { t: 30.4, v: 0.85 }, { t: 40, v: 0.85 }] },
  { target: 'fx.lp.frequency', points: [{ t: 0, v: 700 }, { t: 1.4, v: 1200, curve: 0.6 }, { t: 1.5, v: 18000 }] }
] })
W('index.html', `<!doctype html>
<html
  lang="zh-CN"
  data-composition-variables='[
    {"id":"color-ground","type":"color","label":"Ground","default":"#050505"},
    {"id":"color-ink","type":"color","label":"Text","default":"#ededed"},
    {"id":"color-accent","type":"color","label":"Accent","default":"#ff5fb0"}
  ]'
>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
      :root { --color-ground: #050505; --color-ink: #ededed; --color-accent: #ff5fb0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: var(--color-ground); }
      #root { position: relative; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="40" data-width="1920" data-height="1080">
${SCENES.map(([id, s, d]) => `      <div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${s}" data-duration="${d}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>`).join('\n')}
      <audio id="music" class="clip" src="assets/music/do-robots-have-a-god.mp3" data-timeline-role="music" data-start="0" data-duration="40" data-media-start="6.56" data-track-index="9" data-volume="1" data-fade-out="1.6" data-fx-chain="${fx}" data-automation="${automation}"></audio>
${SFX.map(([id, f, s, d, v, ms]) => `      <audio id="${id}" class="clip" src="assets/sfx/${f}.mp3" data-start="${s}" data-duration="${d}"${ms ? ` data-media-start="${ms}"` : ''} data-track-index="${lane(s, d)}" data-volume="${v}"></audio>`).join('\n')}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines['main'] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`)
console.log('built')
