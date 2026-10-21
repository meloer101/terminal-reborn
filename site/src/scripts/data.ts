/* Content of the live product replicas, in the page's language (Chinese follows the Figma frames: W11 hero
   window, 11 v2 overview, W9 compare, W8 graph). Imported only by browser scripts, so <html lang> decides. */
import type { Status } from './util'

export const ZH = document.documentElement.lang.startsWith('zh')
const pick2 = <T,>(zh: T, en: T): T => (ZH ? zh : en)

/* ───────── Hero: the app window behind the headline ───────── */
export interface SideProject {
  project: string
  count: number
}
export interface SideRow {
  id: string
  title: string
  status: Status
  sub: string
  time: string
  diff: string
  selected?: boolean
}
export const SIDEBAR: (SideProject | SideRow)[] = pick2<(SideProject | SideRow)[]>(
  [
    { project: 'acme-web', count: 4 },
    { id: 'cookie', title: 'Cookie 会话迁移', status: 'needs_you', sub: '等你确认：运行 prisma migrate', time: '已等 1m', diff: '+42 −18', selected: true },
    { id: 'checkout', title: '结算页性能优化', status: 'running', sub: '运行 pnpm test checkout', time: '12m', diff: '+128 −35' },
    { id: 'mobile', title: '修复移动端导航抖动', status: 'done_unread', sub: '已完成，等你审阅', time: '2m', diff: '+23 −9' },
    { id: 'main', title: 'main', status: 'idle', sub: '~/code/acme-web', time: '', diff: '' },
    { project: 'terminal-reborn', count: 2 },
    { id: 'agg', title: '侧边栏状态聚合', status: 'running', sub: '读取 src/state/agents.ts', time: '6m', diff: '+61 −4' },
    { id: 'lanes', title: 'Git 图谱布局算法', status: 'error', sub: 'pnpm build 失败 · 2 个类型错误', time: '18m', diff: '+210 −12' }
  ],
  [
    { project: 'acme-web', count: 4 },
    { id: 'cookie', title: 'Session cookie migration', status: 'needs_you', sub: 'Confirm: run prisma migrate', time: 'waiting 1m', diff: '+42 −18', selected: true },
    { id: 'checkout', title: 'Checkout performance', status: 'running', sub: 'Running pnpm test checkout', time: '12m', diff: '+128 −35' },
    { id: 'mobile', title: 'Fix mobile nav jitter', status: 'done_unread', sub: 'Done, ready for review', time: '2m', diff: '+23 −9' },
    { id: 'main', title: 'main', status: 'idle', sub: '~/code/acme-web', time: '', diff: '' },
    { project: 'terminal-reborn', count: 2 },
    { id: 'agg', title: 'Sidebar status rollup', status: 'running', sub: 'Reading src/state/agents.ts', time: '6m', diff: '+61 −4' },
    { id: 'lanes', title: 'Git graph layout', status: 'error', sub: 'pnpm build failed · 2 type errors', time: '18m', diff: '+210 −12' }
  ]
)

/** Strings the hero's sidebar cycles through, and how a wait is written. */
export const SIM = pick2(
  {
    confirm: '等你确认：运行 prisma migrate',
    price: '编辑 lib/price.ts',
    rollupDone: '聚合逻辑已提交，等你审阅',
    justNow: '刚刚',
    migrate: '运行 pnpm prisma migrate dev',
    cart: '读取 cart/useCart.ts',
    refresh: '编辑 src/auth/refresh.ts',
    agents: '读取 src/state/agents.ts',
    test: '运行 pnpm test checkout'
  },
  {
    confirm: 'Confirm: run prisma migrate',
    price: 'Editing lib/price.ts',
    rollupDone: 'Rollup committed, ready for review',
    justNow: 'just now',
    migrate: 'Running pnpm prisma migrate dev',
    cart: 'Reading cart/useCart.ts',
    refresh: 'Editing src/auth/refresh.ts',
    agents: 'Reading src/state/agents.ts',
    test: 'Running pnpm test checkout'
  }
)
export const waited = (s: number): string => {
  const t = s < 60 ? `${s}s` : s < 120 ? `1m ${s - 60}s` : `${Math.floor(s / 60)}m`
  return ZH ? `已等 ${t}` : `waiting ${t}`
}

export type LaneColor = 'idle' | 'working' | 'done' | 'purple' | 'term' | 'attention' | 'error'
export const LANE_HEX: Record<LaneColor, string> = {
  idle: '#a1a1a1',
  working: '#5ea1ff',
  done: '#3dd68c',
  purple: '#b794ff',
  term: '#e08a5e',
  attention: '#ff5fb0',
  error: '#ff5c5c'
}

