// Generates the six posed key frames of film F (the storyboard). Run from the project root: node tools/gen-frames.mjs .
import fs from 'node:fs'
import path from 'node:path'

const OUT = process.argv[2]
const W = (p, s) => { fs.mkdirSync(path.dirname(path.join(OUT, p)), { recursive: true }); fs.writeFileSync(path.join(OUT, p), s) }

/* ───────── shared bits ───────── */
const FONTS = `
    @font-face { font-family: 'Wavi Archivo'; src: url('assets/fonts/archivo-wdth-wght-subset.woff2') format('woff2'); font-weight: 100 900; font-stretch: 62% 125%; }
    @font-face { font-family: 'Wavi Sans SC'; src: url('assets/fonts/noto-sans-sc-film-subset.woff') format('woff'); font-weight: 100 900; }
    @font-face { font-family: 'Wavi Mono'; src: url('assets/fonts/jetbrains-mono-latin-wght-normal.woff2') format('woff2'); font-weight: 100 800; }`
const SANS = `Inter, 'Wavi Sans SC', sans-serif`
const MONO = `'Wavi Mono', 'JetBrains Mono', 'Wavi Sans SC', monospace`
const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>")`

const ICON = {
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  fork: '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
}
const icon = (name, s, cls = '') => `<svg class="ic ${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`

const glyph = (status, s) => {
  const v = 'viewBox="0 0 14 14"'
  if (status === 'running') return `<svg class="glyph" width="${s}" height="${s}" ${v}><circle cx="7" cy="7" r="5.1" fill="none" stroke="#ffffff2e" stroke-width="1.8"/><path d="M7 1.9 A5.1 5.1 0 0 1 9.32 11.54" fill="none" stroke="#5ea1ff" stroke-width="1.8"/></svg>`
  if (status === 'done') return `<svg class="glyph" width="${s}" height="${s}" ${v}><circle cx="7" cy="7" r="4" fill="#3dd68c"/></svg>`
  if (status === 'needs') return `<svg class="glyph" width="${s}" height="${s}" ${v}><circle cx="7" cy="7" r="7" fill="#ff5fb01f"/><circle cx="7" cy="7" r="4" fill="#ff5fb0"/></svg>`
  return `<svg class="glyph" width="${s}" height="${s}" ${v}><circle cx="7" cy="7" r="3.25" fill="none" stroke="#6b6b6b" stroke-width="1.5"/></svg>`
}

/** The sessions of the film (the site's zh replica, extended to ten for the burst). */
const S = {
  cookie: { t: 'Cookie 会话迁移', a: '编辑 src/auth/session.ts', ag: 'claude', br: 'jacob/session-cookie', tm: '4m', d: '+42 −18', st: 'running' },
  checkout: { t: '结算页性能优化', a: '运行 pnpm test checkout', ag: 'codex', br: 'jacob/checkout-perf', tm: '12m', d: '+128 −35', st: 'running' },
  mobile: { t: '修复移动端导航抖动', a: '已完成，等你审阅', ag: 'claude', br: 'jacob/mobile-nav', tm: '2m 前', d: '+23 −9', st: 'done' },
  agg: { t: '侧边栏状态聚合', a: '读取 src/state/agents.ts', ag: 'claude', br: 'jacob/sidebar-status', tm: '6m', d: '+61 −4', st: 'running' },
  lanes: { t: 'Git 图谱布局算法', a: '编辑 src/shared/git-graph/lanes.ts', ag: 'claude', br: 'jacob/graph-lanes', tm: '18m', d: '+210 −12', st: 'running' },
  vite: { t: '迁移到 Vite 7', a: '编辑 vite.config.ts', ag: 'codex', br: 'jacob/vite-7', tm: '3m', d: '+40 −31', st: 'running' },
  webhook: { t: '支付回调重试', a: '运行 pnpm vitest webhook', ag: 'codex', br: 'jacob/webhook-retry', tm: '9m', d: '+19 −2', st: 'running' },
  search: { t: '文档站搜索', a: '读取 docs/search/index.ts', ag: 'claude', br: 'jacob/docs-search', tm: '7m', d: '+88 −14', st: 'running' },
  i18n: { t: '文案国际化', a: '编辑 locales/zh.json', ag: 'codex', br: 'jacob/i18n-copy', tm: '5m', d: '+73 −20', st: 'running' },
  roadmap: { t: '更新路线图', a: '已完成，等你审阅', ag: 'claude', br: 'jacob/docs-roadmap', tm: '1m 前', d: '+12 −3', st: 'done' }
}
const SIDEBAR = [['acme-web', 4, ['cookie', 'checkout', 'mobile']], ['terminal-reborn', 4, ['agg', 'lanes', 'vite']]]

