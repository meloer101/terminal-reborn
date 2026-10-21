/* Page copy in both languages. English is the default (served at "/"); Chinese lives at "/zh/".
   Text inside the live product replicas (sidebar, overview, compare panes, graph) is in scripts/data.ts. */

export type Lang = 'en' | 'zh'

const en = {
  htmlLang: 'en',
  meta: {
    title: 'Wavi — One person, many threads',
    description: 'Wavi is a macOS coding terminal for people who run several Claude Code and Codex agents at once: each agent works on its own branch, and Wavi only calls you when one needs you. Free, open source, no telemetry.'
  },
  skip: 'Skip to content',
  nav: {
    home: 'Wavi home',
    status: 'Status',
    compare: 'Compare',
    merge: 'Merge',
    github: 'GitHub',
    download: 'Download',
    other: '中文',
    otherLabel: '切换到中文',
    navLabel: 'Main'
  },
  hero: {
    crt: 'A row of ten question marks flickering like an old TV: ten agents waiting on you. Click one, or press J, to answer it.',
    title: 'One person, many threads.',
    sub: 'A coding terminal for multithreaders and ADHD brains. Enjoy it.',
    download: 'Download for macOS',
    github: 'GitHub ↗',
    app: { open: 'Open project…', jump: 'Jump to…', overview: 'Overview', settings: 'Settings', graph: 'Graph', changes: 'Changes 3', branches: 'All branches ⌄' }
  },
  status: {
    label: 'Overview: eight sessions grouped by status; only one is waiting on you.',
    title: 'Overview',
    sub: '8 sessions · all running',
    list: 'List',
    board: 'Board',
    steps: ['All running.', 'Some done, one stuck.', 'One needs you.'],
    h2: 'Who’s <em>waiting</em>?<br />You’ll know at a glance.',
    body: 'Running, done, stuck: each looks different. Only the one waiting on you lights up. Press <kbd>⌘J</kbd> to jump there, answer it, and it keeps going.',
    notifTitle: 'acme-web · Session cookie migration',
    notifBody: 'Confirm: pnpm prisma migrate dev',
    notifTime: 'now'
  },
  compare: {
    h2: 'One task,<br />several answers.',
    lead: 'Hand the same task to several agents at once, Claude Code and Codex mixed. When they finish, line them up: how much changed, whether the tests passed. Merge the best one and archive the rest in one click.',
    label: 'Compare view: three attempts at the same task side by side, each with its diff size and check results.',
    head: 'Compare',
    task: 'Get checkout’s first paint under 2s',
    base: 'based on main · 3 attempts'
  },
  merge: {
    label: 'Git graph: eight branches off main, one agent each. Some are running, some are done and merged, one is waiting for review, one failed to build.',
    steps: [
      ['Start', '⌘N', 'Pick a project, hit Return, and an agent gets to work.'],
      ['Work in parallel', '', 'Each agent gets its own worktree. Nobody steps on anybody.'],
      ['Spot conflicts early', '', 'Two agents touching the same code? You hear about it first.'],
      ['Review', '', 'Read the diff, or have an agent review it first.'],
      ['Merge', '⇧⌘M', 'A trial merge first. No conflicts, straight into main.'],
      ['Wrap up', '', 'The worktree goes, the branch stays.']
    ] as [string, string, string][]
  },
  flow: {
    label: 'Branch out. Merge in.',
    lines: ['BRANCH OUT.', 'MERGE IN.'],
    six: [
      ['Custom looks', 'Make your workspace a pleasure to look at.'],
      ['Auto review', 'Quietly guards every merge while you’re deep in the work.'],
      ['Visual PRs', 'Keeps your head clear across a dozen threads.'],
      ['Auto resume', 'When your quota resets, stalled agents pick up where they left off.'],
      ['Visible conflicts', 'Two agents touching the same code? You’ll know before you merge.'],
      ['Auto checks', 'Every turn, it remembers which tests ran and whether they passed.']
    ] as [string, string][],
    advisory: 'Agent advisory: no telemetry'
  },
  poster: {
    heading: 'Download Wavi',
    mirror: ['BRANCH OUT · MERGE IN', 'NO ACCOUNT · NO TELEMETRY', 'HANDS OFF YOUR CONFIG', 'AGENTS RUN AFTER ⌘Q'],
    download: 'Download for macOS',
    github: 'GitHub ↗',
    advisory: 'Agent advisory: unattended'
  },
  footer: { label: 'Footer', github: 'GitHub', releases: 'Releases', roadmap: 'Roadmap', license: 'MIT License' }
}