export interface GitRow {
  lane: number
  c?: LaneColor
  ref?: string
  ref2?: string
  msg: string
  tm: string
  sel?: boolean
}
export const GIT_ROWS: GitRow[] = [
  { lane: 1, c: 'working', ref: 'session-cookie', msg: 'Add Session model and migration', tm: '4m' },
  { lane: 2, c: 'purple', ref: 'checkout-perf', msg: 'Memoize cart totals per render', tm: '9m' },
  { lane: 1, c: 'working', msg: 'Move session token to httpOnly cookie', tm: '11m' },
  { lane: 3, c: 'done', ref: 'mobile-nav-jitter', msg: 'Clamp scrollY during iOS bounce', tm: '14m', sel: true },
  { lane: 3, c: 'done', msg: 'Add bounce scenario tests', tm: '16m' },
  { lane: 2, c: 'purple', msg: 'Split checkout bundle by route', tm: '26m' },
  { lane: 4, c: 'term', ref: 'origin/fix-lcp', msg: 'Preload hero image on menu page', tm: '40m' },
  { lane: 0, c: 'idle', ref: 'main', ref2: 'origin/main', msg: "Merge branch 'header-sticky'", tm: '1h' },
  { lane: 0, msg: 'Add skip link and focus ring', tm: '2h' },
  { lane: 1, c: 'working', ref: 'header-sticky', msg: 'Make nav sticky instead of fixed', tm: '3h' },
  { lane: 0, msg: 'Bump next to 15.3', tm: '3h' },
  { lane: 0, msg: 'Fix flaky checkout test', tm: '5h' },
  { lane: 0, ref: 'v2.14.0', msg: 'Release v2.14.0', tm: '1d' },
  { lane: 0, msg: "Merge branch 'search-v2'", tm: '1d' },
  { lane: 0, msg: 'Update dependencies', tm: '2d' },
  { lane: 2, c: 'working', ref: 'origin/search-v2', msg: 'Debounce search input', tm: '2d' },
  { lane: 2, c: 'working', msg: 'Add search API route', tm: '3d' },
  { lane: 0, msg: 'Tidy env loading', tm: '3d' },
  { lane: 0, msg: 'Menu page skeleton', tm: '4d' },
  { lane: 0, msg: 'Set up Next app', tm: '5d' },
  { lane: 3, c: 'purple', ref: 'origin/sticky-css', msg: 'Try CSS-only sticky header', tm: '5d' },
  { lane: 0, msg: 'Initial commit', tm: '6d' }
]
/** New commits that keep landing at the top of the git pane while the hero is on screen. */
export const NEW_COMMITS: GitRow[] = [
  { lane: 1, c: 'working', msg: 'Refresh session before expiry', tm: '刚刚' },
  { lane: 2, c: 'purple', msg: 'Lazy-load the coupon panel', tm: '刚刚' },
  { lane: 3, c: 'done', msg: 'Snapshot nav at three breakpoints', tm: '刚刚' },
  { lane: 1, c: 'working', msg: 'Rotate refresh token on use', tm: '刚刚' },
  { lane: 2, c: 'purple', msg: 'Inline critical checkout CSS', tm: '刚刚' },
  { lane: 4, c: 'term', msg: 'Preconnect to the image CDN', tm: '刚刚' }
]