/** Sidebar row CSS at scale k (base sizes are the app's: Figma SessionRow 11:51). */
const rowCss = (k, sel = '.row') => {
  const p = (n) => `${+(n * k).toFixed(2)}px`
  return `
    ${sel} { position: relative; display: flex; align-items: flex-start; gap: ${p(8)}; padding: ${p(8)} ${p(12)} ${p(8)} ${p(28)}; border-radius: ${p(6)}; }
    ${sel} .glyph { flex: none; margin-top: ${p(2)}; }
    ${sel} .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${p(2)}; }
    ${sel} .t { font: 400 ${p(13)}/${p(18)} ${SANS}; color: #ededed; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${sel} .a { font: 400 ${p(12)}/${p(16)} ${SANS}; color: #a1a1a1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${sel} .w { display: flex; align-items: center; gap: ${p(4)}; height: ${p(16)}; font: 400 ${p(12)}/${p(16)} ${SANS}; color: #6b6b6b; white-space: nowrap; overflow: hidden; }
    ${sel} .w img { width: ${p(12)}; height: ${p(12)}; flex: none; }
    ${sel} .w .ic { flex: none; margin-left: ${p(2)}; }
    ${sel} .meta { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: ${p(2)}; font: 400 ${p(12)}/${p(16)} ${MONO}; color: #6b6b6b; white-space: nowrap; }
    ${sel} .meta span:first-child { line-height: ${p(18)}; }`
}
const row = (id, k, cls = '', extra = '') => {
  const s = S[id]
  return `<div class="row ${cls}" id="row-${id}"${extra}>${glyph(s.st, Math.round(14 * k))}<div class="main"><div class="t">${s.t}</div><div class="a">${s.a}</div><div class="w"><img src="assets/brand/${s.ag}.svg" alt="" />${icon('branch', Math.round(12 * k))}<span>${s.br}</span></div></div><div class="meta"><span>${s.tm}</span><span>${s.d}</span></div></div>`
}
const sbHeadCss = (k, sel = '.sb-head') => {
  const p = (n) => `${+(n * k).toFixed(2)}px`
  return `
    ${sel} { display: flex; align-items: center; gap: ${p(6)}; height: ${p(32)}; padding: 0 ${p(12)} 0 ${p(8)}; font: 600 ${p(13)}/1 ${SANS}; color: #ededed; }
    ${sel} .ic { color: #6b6b6b; }
    ${sel} b { flex: 1; font-weight: 600; }
    ${sel} .count { font: 400 ${p(12)}/1 ${MONO}; color: #6b6b6b; }`
}
const sbHead = (name, n, k) => `<div class="sb-head">${icon('chev', Math.round(14 * k))}<b>${name}</b><span class="count">${n}</span></div>`

const scene = (id, dur, css, body, opts = '') => `<template>
  <style>${FONTS}
    #root { position: absolute; inset: 0; overflow: hidden; background: #050505; }
    .clip.stage { position: absolute; inset: 0; }
    .grain { position: absolute; inset: -40px; opacity: 0.04; background-image: ${GRAIN}; pointer-events: none; }
${css}
  </style>
  <div id="root" data-composition-id="${id}" data-width="1920" data-height="1080">
    <div id="${id}-stage" class="clip stage" data-start="0" data-duration="${dur}" data-layout-allow-overflow data-layout-allow-overlap${opts}>
${body}
    </div>
  </div>
  <script>
    (() => {
      // Posed key frame for the storyboard; the animation replaces it once the stills are approved.
      const tl = gsap.timeline({ paused: true });
      window.__timelines = window.__timelines || {};
      window.__timelines['${id}'] = tl;
    })();
  </script>
</template>
`