type Copy = typeof en

const zh: Copy = {
  htmlLang: 'zh-CN',
  meta: {
    title: 'Wavi — 一个人，多线程',
    description: 'Wavi 是给同时跑好几个 Claude Code 和 Codex 的开发者做的 macOS 终端：每个 agent 一条分支，只在需要你时叫你。免费、开源、无遥测。'
  },
  skip: '跳到正文',
  nav: {
    home: 'Wavi 首页',
    status: '状态总览',
    compare: '方案对比',
    merge: '分支合并',
    github: 'GitHub',
    download: '下载',
    other: 'EN',
    otherLabel: 'Switch to English',
    navLabel: '主导航'
  },
  hero: {
    crt: '一排十个问号，像旧电视的信号一样闪烁：十个在等你的 agent。点一下或按 J，回答一个。',
    title: '一个人，多线程。',
    sub: '专为多线程、ADHD 选手打造的 coding terminal，enjoy it。',
    download: '下载 macOS 版',
    github: 'GitHub ↗',
    app: { open: '打开项目…', jump: '跳转到…', overview: '总览', settings: '设置', graph: '图谱', changes: '变更 3', branches: '全部分支 ⌄' }
  },
  status: {
    label: '总览：八个会话按状态分组，只有一个在等你处理。',
    title: '总览',
    sub: '8 个会话 · 全部在运行',
    list: '列表',
    board: '看板',
    steps: ['都在跑。', '有的做完，有的卡住。', '一个在等你。'],
    h2: '谁在<em>等你</em>，<br />一眼就知道。',
    body: '跑着的、做完的、卡住的，各有各的样子。只有在等你的那一个会亮起来。按 <kbd>⌘J</kbd> 跳过去，答完它接着跑。',
    notifTitle: 'acme-web · Cookie 会话迁移',
    notifBody: '等你确认：pnpm prisma migrate dev',
    notifTime: '现在'
  },
  compare: {
    h2: '一个问题，<br />几份答案。',
    lead: '把同一个任务同时交给几个 agent，Claude Code 和 Codex 可以混着用。做完后并排摆开：改了多少、测试过没过，一眼比完，合并最好的那一份，其余的一键归档。',
    label: '比较浮层：同一个任务的三份结果并排，每份写着改动大小和检查结果。',
    head: '比较',
    task: '把结算页首屏降到 2 秒以内',
    base: '基于 main · 3 份'
  },
  merge: {
    label: 'git 图谱：main 之上八条分支，每条由一个 agent 负责，有的在跑、有的做完合并、一条在等你审阅、一条构建失败。',
    steps: [
      ['开工', '⌘N', '选好项目，回车，一个 agent 就开工了。'],
      ['各干各的', '', '每个 agent 一个 worktree，谁也不碰谁。'],
      ['提前看到冲突', '', '两个 agent 改到同一处，先告诉你。'],
      ['审阅', '', '看 diff，或者让 agent 先自己审一遍。'],
      ['合并', '⇧⌘M', '先试合并，没冲突就合进主干。'],
      ['收尾', '', 'worktree 删掉，分支留着。']
    ]
  },
  flow: {
    label: '从开工到合进主干',
    lines: ['从开工', '到合进主干'],
    six: [
      ['定制化外观', '让你的开发工作台更赏心悦目'],
      ['自动化审阅', '在高强度开发中替你默默把关'],
      ['可视化 PR', '在多线程开发中让你的思路更加清晰'],
      ['自动化续跑', '额度一恢复，停下的 agent 自己接着干'],
      ['可视化冲突', '两个 agent 改到同一处，合并前就提醒你'],
      ['自动化检查', '每一轮测试跑没跑、过没过，替你记得清清楚楚']
    ],
    advisory: 'Agent advisory: no telemetry'
  },
  poster: {
    heading: '下载 Wavi',
    mirror: ['从开工到合进主干', '没有账号，没有遥测', '不碰你的全局配置', '关掉窗口，agent 照跑'],
    download: '下载 macOS 版',
    github: 'GitHub ↗',
    advisory: 'Agent advisory: unattended'
  },
  footer: { label: '页脚', github: 'GitHub', releases: '版本记录', roadmap: '路线图', license: 'MIT 许可' }
}

export const copy: Record<Lang, Copy> = { en, zh }

/** Path of the same page in the other language, relative to the site base. */
export const otherPath = (lang: Lang): string => (lang === 'en' ? 'zh/' : '')