/* ───────── 叫你: the overview regroups in three steps ───────── */
export const GROUPS: [Status, string][] = pick2<[Status, string][]>(
  [['needs_you', '等你处理'], ['error', '出错'], ['done_unread', '待审阅'], ['running', '运行中'], ['idle', '空闲']],
  [['needs_you', 'Needs you'], ['error', 'Error'], ['done_unread', 'To review'], ['running', 'Running'], ['idle', 'Idle']]
)
export const STATUS_TEXT: Record<Status, string> = pick2<Record<Status, string>>(
  { needs_you: '等你处理', error: '出错', done_unread: '已完成', running: '运行中', idle: '空闲' },
  { needs_you: 'Needs you', error: 'Error', done_unread: 'Done', running: 'Running', idle: 'Idle' }
)
export const OV: { id: string; t: string; d: string }[] = [
  { id: 'cookie', t: pick2('Cookie 会话迁移', 'Session cookie migration'), d: '+42 −18' },
  { id: 'checkout', t: pick2('结算页性能优化', 'Checkout performance'), d: '+128 −35' },
  { id: 'mobile', t: pick2('修复移动端导航抖动', 'Fix mobile nav jitter'), d: '+23 −9' },
  { id: 'agg', t: pick2('侧边栏状态聚合', 'Sidebar status rollup'), d: '+61 −4' },
  { id: 'lanes', t: pick2('Git 图谱布局算法', 'Git graph layout'), d: '+210 −12' },
  { id: 'webhook', t: pick2('支付回调重试', 'Payment webhook retries'), d: '+19 −2' },
  { id: 'vite', t: pick2('迁移到 Vite 7', 'Move to Vite 7'), d: '+40 −31' },
  { id: 'search', t: pick2('文档站搜索', 'Docs search'), d: '+88 −14' }
]
export interface OvState {
  status: Status
  su: string
  tm: string
}
const R = (status: Status, su: string, tm: string): OvState => ({ status, su, tm })
const step1: Record<string, OvState> = {
  cookie: R('running', pick2('编辑 prisma/schema.prisma', 'Editing prisma/schema.prisma'), '5m'),
  checkout: R('running', pick2('编辑 lib/price.ts', 'Editing lib/price.ts'), '13m'),
  mobile: R('done_unread', pick2('滚动时导航不再抖动', 'Nav no longer jitters on scroll'), pick2('刚刚', 'just now')),
  agg: R('running', pick2('编辑 src/state/agents.ts', 'Editing src/state/agents.ts'), '7m'),
  lanes: R('error', pick2('pnpm build 失败 · 2 个类型错误', 'pnpm build failed · 2 type errors'), pick2('1m 前', '1m ago')),
  webhook: R('running', pick2('运行 pnpm vitest webhook', 'Running pnpm vitest webhook'), '10m'),
  vite: R('idle', pick2('升级完成，测试全部通过', 'Upgraded, all tests pass'), pick2('20m 前', '20m ago')),
  search: R('done_unread', pick2('搜索索引改为增量构建', 'Search index builds incrementally'), pick2('5m 前', '5m ago'))
}
export const STEPS: { sub: string; rows: Record<string, OvState> }[] = [
  {
    sub: pick2('8 个会话 · 全部在运行', '8 sessions · all running'),
    rows: {
      cookie: R('running', pick2('编辑 src/middleware.ts', 'Editing src/middleware.ts'), '4m'),
      checkout: R('running', pick2('运行 pnpm test checkout', 'Running pnpm test checkout'), '12m'),
      mobile: R('running', pick2('读取 components/Nav.tsx', 'Reading components/Nav.tsx'), '2m'),
      agg: R('running', pick2('搜索 “needsAttention”', 'Searching “needsAttention”'), '6m'),
      lanes: R('running', pick2('编辑 src/shared/git-graph/lanes.ts', 'Editing src/shared/git-graph/lanes.ts'), '18m'),
      webhook: R('running', pick2('运行 pnpm vitest webhook', 'Running pnpm vitest webhook'), '9m'),
      vite: R('running', pick2('编辑 vite.config.ts', 'Editing vite.config.ts'), '3m'),
      search: R('running', pick2('读取 docs/search/index.ts', 'Reading docs/search/index.ts'), '7m')
    }
  },
  { sub: pick2('8 个会话 · 2 个待审阅 · 1 个出错', '8 sessions · 2 to review · 1 error'), rows: step1 },
  {
    sub: pick2('8 个会话 · 1 个等你处理', '8 sessions · 1 needs you'),
    rows: { ...step1, cookie: R('needs_you', pick2('等你确认：pnpm prisma migrate dev', 'Confirm: pnpm prisma migrate dev'), waited(60)) }
  }
]