/* The site's chrome-and-fringe treatment for big glyphs (WAVI, "?"), as SVG text. */
const chromeDefs = (p) => `<defs>
        <linearGradient id="${p}-chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfd8ff"/><stop offset="0.5" stop-color="#ffffff"/><stop offset="0.72" stop-color="#ffd3e8"/><stop offset="0.92" stop-color="#fff6cd"/></linearGradient>
        <pattern id="${p}-lines" width="8" height="14" patternUnits="userSpaceOnUse"><rect y="11" width="8" height="2" fill="#000" opacity="0.45"/></pattern>
      </defs>`
const chromeText = (p, x, y, text, f) => `<g data-layout-ignore><text x="${x - f}" y="${y - f * 0.5}" text-anchor="middle" fill="#2141ff">${text}</text><text x="${x + f * 0.8}" y="${y + f * 0.6}" text-anchor="middle" fill="#ff2a12">${text}</text><text x="${x + f * 0.2}" y="${y + f}" text-anchor="middle" fill="#ffd000">${text}</text><text x="${x}" y="${y}" text-anchor="middle" fill="#000">${text}</text></g>
        <text x="${x}" y="${y}" text-anchor="middle" fill="url(#${p}-chrome)">${text}</text><text x="${x}" y="${y}" text-anchor="middle" fill="url(#${p}-lines)">${text}</text>`

/* ───────── 01 idea: the "?" bursts into sessions ───────── */
{
  const k = 2
  const slabs = [
    ['cookie', -560, -330, 260, -12, 26, -7, 10],
    ['checkout', 560, -310, -160, 10, -22, 6, 0],
    ['mobile', -600, 300, -60, 14, 30, 5, 2],
    ['agg', 620, 330, 300, -16, -30, -9, 12],
    ['lanes', 40, -470, -520, 38, 0, 3, 0],
    ['vite', -980, -20, -380, 0, 52, 0, 3],
    ['webhook', 990, 20, -460, 0, -50, 0, 3],
    ['search', 80, 480, -400, -34, 4, -2, 1],
    ['i18n', -470, -250, -1000, 4, 18, -4, 0],
    ['roadmap', 520, 220, -900, -6, -14, 5, 0]
  ]
  const css = `${rowCss(k)}
    #b-space { position: absolute; inset: 0; perspective: 1400px; perspective-origin: 50% 50%; }
    .row.slab { position: absolute; left: 960px; top: 540px; width: 728px; margin: -70px 0 0 -364px; background: #111111; box-shadow: inset 0 0 0 2px #ffffff14; border-radius: 20px; }
    #b-q { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }
    #b-q text { font-family: 'Wavi Archivo', sans-serif; font-weight: 900; font-stretch: 112%; font-size: 360px; }`
  const order = [...slabs].sort((a, b) => a[3] - b[3])
  const body = `      <div class="grain"></div>
      <svg id="b-q" viewBox="0 0 1920 1080" aria-label="?" style="transform:scale(1.1);transform-origin:960px 560px">
        ${chromeDefs('bq')}
        ${chromeText('bq', 960, 680, '?', 6)}
      </svg>
      <div id="b-space">
${order.map(([id, x, y, z, rx, ry, rz, blur]) => '        ' + row(id, k, 'slab', ` style="transform: translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg);${blur ? ` filter: blur(${blur}px);` : ''}"`)).join('\n')}
      </div>`
  W('compositions/frames/01-idea.html', scene('idea', 5, css, body))
}

