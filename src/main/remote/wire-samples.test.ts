// Sample messages of the phone protocol (PRD F22, src/shared/remote.ts), for the iPhone app's Swift types to check
// themselves against (ios/WaviTests/WireTests.swift): every command the phone sends, every event the Mac pushes and every
// answer the phone decodes, each typed with the Mac's own types so a change on the Mac changes this file, and a field the
// Swift side no longer reads fails there. The maps are exhaustive by type: a new command or event without a sample does
// not compile. `WAVI_WRITE_WIRE=1 npx vitest run src/main/remote/wire-samples.test.ts` writes the file after a deliberate
// change.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CliAgent } from '@shared/agents'
import { parsePhoneRequest, type PhoneCommand, type PhoneEvent, type RemoteAgentModels, type RemoteExits, type RemotePrompt, type RemoteSession, type RemoteSessionList, type RemoteShipAction } from '@shared/remote'
import type { ChatItem } from '@shared/transcript-chat'
import type { changes, fileDiff } from '../git-graph'
import type { newSessionInfo } from '../worktree-create'
import type { FeedHub } from './feed'

const FILE = join(__dirname, '../../shared/remote-wire-samples.json')

type Commands = { [K in PhoneCommand['type']]: Extract<PhoneCommand, { type: K }> }
// `RemoteShipAction & { do: K }`, not Extract: submit / retry / … share one member whose `do` is a union.
type ShipActions = { [K in RemoteShipAction['do']]: RemoteShipAction & { do: K } }
type Events = { [K in PhoneEvent['event']]: Extract<PhoneEvent, { event: K }> }

/** The `data` of each answer the phone decodes, as main (src/main/remote/index.ts) and the window (src/renderer/remote) build it. */
interface Results {
  snapshot: RemoteSessionList & { prompts: RemotePrompt[] }
  /** FeedHub.page; its items have been through forPhone (a tool's `input` stays on the Mac). */
  watch: NonNullable<Awaited<ReturnType<FeedHub['page']>>>
  feed: NonNullable<Awaited<ReturnType<FeedHub['page']>>>
  /** The whole NewSessionInfo goes to the phone as main reads it. */
  'new-session-info': { info: Awaited<ReturnType<typeof newSessionInfo>>; agents: CliAgent[] }
  'agent-models': RemoteAgentModels
  'new-session': { session: string }
  changes: NonNullable<Awaited<ReturnType<typeof changes>>>
  diff: { text: Awaited<ReturnType<typeof fileDiff>> }
  exits: RemoteExits
}

const PHOTO = Buffer.from('not really a jpeg').toString('base64')

const shipActions: ShipActions = {
  start: { do: 'start', exit: 'push-pr' },
  edit: { do: 'edit', texts: { commit: 'fix: login', title: 'Fix login', body: 'Body', draft: true } },
  submit: { do: 'submit' },
  retry: { do: 'retry' },
  cancel: { do: 'cancel' },
  conflicts: { do: 'conflicts' },
  'switch-pr': { do: 'switch-pr' }
}

const commands: Commands = {
  snapshot: { type: 'snapshot' },
  watch: { type: 'watch', session: 's1' },
  feed: { type: 'feed', session: 's1', before: 120 },
  send: { type: 'send', session: 's1', text: '看看这个 bug', photos: [{ name: 'IMG_0001.HEIC', data: PHOTO }] },
  interrupt: { type: 'interrupt', session: 's1' },
  permission: { type: 'permission', prompt: 'p1', decision: 'allow-always' },
  answer: { type: 'answer', prompt: 'p2', answers: { 用哪个数据库: 'Postgres' } },
  'new-session-info': { type: 'new-session-info', project: 'proj1' },
  'agent-models': { type: 'agent-models', agent: 'codex' },
  'new-session': { type: 'new-session', project: 'proj1', workdir: 'worktree', agent: 'claude', base: 'main', branch: 'jacoy/fix-login', prompt: '修好登录', model: 'claude-opus-5-5' },
  changes: { type: 'changes', session: 's1' },
  diff: { type: 'diff', session: 's1', path: 'src/new.ts', scope: 'uncommitted', oldPath: 'src/old.ts', untracked: true },
  exits: { type: 'exits', session: 's1' },
  ship: { type: 'ship', session: 's1', action: shipActions.edit },
  archive: { type: 'archive', session: 's1' },
  'set-setting': { type: 'set-setting', session: 's1', kind: 'effort', value: 'high' }
}