/* ───────── 并排比: three attempts at one task ───────── */
/** One terminal line as coloured segments. Classes: d dim · w white · b green · r red · acc orange. */
export type Seg = [cls: string, text: string]
export interface OutLine {
  segs: Seg[]
  /** a check result that appears once this line has printed */
  check?: { ok: boolean; name: string }
}
export interface Attempt {
  who: string
  branch: string
  add: number
  del: number
  files: number
  lines: OutLine[]
  diff: string[]
}
const L = (...segs: Seg[]): OutLine => ({ segs })
const task = L(['d', '> '], ['w', pick2('把结算页首屏降到 2 秒以内', 'Get checkout’s first paint under 2s')])
export const ATTEMPTS: Attempt[] = [
  {
    who: 'Claude Code 1',
    branch: 'jacob/checkout-lcp-1',
    add: 42,
    del: 18,
    files: 4,
    lines: [
      task,
      L(),
      L(['b', '● '], ['w', 'Read'], ['', '(checkout/page.tsx)']),
      L(['d', pick2('  └ 读取 214 行', '  └ Read 214 lines')]),
      L(['b', '● '], ['w', 'Update'], ['', '(lib/price.ts)']),
      L(['d', pick2('  └ 总价改成缓存，首屏少了 3 个请求', '  └ Cached cart totals, 3 fewer requests')]),
      L(['b', '● '], ['w', 'Bash'], ['', '(pnpm test checkout)']),
      { segs: [['d', '  └ '], ['b', '38 passed']], check: { ok: true, name: 'pnpm test' } },
      { segs: [['b', '● '], ['w', 'Bash'], ['', '(pnpm tsc && pnpm lint)']], check: { ok: true, name: 'tsc' } },
      { segs: [['d', '  └ '], ['b', '0 errors']], check: { ok: true, name: 'lint' } },
      L(),
      L(['b', '● '], ['w', pick2('首屏 LCP 2.8s → 1.6s', 'First paint 2.8s → 1.6s')]),
      L(['d', pick2('  总价改成缓存，首屏少了 3 个请求。', '  Cached totals, 3 fewer requests on load.')])
    ],
    diff: [
      'hdr:lib/price.ts',
      'hdr:@@ -12,7 +12,10 @@',
      'del:- export const total = (items) =>',
      'del:-   items.reduce((s, i) => s + i.price * i.qty, 0)',
      'add:+ const cache = new WeakMap()',
      'add:+ export const total = (items) => {',
      'add:+   if (cache.has(items)) return cache.get(items)',
      'add:+   const t = items.reduce((s, i) => s + i.price * i.qty, 0)',
      'add:+   cache.set(items, t)',
      'add:+   return t',
      'add:+ }'
    ]
  },
  {
    who: 'Claude Code 2',
    branch: 'jacob/checkout-lcp-2',
    add: 65,
    del: 9,
    files: 6,
    lines: [
      task,
      L(),
      L(['b', '● '], ['w', 'Read'], ['', '(checkout/page.tsx)']),
      L(['d', pick2('  └ 读取 214 行', '  └ Read 214 lines')]),
      L(['b', '● '], ['w', 'Write'], ['', '(worker/price.ts)']),
      L(['d', pick2('  └ 价格计算挪进 Web Worker', '  └ Moved price math into a Web Worker')]),
      L(['b', '● '], ['w', 'Bash'], ['', '(pnpm test checkout)']),
      { segs: [['d', '  └ '], ['b', '38 passed']], check: { ok: true, name: 'pnpm test' } },
      L(['r', '● '], ['w', 'Bash'], ['', '(pnpm tsc --noEmit)']),
      { segs: [['d', '  └ '], ['r', '2 errors in worker/price.ts']], check: { ok: false, name: pick2('tsc · 2 个错误', 'tsc · 2 errors') } },
      { segs: [['d', '  └ lint '], ['b', 'ok']], check: { ok: true, name: 'lint' } },
      L(),
      L(['b', '● '], ['w', pick2('首屏 LCP 2.8s → 1.9s', 'First paint 2.8s → 1.9s')])
    ],
    diff: [
      'hdr:worker/price.ts',
      'hdr:@@ -0,0 +1,6 @@',
      'add:+ self.onmessage = (e: MessageEvent<Item[]>) => {',
      'add:+   const t = e.data.reduce((s, i) =>',
      'add:+     s + i.price * i.qty)',
      'add:+   postMessage(t)',
      'add:+ }',
      'hdr:checkout/page.tsx',
      'del:- const total = useMemo(() => sum(cart), [cart])',
      'add:+ const total = usePriceWorker(cart)'
    ]
  },
  {
    who: 'Codex',
    branch: 'jacob/checkout-lcp-3',
    add: 7,
    del: 11,
    files: 2,
    lines: [
      task,
      L(),
      L(['acc', '• '], ['w', 'Explored'], ['', ' checkout/']),
      L(['d', '  └ page.tsx, vite.config.ts']),
      L(['acc', '• '], ['w', 'Edited'], ['', ' vite.config.ts']),
      L(['d', pick2('  └ 按路由拆开结算页的 bundle', '  └ Split the checkout bundle by route')]),
      L(['acc', '• '], ['w', 'Ran'], ['', ' pnpm test checkout']),
      { segs: [['d', '  └ '], ['b', '38 passed']], check: { ok: true, name: 'pnpm test' } },
      L(['acc', '• '], ['w', 'Ran'], ['', ' pnpm tsc --noEmit']),
      { segs: [['d', '  └ '], ['b', 'no errors']], check: { ok: true, name: 'tsc' } },
      L(),
      L(['acc', '• '], ['w', pick2('首屏 LCP 2.8s → 2.1s', 'First paint 2.8s → 2.1s')]),
      L(['d', pick2('  拆开了结算页的 bundle。', '  Split the checkout bundle.')])
    ],
    diff: [
      'hdr:vite.config.ts',
      'hdr:@@ -8,6 +8,11 @@',
      'add:+   build: {',
      'add:+     rollupOptions: {',
      'add:+       output: {',
      "add:+         manualChunks: { checkout: ['./src/checkout'] }",
      'add:+       }',
      'add:+     }',
      'add:+   },'
    ]
  }
]
/** UI strings of the compare view. */
export const CMP = pick2(
  {
    stat: (a: number, d: number, f: number) => `+${a} −${d} · ${f} 个文件`,
    diff: '看 diff',
    hideDiff: '收起 diff',
    merge: '合并这个',
    merged: '已合并',
    archived: '已归档',
    done: (branch: string, n: number) => `已合并 ${branch} · 已归档其余 ${n} 份`
  },
  {
    stat: (a: number, d: number, f: number) => `+${a} −${d} · ${f} files`,
    diff: 'View diff',
    hideDiff: 'Hide diff',
    merge: 'Merge this',
    merged: 'Merged',
    archived: 'Archived',
    done: (branch: string, n: number) => `Merged ${branch} · archived the other ${n}`
  }
)