/* ───────── 02 order: a centred sidebar ───────── */
{
  const k = 2
  const css = `${rowCss(k)}${sbHeadCss(k)}
    #o-sb { position: absolute; left: 576px; top: 44px; width: 768px; display: flex; flex-direction: column; padding: 0 20px; }
    #o-sb .sb-head { margin-top: 16px; }
    #o-sb .sb-head:first-child { margin-top: 0; }
    .row.landing { transform: translateY(-22px); filter: blur(2px); opacity: 0.9; }`
  const rows = SIDEBAR.map(([name, n, ids]) => sbHead(name, n, k) + '\n' + ids.map((id, i) => '        ' + row(id, k, id === 'vite' ? 'landing' : '')).join('\n')).join('\n        ')
  const body = `      <div class="grain"></div>
      <div id="o-sb">
        ${rows}
      </div>`
  W('compositions/frames/02-order.html', scene('order', 5, css, body))
}

/* ───────── shared app chrome (sidebar + panes) at scale k ───────── */
const paneCss = (k) => {
  const p = (n) => `${+(n * k).toFixed(2)}px`
  return `
    .pane { position: absolute; background: #0a0a0a; overflow: hidden; }
    .pane .ph { display: flex; align-items: center; gap: ${p(8)}; height: ${p(40)}; padding: 0 ${p(10)} 0 ${p(16)}; border-bottom: 1px solid #ffffff0d; }
    .pane .ph b { font: 600 ${p(13)}/1 ${SANS}; color: #a1a1a1; white-space: nowrap; }
    .pane.focus .ph b { color: #ededed; }
    .pane .ph .br { display: flex; align-items: center; gap: ${p(4)}; font: 400 ${p(12)}/1 ${MONO}; color: #6b6b6b; white-space: nowrap; }
    .pane .ph .sp { flex: 1; }
    .pane .ph .tools { display: flex; align-items: center; gap: ${p(2)}; color: #6b6b6b; }
    .pane .ph .tools .ib { width: ${p(28)}; height: ${p(28)}; display: flex; align-items: center; justify-content: center; border-radius: ${p(6)}; }
    .pane .ph .tools .ib.on { background: #ffffff14; color: #ededed; }
    .pane .term { padding: ${p(14)} ${p(16)}; font: 400 ${p(13)}/${p(20)} ${MONO}; color: #c4c4c4; white-space: pre; }
    .term .g { color: #3dd68c; } .term .o { color: #e08a5e; } .term .w { color: #ededed; } .term .d { color: #808080; } .term .v { color: #c79bff; } .term .b { color: #5ea1ff; }
    .hair { position: absolute; background: #ffffff1a; }`
}
const TERM = {
  cookie: [['d', '> '], ['w', '把会话 token 挪进 httpOnly cookie'], null, ['g', '⏺ '], ['w', 'Read'], ['', '(src/auth/session.ts)'], null, ['d', '  ⎿  Read 186 lines'], null, ['g', '⏺ '], ['w', 'Update'], ['', '(src/middleware.ts)'], null, ['d', '  ⎿  Moved the token to an httpOnly cookie'], null, ['g', '⏺ '], ['w', 'Bash'], ['', '(pnpm test auth)'], null, ['d', '  ⎿  '], ['g', '24 passed (1.8s)'], null, ['g', '⏺ '], ['w', 'Update'], ['', '(src/auth/refresh.ts)'], null, ['d', '  ⎿  Refresh the session before expiry'], null, null, ['o', '✻ '], ['o', 'Editing…'], ['d', ' (esc to interrupt)']],
  checkout: [['d', '> '], ['w', '把结算页首屏降到 2 秒以内'], null, ['o', '• '], ['w', 'Explored'], ['', ' checkout/'], null, ['d', '  └ page.tsx, vite.config.ts'], null, ['o', '• '], ['w', 'Edited'], ['', ' vite.config.ts'], null, ['d', '  └ 按路由拆开结算页的 bundle'], null, ['o', '• '], ['w', 'Ran'], ['', ' pnpm test checkout'], null, ['d', '  └ '], ['g', '38 passed'], null, ['o', '• '], ['w', 'Ran'], ['', ' pnpm tsc --noEmit'], null, ['d', '  └ '], ['g', 'no errors']],
  mobile: [['d', '> '], ['w', '修复 iOS 回弹时导航抖动'], null, ['g', '⏺ '], ['w', 'Read'], ['', '(components/Nav.tsx)'], null, ['g', '⏺ '], ['w', 'Update'], ['', '(components/Nav.tsx)'], null, ['d', '  ⎿  Clamp scrollY during iOS bounce'], null, ['g', '⏺ '], ['w', 'Bash'], ['', '(pnpm test nav)'], null, ['d', '  ⎿  '], ['g', '12 passed'], null, null, ['g', '⏺ '], ['w', '导航不再抖动，等你审阅。']],
  agg: [['d', '> '], ['w', '侧栏按状态聚合会话'], null, ['g', '⏺ '], ['w', 'Read'], ['', '(src/state/agents.ts)'], null, ['d', '  ⎿  Read 92 lines'], null, ['g', '⏺ '], ['w', 'Search'], ['', '(“needsAttention”)'], null, ['d', '  ⎿  Found 7 files']]
}
const term = (id) => `<div class="term">${TERM[id].map((s) => (s === null ? '\n' : s[0] ? `<span class="${s[0]}">${s[1]}</span>` : s[1])).join('')}</div>`
const paneHead = (id, k, focus, single = false) => `<div class="ph"><b>${S[id].t}</b><span class="br">${icon('branch', Math.round(13 * k))}${S[id].br}</span><span class="sp"></span><span class="tools">${focus ? ['globe', 'branch', 'fork', 'folder'].map((n) => `<span class="ib${n === 'branch' && focus === 'git' ? ' on' : ''}" id="tool-${n}">${icon(n, Math.round(16 * k))}</span>`).join('') : ''}<span class="ib">${icon('dots', Math.round(16 * k))}</span>${single ? '' : `<span class="ib">${icon('x', Math.round(16 * k))}</span>`}</span></div>`