const session: RemoteSession = {
  id: 's1',
  projectId: 'proj1',
  title: '修好登录',
  agent: 'claude',
  status: 'needs_you',
  action: '等你允许 Bash',
  since: 1_730_000_000_000,
  activity: 1_730_000_100_000,
  branch: 'jacoy/fix-login',
  model: 'Opus 5.5',
  reply: '登录已经修好了。',
  ship: {
    kind: 'pr',
    title: '创建 PR',
    agent: 'Claude',
    stage: 'running',
    steps: [
      { id: 'commit', label: '提交', state: 'done', note: 'a41c9e2' },
      { id: 'push', label: '推送', state: 'failed' }
    ],
    texts: { commit: 'fix: login', title: 'Fix login', body: 'Body', draft: false },
    fields: ['commit', 'title', 'body', 'draft'],
    submitLabel: '创建 PR',
    submitBlocker: '先填标题',
    error: { step: 'push', message: '推送被拒绝', output: 'rejected', conflicts: false, pushRefused: true }
  },
  shipNotice: '已合并到 main 并推送 · a41c9e2',
  settings: {
    items: [
      { kind: 'model', current: 'opus', values: [{ value: 'opus', label: 'Opus 5.5' }, { value: 'sonnet', label: 'Sonnet 5' }] },
      { kind: 'effort', current: 'high', values: [{ value: 'high', label: '高' }] },
      { kind: 'permission', current: 'default', values: [{ value: 'default', label: '每次询问' }] }
    ],
    locked: 'running',
    readOnly: true
  }
}

const sessions: RemoteSessionList = {
  projects: [{ id: 'proj1', name: 'wavi' }],
  sessions: [session, { id: 's2', projectId: 'proj1', title: '终端', agent: 'shell', status: 'idle', activity: 1_730_000_200_000 }]
}

const prompts: RemotePrompt[] = [
  {
    kind: 'permission',
    id: 'p1',
    sessionId: 's1',
    tool: 'Bash',
    input: { command: 'pnpm test', timeout: 60_000, nested: { list: [1, 'two', null, true] } },
    summary: '运行 pnpm test',
    canAllowAlways: true,
    allowAlways: { scope: 'project', rules: [{ tool: 'Bash', content: 'pnpm test:*' }, { tool: 'WebFetch' }], directories: ['/Users/me/code/wavi/packages'] },
    createdAt: 1_730_000_000_000,
    answerable: true
  },
  {
    kind: 'question',
    id: 'p2',
    sessionId: 's1',
    questions: [
      {
        header: '数据库',
        question: '用哪个数据库',
        multiSelect: false,
        options: [{ label: 'Postgres', description: '已经装好了' }, { label: 'SQLite' }]
      },
      { question: '要哪些检查', multiSelect: true, options: [{ label: 'lint' }, { label: 'test' }] }
    ],
    createdAt: 1_730_000_000_500,
    answerable: false
  }
]

/** Every kind of item, the tool ones with every field main sends (`input` excepted: forPhone strips it). */
const items: ChatItem[] = [
  { kind: 'user', id: 'u1', at: 1_730_000_000_000, text: '修好登录', images: 2 },
  { kind: 'thinking', id: 'k1', at: 1_730_000_000_100, text: '先看看 auth.ts', ms: 1500, parent: 't0' },
  { kind: 'text', id: 'x1', at: 1_730_000_000_200, text: '我来看看。', parent: 't0' },
  {
    kind: 'tool',
    id: 't1',
    at: 1_730_000_000_300,
    parent: 't0',
    name: 'Edit',
    arg: 'src/auth.ts',
    state: 'ok',
    output: 'The file has been updated.',
    exit: 0,
    diff: { path: 'src/auth.ts', hunks: [{ oldStart: 10, newStart: 10, lines: [' a', '-b', '+c'] }], added: 1, removed: 1, truncated: false },
    files: [
      { path: 'src/auth.ts', hunks: [{ oldStart: 10, newStart: 10, lines: [' a', '-b', '+c'] }], added: 1, removed: 1, truncated: false },
      { path: 'src/login.ts', hunks: [], added: 0, removed: 0, truncated: true }
    ],
    todos: [
      { text: '读代码', status: 'completed' },
      { text: '改代码', status: 'in_progress' }
    ],
    ms: 2400
  },
  { kind: 'tool', id: 't2', at: 1_730_000_000_400, name: 'Bash', arg: 'pnpm test', state: 'error', output: 'FAIL' },
  { kind: 'system', id: 'y1', at: 1_730_000_000_500, text: '上下文已压缩' },
  { kind: 'unknown', id: 'n1', at: 1_730_000_000_600, type: 'brand-new-line' }
]