/* ───────── 合并: eight branches on main (Figma W8) ───────── */
export interface Lane {
  name: string
  note: string
  y: number
  parentY?: number
  from: number
  to?: number
  end?: number
  c: LaneColor
  commits: number[]
  open?: 'run' | 'wait' | 'fail'
}
export const GRAPH = {
  W: 1296,
  H: 480,
  YM: 380,
  D: 46,
  mainCommits: [40, 100, 190, 280, 440, 560, 760, 900],
  tags: [
    [640, 'v0.4.2'],
    [1150, 'v0.5.0']
  ] as [number, string][],
  /** conflict radar: sidebar-agg and checkout-perf touch the same file */
  clash: { x: 840, y1: 152, y2: 208, label: pick2('会冲突：app/layout.tsx', 'conflict: app/layout.tsx') },
  lanes: [
    { name: 'session-cookie', note: 'Claude Code', y: 40, from: 100, c: 'working', commits: [230, 330, 560, 860, 1120], open: 'run' },
    { name: 'cookie-tests', note: pick2('已做完', 'done'), y: 96, parentY: 40, from: 380, to: 720, c: 'done', commits: [480, 600] },
    { name: 'checkout-perf', note: 'Codex', y: 152, from: 190, to: 1150, c: 'purple', commits: [320, 520, 760, 980] },
    { name: 'sidebar-agg', note: pick2('等你审阅', 'needs review'), y: 208, from: 440, end: 1010, c: 'attention', commits: [600, 820], open: 'wait' },
    { name: 'mobile-nav', note: pick2('已合并', 'merged'), y: 264, from: 280, to: 640, c: 'done', commits: [400, 520] },
    { name: 'graph-layout', note: pick2('构建失败', 'build failed'), y: 264, from: 760, end: 1040, c: 'error', commits: [880], open: 'fail' },
    { name: 'i18n-copy', note: 'Codex', y: 320, from: 900, c: 'working', commits: [1040, 1180], open: 'run' },
    { name: 'docs-roadmap', note: pick2('已合并', 'merged'), y: 446, from: 560, to: 1080, c: 'done', commits: [700, 900] }
  ] as Lane[],
  /** playhead x at which each of the six steps lights up */
  stepAt: [100, 300, 700, 900, 1080, 1220]
}

/* ───────── Poster, boot, tube ───────── */
export const RELEASE = { version: 'v0.5.0', commit: '4cd4149b' }
export const BOOT = pick2(
  [
    '<b>WAVI TERMINAL</b>  v0.5.0',
    '› 连接 10 个会话 ············ <span class="ok">ok</span>',
    '› 每个 agent 一条分支 ········ <span class="ok">ok</span>',
    '› 在等你的：<span class="acc">10</span>'
  ],
  [
    '<b>WAVI TERMINAL</b>  v0.5.0',
    '› attaching 10 sessions ········ <span class="ok">ok</span>',
    '› one branch per agent ········· <span class="ok">ok</span>',
    '› waiting on you: <span class="acc">10</span>'
  ]
)
/** What the TV shows once every "?" has been answered. */
export const ALL_RUNNING = pick2({ text: '全部在跑', font: '900 100px "Wavi Hei", "PingFang SC", sans-serif' }, { text: 'ALL RUNNING', font: '900 100px "Wavi Archivo", Archivo, sans-serif' })