const CURSOR = (x, y, h) => `<svg class="cursor" style="position:absolute;left:${x}px;top:${y}px" width="${Math.round(h * 0.66)}" height="${h}" viewBox="-1 -1 19 27"><path d="M0 0 L0 22.5 L5.4 17.4 L8.9 25.6 L12.6 24 L9.2 16 L16.4 16 Z" fill="#ffffff" stroke="#000000" stroke-width="1.4" stroke-linejoin="round"/></svg>`

/* ───────── 03 split: dragging the fourth session in ───────── */
{
  const k = 1.5
  const SBW = 510
  const css = `${rowCss(k)}${sbHeadCss(k)}${paneCss(k)}
    #s-sb { position: absolute; left: 0; top: 0; width: ${SBW}px; height: 1080px; padding: 0 12px; background: #050505; }
    #s-sb .lights { display: flex; gap: 12px; height: 66px; align-items: center; padding-left: 12px; }
    #s-sb .lights i { width: 18px; height: 18px; border-radius: 50%; }
    #s-sb .sb-head { margin-top: 10px; }
    #s-sb .row.sel { background: #ffffff12; }
    #s-sb .row.shown { box-shadow: inset 0 0 0 1.5px #ffffff24; }
    #s-sb .row.dragged { opacity: 0.4; }
    #s-main { position: absolute; left: ${SBW + 2}px; top: 0; right: 0; bottom: 0; border-radius: 24px 0 0 24px; overflow: hidden; background: #0a0a0a; }
    #s-drop { position: absolute; border-radius: 14px; background: #ffffff0f; box-shadow: inset 0 0 0 2px #ffffff3d; display: flex; align-items: center; justify-content: center; }
    #s-drop span { padding: 12px 22px; border-radius: 12px; background: #050505e0; font: 500 30px/1 ${SANS}; color: #ededed; }
    #s-ghost { position: absolute; width: 486px; background: #1a1a1a; border-radius: 10px; box-shadow: inset 0 0 0 1.5px #ffffff24, 0 16px 40px #00000080; opacity: 0.94; }`
  const MW = 1920 - SBW - 2, half = Math.round(MW / 2)
  const sbRows = SIDEBAR.map(([name, n, ids]) => sbHead(name, n, k) + ids.map((id) => row(id, k, { cookie: 'shown', checkout: 'sel', mobile: 'shown', agg: 'dragged' }[id] ?? '')).join('')).join('')
  const body = `      <div id="s-sb"><div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>${sbRows}</div>
      <div id="s-main">
        <div class="pane" id="pane-cookie" style="left:0;top:0;width:${half - 1}px;height:1080px">${paneHead('cookie', k, false)}${term('cookie')}</div>
        <div class="pane focus" id="pane-checkout" style="left:${half + 1}px;top:0;width:${MW - half - 1}px;height:539px">${paneHead('checkout', k, true)}${term('checkout')}</div>
        <div class="pane" id="pane-mobile" style="left:${half + 1}px;top:541px;width:${MW - half - 1}px;height:539px">${paneHead('mobile', k, false)}${term('mobile')}</div>
        <div class="hair" style="left:${half - 1}px;top:0;width:2px;height:1080px"></div>
        <div class="hair" style="left:${half + 1}px;top:539px;width:${MW - half - 1}px;height:2px"></div>
        <div id="s-drop" data-layout-allow-occlusion style="left:12px;top:552px;width:${half - 25}px;height:516px"><span>显示</span></div>
      </div>
      <div id="s-ghost" data-layout-allow-occlusion style="left:610px;top:930px">${row('agg', k)}</div>
      ${CURSOR(640, 966, 72)}`
  W('compositions/frames/03-split.html', scene('split', 10, css, body))
}