const events: Events = {
  hello: { event: 'hello', data: { name: 'MacBook Pro', version: '1.2.3', protocol: 1, urls: ['ws://100.64.0.2:7429', 'ws://192.168.1.5:7429'] } },
  sessions: { event: 'sessions', data: sessions },
  prompts: { event: 'prompts', data: prompts },
  feed: { event: 'feed', data: { session: 's1', items, start: 40, reset: true } }
}

const results: Results = {
  snapshot: { ...sessions, prompts },
  watch: { items, start: 40, total: 47 },
  feed: { items, start: 0, total: 47 },
  'new-session-info': {
    info: {
      repo: true,
      currentBranch: 'main',
      defaultBranch: 'main',
      branches: [
        { name: 'main', remote: false, worktreePath: '/Users/me/code/wavi', inMainCheckout: true },
        { name: 'origin/feat/x', remote: true, worktreePath: null, inMainCheckout: false }
      ],
      prefix: 'jacoy',
      worktreesDir: '/Users/me/.tr/worktrees/wavi',
      takenFolders: ['fix-login'],
      includeFiles: ['.env.local'],
      includeCount: 1,
      hasSetup: true
    },
    agents: ['claude', 'codex']
  },
  'agent-models': { gui: true, models: [{ value: 'gpt-5.5', label: 'GPT-5.5' }, { value: 'gpt-5.5-mini', label: 'GPT-5.5 mini' }], current: 'gpt-5.5' },
  'new-session': { session: 's3' },
  changes: {
    branch: 'jacoy/fix-login',
    base: 'main',
    baseRef: 'refs/heads/main',
    ahead: 2,
    behind: 1,
    uncommitted: [
      { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'R', added: 3, removed: 1 },
      { path: 'vendor/lib', status: 'A', added: null, removed: null, untracked: true, nested: true },
      { path: 'big.bin', status: 'A', added: null, removed: null, untracked: true, tooLarge: true }
    ],
    untrackedOmitted: 4,
    committed: [{ path: 'src/auth.ts', status: 'M', added: 10, removed: 2 }]
  },
  diff: { text: 'diff --git a/src/new.ts b/src/new.ts\n@@ -1 +1 @@\n-a\n+b\n' },
  exits: {
    primary: { kind: 'push-pr', label: '推送并创建 PR', blocker: '有未提交的改动' },
    secondary: { kind: 'open-pr', label: '打开 PR #12', blocker: '正在读取 PR…', url: 'https://github.com/o/r/pull/12' },
    pr: { number: 12, state: 'OPEN', url: 'https://github.com/o/r/pull/12' },
    base: 'main',
    baseProtected: true,
    archive: { blocker: '还有未推送的提交' }
  }
}

function compute() {
  return {
    note: 'Generated by src/main/remote/wire-samples.test.ts from the Mac protocol types (src/shared/remote.ts). Checked by ios/WaviTests/WireTests.swift.',
    commands,
    shipActions,
    events,
    results
  }
}

describe('phone protocol samples', () => {
  it('src/shared/remote-wire-samples.json is what the Mac types say', () => {
    const now = JSON.stringify(compute(), null, 2) + '\n'
    if (process.env.WAVI_WRITE_WIRE === '1') writeFileSync(FILE, now)
    expect(readFileSync(FILE, 'utf8')).toBe(now)
  })

  it('every command sample passes main validation unchanged', () => {
    for (const command of Object.values(commands)) {
      expect(parsePhoneRequest({ ...command, id: 7 }), command.type).toEqual({ ...command, id: 7 })
    }
    for (const action of Object.values(shipActions)) {
      expect(parsePhoneRequest({ id: 7, type: 'ship', session: 's1', action }), action.do).toEqual({ id: 7, type: 'ship', session: 's1', action })
    }
  })
})