/* ───────── 04 git: the window becomes a floor, the graph a runway ───────── */
{
  const LANES = [
    { x: 110, c: '#a1a1a1', name: 'main' },
    { x: 200, c: '#5ea1ff', name: 'jacob/session-cookie' },
    { x: 290, c: '#b794ff', name: 'jacob/checkout-perf' },
    { x: 380, c: '#3dd68c', name: 'jacob/mobile-nav' },
    { x: 470, c: '#5ea1ff', name: 'jacob/sidebar-status' },
    { x: 560, c: '#5ea1ff', name: 'jacob/graph-lanes' },
    { x: 650, c: '#b794ff', name: 'jacob/vite-7' },
    { x: 740, c: '#e08a5e', name: 'origin/i18n-copy' }
  ]
  const SUBJ = [
    [1, 'Refresh session before expiry'], [2, 'Inline critical checkout CSS'], [5, 'Pack lanes left to right'], [3, 'Snapshot nav at three breakpoints'],
    [4, 'Group rows by status'], [6, 'Switch to Vite 7 config'], [1, 'Rotate refresh token on use'], [7, 'Extract zh strings'],
    [2, 'Lazy-load the coupon panel'], [5, 'Route merge edges around dots'], [3, 'Clamp scrollY during iOS bounce'], [4, 'Read status from hooks'],
    [0, "Merge branch 'header-sticky'"], [6, 'Drop the legacy CJS plugin'], [1, 'Move session token to httpOnly cookie'], [2, 'Split checkout bundle by route'],
    [7, 'Add zh locale fallback'], [5, 'Virtualise long histories'], [4, 'Count sessions per project'], [1, 'Add Session model and migration'],
    [3, 'Add bounce scenario tests'], [2, 'Memoize cart totals per render'], [6, 'Upgrade vitest'], [0, 'Bump next to 15.3']
  ]
  SUBJ.unshift(...SUBJ.slice(0, 16).map(([l, t]) => [(l + 3) % 8, t]))
  const GAP = 150, N = SUBJ.length, H = N * GAP + 200
  const lanes = LANES.map((l) => `<line x1="${l.x}" y1="0" x2="${l.x}" y2="${H}" stroke="${l.c}" stroke-width="7" stroke-linecap="round" opacity="0.9"/>`).join('')
  const dots = SUBJ.map(([ln, _], i) => `<circle cx="${LANES[ln].x}" cy="${100 + i * GAP}" r="17" fill="#0a0a0a" stroke="${LANES[ln].c}" stroke-width="7"/>`).join('')
  const labels = SUBJ.map(([ln, s], i) => {
    const y = 100 + i * GAP
    const ref = i % 5 === 1 ? `<span data-layout-allow-occlusion class="ref" style="color:${LANES[ln].c};box-shadow:inset 0 0 0 2px ${LANES[ln].c}66">${LANES[ln].name}</span>` : ''
    const near = i >= N - 3
    return `<div data-layout-allow-occlusion class="cm${near ? ' near' : ''}" style="top:${y - 26}px">${ref}<span data-layout-allow-occlusion class="s">${s}</span><span data-layout-allow-occlusion class="tm">${(N - i) * 3}m</span></div>`
  }).join('\n          ')
  const css = `
    #g-cam { position: absolute; inset: 0; perspective: 900px; perspective-origin: 50% -4%; }
    #g-floor { position: absolute; left: 190px; width: 1600px; height: ${H}px; bottom: -40px; transform-origin: 50% 100%; transform: rotateX(70deg); background: #0a0a0a; box-shadow: inset 0 0 0 3px #ffffff14; border-radius: 40px; }
    #g-floor svg { position: absolute; left: 0; top: 0; }
    .cm { position: absolute; left: 840px; right: 60px; height: 52px; display: flex; align-items: center; gap: 22px; font: 400 40px/52px ${SANS}; color: #ededed; white-space: nowrap; }
    .cm .s { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    .cm .tm { font: 400 34px/52px ${MONO}; color: #6b6b6b; }
    .cm .ref { padding: 0 16px; border-radius: 10px; font: 500 30px/48px ${MONO}; }
    .cm.near { filter: blur(6px); }
    #g-head { position: absolute; left: 840px; top: ${H - 40}px; }
    #g-fog { position: absolute; inset: 0; background: linear-gradient(to bottom, #050505 0%, #050505 12%, #05050500 34%); pointer-events: none; }`
  const body = `      <div id="g-cam">
        <div id="g-floor">
          <svg width="900" height="${H}" viewBox="0 0 900 ${H}">${lanes}${dots}</svg>
          ${labels}
        </div>
      </div>
      <div id="g-fog" data-layout-allow-occlusion></div>`
  W('compositions/frames/04-git.html', scene('git', 8, css, body))
}

/* ───────── 05 ship: every lane folds into main, v1.0.0 ───────── */
{
  const NX = 700, NY = 440
  const L = [
    ['#5ea1ff', 300], ['#b794ff', 400], ['#3dd68c', 500], ['#5ea1ff', 600], ['#a1a1a1', 700], ['#5ea1ff', 800], ['#b794ff', 900], ['#e08a5e', 1000]
  ]
  const paths = L.map(([c, x]) => x === 700
    ? `<line x1="700" y1="1120" x2="${NX}" y2="${NY}" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`
    : `<path d="M${x} 1120 L${x} ${NY + 260 + Math.abs(x - 700) * 0.35} C${x} ${NY + 90}, ${NX} ${NY + 120}, ${NX} ${NY}" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`).join('')
  const lastDots = L.filter(([, x]) => x !== 700).map(([c, x]) => `<circle cx="${x}" cy="${NY + 260 + Math.abs(x - 700) * 0.35}" r="15" fill="#0a0a0a" stroke="${c}" stroke-width="7"/>`).join('')
  const css = `
    #h-svg { position: absolute; left: 0; top: 0; }
    #h-tag { position: absolute; left: ${NX + 70}px; top: ${NY - 30}px; padding: 0 22px; border-radius: 12px; background: #ededed; color: #0a0a0a; font: 600 40px/60px ${MONO}; }
    #h-title { position: absolute; left: 1150px; top: ${NY - 128}px; font: 900 200px/1 'Wavi Sans SC', sans-serif; letter-spacing: -0.02em; color: #ededed; }`
  const body = `      <div class="grain"></div>
      <svg id="h-svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <line x1="${NX}" y1="${NY}" x2="${NX}" y2="-20" stroke="#a1a1a1" stroke-width="7" opacity="0.35"/>
        ${paths}${lastDots}
        <circle cx="${NX}" cy="${NY}" r="40" fill="#3dd68c"/>
        <path d="M${NX - 16} ${NY + 1} l11 11 l22 -24" fill="none" stroke="#0a0a0a" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div id="h-tag">v1.0.0</div>
      <div id="h-title">上线。</div>`
  W('compositions/frames/05-ship.html', scene('ship', 5, css, body))
}

/* ───────── 06 end: the site's hero on the CRT ───────── */
{
  const qs = Array.from({ length: 10 }, (_, i) => chromeText('eq', 106 + i * 190, 150, '?', 5)).join('\n        ')
  const css = `
    #e-mark, #e-qs { position: absolute; left: 0; width: 1920px; }
    #e-mark { top: 40px; height: 250px; }
    #e-mark text { font-family: 'Wavi Archivo', sans-serif; font-weight: 900; font-stretch: 125%; font-size: 230px; letter-spacing: -5px; }
    #e-qs { top: 300px; height: 190px; }
    #e-qs text { font-family: 'Wavi Archivo', sans-serif; font-weight: 900; font-stretch: 112%; font-size: 190px; }
    #e-title { position: absolute; left: 0; right: 0; top: 520px; text-align: center; font: 900 150px/1 'Wavi Sans SC', sans-serif; letter-spacing: -0.02em; color: #ededed; }
    #e-sub { position: absolute; left: 0; right: 0; top: 712px; text-align: center; font: 400 32px/50px ${SANS}; color: #a1a1a1; }
    #e-sub em { font-style: normal; color: #ff5fb0; }
    #e-btns { position: absolute; left: 0; right: 0; top: 842px; display: flex; justify-content: center; gap: 22px; }
    #e-btns span { padding: 0 40px; font: 600 34px/88px ${SANS}; }
    #e-btns .p { background: #ededed; color: #0a0a0a; }
    #e-btns .s { box-shadow: inset 0 0 0 2px #ffffff52; color: #ededed; }
    #e-note { position: absolute; left: 0; right: 0; top: 976px; text-align: center; font: 400 28px/1 ${SANS}; color: #a1a1a1; }
    .scan { position: absolute; inset: 0; background: repeating-linear-gradient(to bottom, transparent 0 3px, rgba(0, 0, 0, 0.28) 3px 4px); pointer-events: none; }`
  const body = `      <div class="grain"></div>
      <svg id="e-mark" viewBox="0 0 1920 250" aria-label="WAVI">
        ${chromeDefs('em')}
        ${chromeText('em', 960, 215, 'WAVI', 6)}
      </svg>
      <svg id="e-qs" viewBox="0 0 1920 190" aria-label="??????????">
        ${chromeDefs('eq')}
        ${qs}
      </svg>
      <div id="e-title">一个人，多线程。</div>
      <div id="e-sub">给同时跑好几个 Claude Code 和 Codex 的个人开发者。<br/>agent 各干各的，只在需要你时<em>叫你</em>。</div>
      <div id="e-btns"><span class="p">下载 macOS 版</span><span class="s">GitHub ↗</span></div>
      <div id="e-note">免费开源 · macOS 13+ · Apple 芯片与 Intel</div>
      <div class="scan"></div>`
  W('compositions/frames/06-end.html', scene('end', 7, css, body))
}

/* ───────── root ───────── */
const SCENES = [['idea', '01-idea', 0, 5], ['order', '02-order', 5, 5], ['split', '03-split', 10, 10], ['git', '04-git', 20, 8], ['ship', '05-ship', 28, 5], ['end', '06-end', 33, 7]]
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
${SCENES.map(([id, file, s, d]) => `      <div id="${id}" data-composition-id="${id}" data-composition-src="compositions/frames/${file}.html" data-start="${s}" data-duration="${d}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>`).join('\n')}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines['main'] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`)
console.log('ok')
