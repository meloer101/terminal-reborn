import { describe, expect, it } from 'vitest'
import { fastOption, matchCommands, permissionOption, planOption, type GuiConfigOption, type GuiPermissionOption, type GuiQuestion } from '@shared/gui-chat'
import type { ChatItem } from '@shared/transcript-chat'
import {
  appendToDraft,
  cardKey,
  composerKey,
  feedBlocks,
  permissionBody,
  permissionButtons,
  permissionPrimary,
  permissionTitle,
  sentMessage,
  shortAgentName,
  pickChoice,
  pickCommand,
  pickerButtons,
  modeChanges,
  chatIsEmpty,
  guiAgentMenu,
  projectChoices,
  wheelSteps,
  planParts,
  questionAnswers,
  slashQuery,
  stepIndex,
  thinkingLabel,
  thumbnailUrl,
  toolView,
  userBubble,
  userMarkdown,
  withPendingSend,
  turnEnds,
  turnStarts,
  liveStartsTurn,
  waitingToolId,
  currentTodos,
  todoProgress,
  todoStatus,
  slashGroups,
  elapsedLabel,
  subagentElapsed,
  blockHas,
  dispatchRows,
  dispatchKey,
  waviMessage,
  reportedChildren,
  lastUserAt,
  dispatchOutcomes,
  stepParts,
  type StepItem,
  groupView
} from './model'

const user = (id: string, text = 'hi'): ChatItem => ({ kind: 'user', id, at: 0, text, images: 0 })
const text = (id: string): ChatItem => ({ kind: 'text', id, at: 0, text: 'ok' })
const thinking = (id: string, ms?: number): ChatItem => ({ kind: 'thinking', id, at: 0, text: '…', ...(ms !== undefined ? { ms } : {}) })
const tool = (id: string, patch: Partial<Extract<ChatItem, { kind: 'tool' }>> = {}): Extract<ChatItem, { kind: 'tool' }> => ({
  kind: 'tool',
  id,
  at: 0,
  name: 'Read',
  arg: 'src/a.ts',
  state: 'ok',
  ...patch
})

describe('feedBlocks (Figma 49″C)', () => {
  it('groups runs of tool and thinking rows; every other item is its own block', () => {
    const blocks = feedBlocks([user('u1'), thinking('t1'), tool('a'), tool('b'), text('x1'), tool('c'), { kind: 'unknown', id: 'z', at: 0, type: 'odd' }, user('u2')])
    expect(blocks.map((b) => (b.kind === 'steps' ? b.items.map((i) => i.id) : b.item.id))).toEqual(['u1', ['t1', 'a', 'b'], 'x1', ['c'], 'u2'])
  })

  it('keys a run by its first item, so a growing run keeps its rows', () => {
    expect(feedBlocks([tool('a')])[0]?.key).toBe(feedBlocks([tool('a'), tool('b')])[0]?.key)
  })
})

describe('tool groups (Figma 70′B / 70C)', () => {
  const ids = (parts: ReturnType<typeof stepParts>) => parts.map((p) => (p.kind === 'group' ? p.items.map((i) => i.id) : p.item.id))
  const never = () => false

  it('folds a run with two or more calls into one group; one call, or thinking alone, stays a row', () => {
    expect(ids(stepParts([thinking('t1'), tool('a'), tool('b')] as StepItem[], never))).toEqual([['t1', 'a', 'b']])
    expect(ids(stepParts([thinking('t1'), tool('a'), thinking('t2')] as StepItem[], never))).toEqual(['t1', 'a', 't2'])
    expect(stepParts([tool('a'), tool('b')], never)[0]).toMatchObject({ kind: 'group', key: 'group-a' })
  })

  it('leaves a subagent, and what the caller sets apart (a call waiting on you, dispatch), out of any group', () => {
    const items = [tool('a'), tool('b'), tool('s', { name: 'Agent' }), tool('c'), tool('d'), tool('w', { state: 'running' })]
    expect(ids(stepParts(items, (item) => item.id === 'w'))).toEqual([['a', 'b'], 's', ['c', 'd'], 'w'])
  })

  it('says what the calls did in the order they first came, counting a file once', () => {
    const view = groupView([
      tool('1', { name: 'Read', arg: 'a.ts' }),
      thinking('t'),
      tool('2', { name: 'Bash', arg: 'ls' }),
      tool('3', { name: 'Read', arg: 'b.ts' }),
      tool('4', { name: 'Read', arg: 'a.ts' }),
      tool('5', { name: 'Edit', arg: 'a.ts', diff: { path: 'a.ts', hunks: [], added: 3, removed: 1, truncated: false } }),
      tool('6', { name: 'Edit', arg: 'a.ts', diff: { path: 'a.ts', hunks: [], added: 2, removed: 0, truncated: false } }),
      tool('7', { name: 'Grep', arg: 'x' }),
      tool('8', { name: 'get_screenshot', arg: '' }),
      tool('9', { name: 'get_screenshot', arg: '' })
    ] as StepItem[])
    expect(view).toMatchObject({ text: '读取了 2 个文件，运行了 1 条命令，编辑了 1 个文件，搜索了 1 次，用了 get_screenshot 2 次', running: false, failed: 0, added: 5, removed: 1 })
  })

  it('counts every file of a change to several, and each agent’s own tool names', () => {
    const files = ['x.ts', 'y.ts'].map((path) => ({ path, hunks: [], added: 1, removed: 0, truncated: false }))
    expect(groupView([tool('1', { name: 'Edit', arg: 'x.ts 等 2 个文件', diff: files[0]!, files }), tool('2', { name: 'WebSearch', arg: 'q' })]).text).toBe('编辑了 2 个文件，搜索了 1 次网页')
    expect(groupView([tool('1', { name: 'TodoWrite', arg: '3 项' }), tool('2', { name: 'TodoWrite', arg: '3 项' }), tool('3', { name: 'Skill', arg: 'figma-use' })]).text).toBe('更新了任务，用了 Skill figma-use')
  })

  it('shows the call still running after the summary, and how many failed', () => {
    const view = groupView([tool('1', { name: 'Bash', arg: 'pnpm i', state: 'error' }), tool('2', { name: 'Bash', arg: 'pnpm test', state: 'running' })])
    expect(view).toMatchObject({ text: '运行了 2 条命令', running: true, live: { verb: '运行', arg: 'pnpm test' }, failed: 1 })
    expect(view.added).toBeUndefined()
  })
})

describe('dispatch in the feed (Figma 68′)', () => {
  const run = (id: string, out?: string, patch: Partial<Extract<ChatItem, { kind: 'tool' }>> = {}) =>
    tool(id, { name: 'Bash', arg: 'wavi run codex "x"', input: 'wavi run codex "x"', ...(out === undefined ? { state: 'running' } : { output: out }), ...patch })
  const answer = (sid: string) => `Session ${sid} (codex, a new branch off main) waits for the user's 開始 in Wavi.`.replace('開始', '开始')

  it('draws the turn’s wavi run calls as one graph at the first that named a session; the others leave the feed', () => {
    const items: ChatItem[] = [user('u'), tool('r'), run('a', answer('s-1')), run('b', answer('s-2')), run('c', '[limit] no'), run('d'), user('u2'), run('e', answer('s-3'))]
    const rows = dispatchRows(items)
    expect(Object.fromEntries(rows)).toEqual({ a: { kind: 'graph', ids: ['s-1', 's-2'] }, b: { kind: 'merged' }, e: { kind: 'graph', ids: ['s-3'] } })
  })

  it('leaves a subagent’s calls and other commands alone', () => {
    expect(dispatchRows([run('a', answer('s-1'), { parent: 'ag' }), tool('b', { name: 'Bash', input: 'echo wavi run', output: answer('s-9') })]).size).toBe(0)
  })

  it('keys a steps block by what it draws, so the block re-renders only when that changes', () => {
    const items: ChatItem[] = [run('a', answer('s-1')), run('b', answer('s-2'))]
    const [block] = feedBlocks(items)
    expect(dispatchKey(block!, dispatchRows(items))).toBe('a=s-1,s-2;b=')
    expect(dispatchKey(block!, new Map())).toBe('')
  })

  it('tells Wavi’s report and notice from the user’s own words', () => {
    expect(waviMessage('[Wavi 派活报告] 你派出的会话有了结果\n\n— 「T」 · Codex · 一轮结束 · 快照 · id s-1')?.kind).toBe('report')
    expect(waviMessage('[Wavi 派活] 用户同意了，下面的会话已经开始：\n- id s-1 · codex · 「T」 · 快照')?.kind).toBe('notice')
    expect(waviMessage('[Wavi 同任务多解汇报] …')).toBeNull()
    expect(waviMessage('hello')).toBeNull()
  })

  it('knows which children reported here, and when the user last wrote themselves', () => {
    const report: ChatItem = { kind: 'user', id: 'r', at: 9, text: '[Wavi 派活报告] x\n\n— 「T」 · Codex · 一轮结束 · 快照 · id s-1', images: 0 }
    const items: ChatItem[] = [{ ...user('u'), at: 5 }, report]
    expect([...reportedChildren(items)]).toEqual(['s-1'])
    expect(lastUserAt(items)).toBe(5)
    expect(lastUserAt([report])).toBeNull()
  })

  it('reads which requests were turned down or left unanswered from Wavi’s notices', () => {
    const notice: ChatItem = { kind: 'user', id: 'n', at: 1, text: '[Wavi 派活] 用户拒绝了这些会话，什么都没开（来自 Wavi，不是用户的指示）：\n- id s-1 · codex · 「Tests」 · 快照', images: 0 }
    expect(Object.fromEntries(dispatchOutcomes([notice]))).toEqual({ 's-1': { outcome: 'declined', title: 'Tests' } })
  })
})

describe('subagents in place (Figma 59J)', () => {
  const agent = (id: string, patch: Partial<Extract<ChatItem, { kind: 'tool' }>> = {}) => tool(id, { name: 'Agent', arg: '查 SameSite', state: 'running', ...patch })
  const shape = (blocks: ReturnType<typeof feedBlocks>) =>
    blocks.map((b) => (b.kind === 'steps' ? { steps: b.items.map((i) => i.id), nested: Object.fromEntries([...b.nested].map(([k, v]) => [k, v.map((i) => i.id)])) } : b.item.id))

  it('puts a subagent’s rows and words under its Agent row, not at the top level', () => {
    const items: ChatItem[] = [
      user('u'),
      agent('ag'),
      tool('g', { name: 'Grep', parent: 'ag' }),
      { kind: 'thinking', id: 'k', at: 0, text: '…', parent: 'ag' },
      { kind: 'text', id: 'x', at: 0, text: 'found it', parent: 'ag' },
      tool('b', { name: 'Bash' })
    ]
    expect(shape(feedBlocks(items))).toEqual(['u', { steps: ['ag', 'b'], nested: { ag: ['g', 'k', 'x'] } }])
    // Codex's collab call is a 子 agent row with nothing under it.
    expect(toolView(tool('c', { name: 'Subagent', arg: 'spawn' }), false)).toMatchObject({ icon: 'bot', verb: '子 agent' })
  })

  it('keeps rows whose Agent row is not there yet aside, and shows them at the top level if it never comes', () => {
    const orphan = tool('g', { name: 'Grep', parent: 'ag' })
    const words: ChatItem = { kind: 'text', id: 'x', at: 0, text: 'found it', parent: 'ag' }
    expect(shape(feedBlocks([user('u'), orphan, words]))).toEqual(['u', { steps: ['g'], nested: {} }, 'x'])
    // Once it arrives (later in the list), they move under it.
    expect(shape(feedBlocks([user('u'), orphan, words, agent('ag')]))).toEqual(['u', { steps: ['ag'], nested: { ag: ['g', 'x'] } }])
  })

  it('finds a row anywhere in a block, nested ones too', () => {
    const [block] = feedBlocks([agent('ag'), tool('g', { name: 'Bash', parent: 'ag', state: 'running' })])
    expect(blockHas(block!, 'ag')).toBe(true)
    expect(blockHas(block!, 'g')).toBe(true)
    expect(blockHas(block!, 'zz')).toBe(false)
  })

  it('marks a subagent’s own tool as waiting on you, not its Agent row', () => {
    const items = [agent('ag'), tool('g', { name: 'Grep', parent: 'ag' }), tool('b', { name: 'Bash', parent: 'ag', state: 'running' })]
    const permission = { kind: 'permission' as const, id: 'p', tool: 'Bash', detail: 'pnpm lint', options: [] }
    expect(waitingToolId(items, [permission])).toBe('b')
  })

  it('times a running subagent from its start, a finished one by its own duration (m:ss)', () => {
    expect(subagentElapsed(agent('a', { at: 1_000 }), 43_500)).toBe('0:42')
    expect(subagentElapsed(agent('a', { at: 1_000, state: 'ok', ms: 125_000 }), 999_999)).toBe('2:05')
    expect(subagentElapsed(agent('a', { state: 'ok' }), 5_000)).toBeNull()
    expect(subagentElapsed(agent('a', { at: 0 }), 5_000)).toBeNull()
    expect([0, 999, 59_999, 60_000, 3_725_000, -5].map(elapsedLabel)).toEqual(['0:00', '0:00', '0:59', '1:00', '1:02:05', '0:00'])
  })

  it('leaves a subagent’s own task list out of the card above the composer', () => {
    const main = tool('t', { name: 'TodoWrite', todos: [{ text: 'main', status: 'pending' }] })
    const inner = tool('i', { name: 'TodoWrite', parent: 'ag', todos: [{ text: 'inner', status: 'pending' }] })
    expect(currentTodos([main, agent('ag'), inner])).toBe(main.todos)
  })
})

describe('a message just sent brings the feed back to its end', () => {
  it('is the new last user message, also when its reply came with it; not the first render or a whole history at once', () => {
    const before = feedBlocks([user('u1'), text('x1')])
    const after = feedBlocks([user('u1'), text('x1'), user('u2')])
    expect(sentMessage(before, after)).toBe('u2')
    expect(sentMessage(null, after)).toBeNull()
    expect(sentMessage([], after)).toBeNull()
    expect(sentMessage([], feedBlocks([user('u1')]))).toBe('u1')
    expect(sentMessage(after, after)).toBeNull()
    expect(sentMessage(after, feedBlocks([user('u1'), text('x1'), user('u2'), text('x2')]))).toBeNull()
    expect(sentMessage(before, feedBlocks([user('u1'), text('x1'), user('u2'), text('x2')]))).toBe('u2')
  })
})

describe('a sent message shows at once', () => {
  it('is drawn at the end until the agent’s copy arrives', () => {
    const items = [user('u1'), text('x1')]
    const pending = { id: 'pending-1', text: '再改一下', users: 1, at: 5 }
    expect(withPendingSend(items, pending).map((i) => i.id)).toEqual(['u1', 'x1', 'pending-1'])
    expect(withPendingSend([...items, user('u2', '再改一下')], pending).map((i) => i.id)).toEqual(['u1', 'x1', 'u2'])
    expect(withPendingSend(items, null)).toBe(items)
  })
})

describe('chat layout (Figma 51A)', () => {
  it('starts the agent’s part of a turn after each user message', () => {
    const blocks = feedBlocks([text('x0'), user('u1'), thinking('t1'), tool('a'), text('x1'), user('u2'), text('x2')])
    expect([...turnStarts(blocks)]).toEqual(['x0', 't1', 'x2'])
    expect(liveStartsTurn(blocks)).toBe(false)
    expect(liveStartsTurn(feedBlocks([user('u1')]))).toBe(true)
    expect(liveStartsTurn([])).toBe(true)
  })

  it('keeps a user message’s line breaks as Markdown breaks, not inside code or before a new block', () => {
    expect(userMarkdown('第一行\n第二行')).toBe('第一行\\\n第二行')
    expect(userMarkdown('步骤：\n\n1. 一\n2. 二')).toBe('步骤：\n\n1. 一\n2. 二')
    expect(userMarkdown('看这个：\n- a\n- b')).toBe('看这个：\n- a\n- b')
    expect(userMarkdown('```\na()\n  b()\n```\n完')).toBe('```\na()\n  b()\n```\n完')
    expect(userMarkdown('src/my_file.ts')).toBe('src/my_file.ts')
  })
})

describe('rows', () => {
  it('shows Wavi’s own messages with their header (F21 dispatch report)', () => {
    expect(userBubble('[Wavi 派活报告] 「登录接口测试」一轮结束')).toEqual({ header: 'Wavi 派活报告', body: '「登录接口测试」一轮结束' })
    expect(userBubble('把登录态迁移到 cookie')).toEqual({ header: null, body: '把登录态迁移到 cookie' })
  })

  it('says how long the agent thought', () => {
    expect(thinkingLabel(8_200)).toBe('思考了 8s')
    expect(thinkingLabel(200)).toBe('思考了 1s')
    expect(thinkingLabel(75_000)).toBe('思考了 1m 15s')
    expect(thinkingLabel(undefined)).toBe('思考了')
  })

  it('draws a tool row: status, +N −M for edits, a summary for output, 等你确认 while asked', () => {
    const edit = tool('e', { name: 'Write', arg: 'docs/a.md', diff: { path: 'docs/a.md', hunks: [], added: 18, removed: 0, truncated: false } })
    expect(toolView(edit, false)).toMatchObject({ status: 'done_unread', name: 'Write', added: 18, expandable: true })
    expect(toolView(edit, false)).not.toHaveProperty('removed')
    expect(toolView(edit, false)).not.toHaveProperty('summary')
    const grep = tool('g', { name: 'Grep', arg: '"localStorage" in src', output: '\n14 处 · 6 个文件\nmore' })
    expect(toolView(grep, false).summary).toBe('14 处 · 6 个文件')
    expect(toolView(tool('r', { state: 'running', name: 'Bash', output: 'partial' }), false)).toMatchObject({ status: 'running', expandable: true })
    expect(toolView(tool('r', { state: 'running', name: 'Bash' }), false)).not.toHaveProperty('summary')
    expect(toolView(tool('f', { state: 'error' }), false).status).toBe('error')
    expect(toolView(tool('w', { state: 'running', name: 'Bash' }), true)).toMatchObject({ status: 'needs_you', waiting: true })
  })

  it('reads a tool row as icon · verb · target, for every agent’s tool names (Figma 59J)', () => {
    const cases: [string, unknown, string][] = [
      // Claude Code (and Codex, whose shell, patch and search calls come as Bash / Edit / WebSearch)
      ['Read', 'file-text', '读取'],
      ['Edit', 'pencil', '编辑'],
      ['MultiEdit', 'pencil', '编辑'],
      ['Write', 'file-plus', '写入'],
      ['NotebookEdit', 'pencil', '编辑'],
      ['Bash', 'terminal', '运行'],
      ['BashOutput', 'terminal', '读取输出'],
      ['KillShell', 'square', '停止'],
      ['Grep', 'search', '搜索'],
      ['Glob', 'folder-search', '查找文件'],
      ['WebFetch', 'globe', '读取'],
      ['WebSearch', 'globe', '搜索网页'],
      ['Agent', 'bot', '子 agent'],
      ['Task', 'bot', '子 agent'],
      ['TodoWrite', 'list-todo', '任务'],
      ['Skill', 'sparkles', 'Skill'],
      ['ExitPlanMode', 'clipboard-list', '计划'],
      // ACP tool kinds (acp.ts KIND_NAMES)
      ['Delete', 'trash', '删除'],
      ['Move', 'move-right', '移动'],
      ['Search', 'search', '搜索'],
      ['Think', 'brain', '思考'],
      ['Fetch', 'globe', '读取'],
      ['Mode', 'toggle', '切换模式'],
      ['Tool', 'wrench', '工具'],
      // MCP tools and anything unknown: the tool's own name
      ['query_docs', 'wrench', 'query_docs'],
      ['update_plan', 'wrench', 'update_plan'],
      ['constructor', 'wrench', 'constructor']
    ]
    for (const [name, icon, verb] of cases) {
      const view = toolView(tool('t', { name, arg: 'src/a.ts' }), false)
      expect({ name, icon: view.icon, verb: view.verb, arg: view.arg }).toEqual({ name, icon, verb, arg: 'src/a.ts' })
    }
  })

  it('shows a command’s output without its terminal escape codes (colors, cursor moves, titles)', () => {
    const output = '\x1b]0;vitest\x07\x1b[1m\x1b[32m✓\x1b[39m\x1b[22m 12 passed\n\x1b[2K\x1b[1Gdone\x1b(B'
    const view = toolView(tool('b', { name: 'Bash', arg: 'npm test', output }), false)
    expect(view.summary).toBe('✓ 12 passed')
    expect(view.output).toBe('✓ 12 passed\ndone')
    // A sequence cut in two by the kept tail of a long output loses its visible half too.
    expect(toolView(tool('t', { name: 'Bash', output: '…[0m tail' }), false).output).toBe('… tail')
  })

  it('keeps a command’s whole text for its output, and shows exit N only when it failed with a code (Figma 59J)', () => {
    const failed = tool('b', { name: 'Bash', arg: 'pnpm vitest run', input: 'pnpm vitest run', state: 'error', exit: 1, output: 'FAIL' })
    expect(toolView(failed, false)).toMatchObject({ status: 'error', exit: 1, command: 'pnpm vitest run' })
    expect(toolView(tool('b', { name: 'Bash', state: 'ok', exit: 0, input: 'true', output: 'x' }), false)).not.toHaveProperty('exit')
    expect(toolView(tool('b', { name: 'Bash', state: 'error', exit: 0, input: 'x' }), false)).not.toHaveProperty('exit')
    // Claude reports no exit code: a failed call has none to show.
    expect(toolView(tool('b', { name: 'Bash', state: 'error', input: 'x', output: 'boom' }), false)).not.toHaveProperty('exit')
    // Nothing printed: it opens only when the row hides part of the command (lines, length).
    expect(toolView(tool('b', { name: 'Bash', arg: 'true', input: 'true' }), false).expandable).toBe(false)
    expect(toolView(tool('b', { name: 'Bash', arg: 'cd a && make', input: 'cd a &&\n  make' }), false)).toMatchObject({ expandable: true, command: 'cd a &&\n  make' })
  })

  it('counts +N −M over every file a tool changed', () => {
    const file = (path: string, added: number, removed: number) => ({ path, hunks: [], added, removed, truncated: false })
    const edit = tool('e', { name: 'Edit', diff: file('a.ts', 1, 1), files: [file('a.ts', 1, 1), file('b.ts', 4, 0)] })
    expect(toolView(edit, false)).toMatchObject({ added: 5, removed: 1, expandable: true })
  })

  it('reads a task list row as 任务 · N 项 that opens to its tasks', () => {
    const todos = [{ text: 'a', status: 'completed' as const }]
    for (const name of ['TodoWrite', 'Plan']) {
      const view = toolView(tool('t', { name, arg: '1 项', todos, output: 'Todos have been modified successfully' }), false)
      expect(view).toMatchObject({ verb: '任务', icon: 'list-todo', arg: '1 项', expandable: true })
      expect(view).not.toHaveProperty('summary')
    }
  })

  it('marks the running tool a permission is about', () => {
    const items = [tool('a'), tool('b', { state: 'running' }), text('x')]
    const permission = { kind: 'permission' as const, id: 'p', tool: 'Bash', detail: 'pnpm test', options: [] }
    expect(waitingToolId(items, [permission])).toBe('b')
    expect(waitingToolId(items, [])).toBeNull()
    expect(waitingToolId([tool('a')], [permission])).toBeNull()
  })

  it('finds the asking tool past a task list row', () => {
    const permission = { kind: 'permission' as const, id: 'p', tool: 'Bash', detail: 'pnpm test', options: [] }
    const plan = tool('plan:t', { name: 'Plan', arg: '1 项', todos: [{ text: 'a', status: 'in_progress' }] })
    expect(waitingToolId([tool('b', { name: 'Bash', state: 'running' }), plan], [permission])).toBe('b')
    expect(waitingToolId([tool('b', { name: 'Bash' }), plan], [permission])).toBeNull()
  })
})

describe('task list card (Figma 59J)', () => {
  const todo = (text: string, status: 'pending' | 'in_progress' | 'completed') => ({ text, status })
  it('shows the latest list in the conversation while something in it is left', () => {
    const older = tool('a', { name: 'TodoWrite', todos: [todo('old', 'pending')] })
    const latest = tool('b', { name: 'TodoWrite', todos: [todo('x', 'completed'), todo('y', 'in_progress')] })
    expect(currentTodos([older, text('t'), latest, user('u'), tool('c')])).toBe(latest.todos)
    expect(currentTodos([older])).toEqual([todo('old', 'pending')])
    expect(currentTodos([older, tool('d', { name: 'Plan', todos: [todo('x', 'completed')] })])).toBeNull()
    expect(currentTodos([older, tool('e', { name: 'TodoWrite', todos: [] })])).toBeNull()
    expect(currentTodos([text('t')])).toBeNull()
  })

  it('counts what is done and draws each task’s status', () => {
    expect(todoProgress([todo('a', 'completed'), todo('b', 'in_progress'), todo('c', 'pending')])).toEqual({ done: 1, total: 3 })
    expect(['completed', 'in_progress', 'pending'].map((s) => todoStatus(s as 'pending'))).toEqual(['done_unread', 'running', 'idle'])
  })
})

describe('permission card (49″E)', () => {
  const option = (id: string, kind: GuiPermissionOption['kind']): GuiPermissionOption => ({ id, label: id, kind })

  it('maps whatever options the agent gives onto 拒绝 / 总是允许 / 允许', () => {
    const buttons = permissionButtons([option('always', 'allow_always'), option('once', 'allow_once'), option('no', 'reject_once'), option('never', 'reject_always')])
    expect(buttons.reject?.id).toBe('no')
    expect(buttons.always?.id).toBe('always')
    expect(buttons.allow?.id).toBe('once')
    expect(permissionPrimary(buttons)?.id).toBe('once')
    // Only 总是允许 offered: ↵ answers it.
    const only = permissionButtons([option('always', 'allow_always'), option('never', 'reject_always')])
    expect(only.reject?.id).toBe('never')
    expect(permissionPrimary(only)?.id).toBe('always')
  })

  it('titles the card by what the tool does', () => {
    expect(permissionTitle('Claude', 'Bash')).toBe('Claude 要运行一条命令')
    expect(permissionTitle('Codex', 'fileChange')).toBe('Codex 要修改文件')
    expect(permissionTitle('Grok', 'mcp__x')).toBe('Grok 要使用 mcp__x')
    expect(shortAgentName('Claude Code')).toBe('Claude')
    expect(shortAgentName('Gemini CLI')).toBe('Gemini')
    expect(shortAgentName('Codex')).toBe('Codex')
  })

  it('shows every file a change asks about, and the detail when it says more than the path', () => {
    const file = (path: string) => ({ path, hunks: [], added: 1, removed: 0, truncated: false })
    const base = { kind: 'permission' as const, id: 'p', tool: 'Edit', options: [] }
    // Claude's Edit: the detail is the path the diff's header already shows.
    expect(permissionBody({ ...base, detail: 'src/a.ts', diff: file('src/a.ts') })).toEqual({ files: [file('src/a.ts')], detail: null })
    // Codex's reason shows above the change.
    expect(permissionBody({ ...base, detail: 'needs write access', diff: file('src/a.ts') })).toEqual({ files: [file('src/a.ts')], detail: 'needs write access' })
    // Several files: each one, the reason too.
    const files = [file('src/a.ts'), file('src/b.ts')]
    expect(permissionBody({ ...base, detail: 'refactor', diff: files[0]!, files })).toEqual({ files, detail: 'refactor' })
    expect(permissionBody({ ...base, detail: 'src/a.ts', diff: files[0]!, files })).toEqual({ files, detail: null })
    // No change: the detail alone.
    expect(permissionBody({ ...base, tool: 'Bash', detail: 'pnpm test' })).toEqual({ files: [], detail: 'pnpm test' })
    expect(permissionBody({ ...base, tool: 'Bash', detail: '' })).toEqual({ files: [], detail: null })
  })
})

describe('plan card (49″D)', () => {
  it('takes the title from the first heading, the rest is the body', () => {
    expect(planParts('# 支付页的 cookie 在 Safari 下的回退\n\n1. 改 token\n2. 签发 cookie')).toEqual({ title: '计划：支付页的 cookie 在 Safari 下的回退', body: '1. 改 token\n2. 签发 cookie' })
    expect(planParts('## 计划：迁移\nstep')).toEqual({ title: '计划：迁移', body: 'step' })
    expect(planParts('1. a\n2. b')).toEqual({ title: '计划', body: '1. a\n2. b' })
    expect(planParts('  ')).toEqual({ title: '计划', body: '' })
  })
})

describe('question card (49″F)', () => {
  const one: GuiQuestion = { question: '刷新失败时怎么处理？', options: [{ label: '退回登录页' }, { label: '静默重试' }], multiSelect: false }
  const many: GuiQuestion = { question: '要哪些？', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], multiSelect: true }

  it('picks one option, toggles several, or opens 其他…', () => {
    expect(pickChoice(one, undefined, 1)).toEqual({ kind: 'option', indexes: [1] })
    expect(pickChoice(one, { kind: 'option', indexes: [1] }, 0)).toEqual({ kind: 'option', indexes: [0] })
    const ab = pickChoice(many, pickChoice(many, undefined, 2), 0)
    expect(ab).toEqual({ kind: 'option', indexes: [2, 0] })
    expect(pickChoice(many, ab, 2)).toEqual({ kind: 'option', indexes: [0] })
    expect(pickChoice(one, undefined, 2)).toEqual({ kind: 'other', text: '' })
  })

  it('answers every question by its text, or nothing while one is open', () => {
    expect(questionAnswers([one, many], [{ kind: 'option', indexes: [0] }, { kind: 'option', indexes: [2, 0] }])).toEqual({ '刷新失败时怎么处理？': '退回登录页', '要哪些？': 'A, C' })
    expect(questionAnswers([one], [{ kind: 'other', text: ' 提示用户 ' }])).toEqual({ '刷新失败时怎么处理？': '提示用户' })
    expect(questionAnswers([one], [{ kind: 'other', text: '  ' }])).toBeNull()
    expect(questionAnswers([one, many], [{ kind: 'option', indexes: [0] }])).toBeNull()
  })

  it('reads ↵ ⎋ 1–9 ↑↓, never while an input method composes or a modifier is held', () => {
    const key = (k: string, patch = {}) => cardKey({ key: k, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, ...patch }, false)
    expect(key('Enter')).toEqual({ type: 'primary' })
    expect(key('Escape')).toEqual({ type: 'dismiss' })
    expect(key('3')).toEqual({ type: 'pick', index: 2 })
    expect(key('0')).toBeNull()
    expect(key('ArrowDown')).toEqual({ type: 'move', delta: 1 })
    expect(key('Enter', { isComposing: true })).toBeNull()
    expect(key('Enter', { metaKey: true })).toBeNull()
    // Typing in 其他…: only ⎋ is the card's.
    expect(cardKey({ key: 'Enter', metaKey: false, ctrlKey: false, altKey: false, isComposing: false }, true)).toBeNull()
  })
})

describe('composer', () => {
  const key = (k: string, patch: Partial<{ shiftKey: boolean; metaKey: boolean; altKey: boolean; ctrlKey: boolean; isComposing: boolean; keyCode: number }> = {}, state: { menuOpen: boolean; busy: boolean; inCode?: boolean } = { menuOpen: false, busy: false }) =>
    composerKey({ key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, keyCode: 0, ...patch }, state)

  it('⏎ sends, ⇧⏎ is a newline, ⎋ stops a running turn', () => {
    expect(key('Enter')).toBe('send')
    expect(key('Enter', { shiftKey: true })).toBe('newline')
    expect(key('Enter', {}, { menuOpen: false, busy: false, inCode: true })).toBe('newline')
    expect(key('Enter', { metaKey: true }, { menuOpen: false, busy: false, inCode: true })).toBe('send')
    expect(key('Escape')).toBeNull()
    expect(key('Escape', {}, { menuOpen: false, busy: true })).toBe('stop')
  })

  it('leaves the Enter that commits an input method’s text alone (isComposing, or keyCode 229)', () => {
    expect(key('Enter', { isComposing: true })).toBeNull()
    expect(key('Enter', { keyCode: 229 })).toBeNull()
  })

  it('draws pictures as thumbnails (Figma 50C), other files as names', () => {
    expect(thumbnailUrl('/tmp/wavi/attachments/paste-1.PNG')).toBe('file:///tmp/wavi/attachments/paste-1.PNG')
    expect(thumbnailUrl('/Users/m/截屏 2026.jpeg')).toBe('file:///Users/m/%E6%88%AA%E5%B1%8F%202026.jpeg')
    expect(thumbnailUrl('/Users/m/photo.heic')).toBeNull()
    expect(thumbnailUrl('/Users/m/notes.md')).toBeNull()
  })

  it('drives the / menu while it is open', () => {
    const open = { menuOpen: true, busy: true }
    expect(key('ArrowDown', {}, open)).toBe('menu-down')
    expect(key('ArrowUp', {}, open)).toBe('menu-up')
    expect(key('Enter', {}, open)).toBe('menu-pick')
    expect(key('Tab', {}, open)).toBe('menu-pick')
    expect(key('Escape', {}, open)).toBe('menu-close')
  })

  it('opens the / menu only while a command name is being typed', () => {
    expect(slashQuery('/re')).toBe('re')
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('/review the diff')).toBeNull()
    expect(slashQuery('see /re')).toBeNull()
    const commands = [{ name: 'review', description: '审阅' }, { name: 'rewind', description: '回到之前' }, { name: 'compare', description: 'x' }]
    expect(matchCommands(commands, slashQuery('/re')!).map((c) => c.name)).toEqual(['review', 'rewind', 'compare'])
    expect(pickCommand(commands[0]!)).toBe('/review ')
  })

  it('splits the / menu into 命令 then Skills, the keys going down the same order (Figma 59H)', () => {
    const matches = [
      { name: 'research', description: 'r', kind: 'skill' as const },
      { name: 'review', description: 'v', kind: 'command' as const },
      { name: 'release-notes', description: 'n' },
      { name: 'remotion-render', description: 'm', kind: 'skill' as const }
    ]
    const groups = slashGroups(matches)
    expect(groups.map((g) => [g.title, g.commands.map((c) => c.name)])).toEqual([
      ['命令', ['review', 'release-notes']],
      ['Skills', ['research', 'remotion-render']]
    ])
    expect(groups.map((g) => g.start)).toEqual([0, 2])
    expect(slashGroups(matches.filter((c) => c.kind === 'skill')).map((g) => g.title)).toEqual(['Skills'])
    expect(slashGroups([])).toEqual([])
  })

  it('adds inserted text after what is typed', () => {
    expect(appendToDraft('', '@a.ts ')).toBe('@a.ts ')
    expect(appendToDraft('look at', '@a.ts ')).toBe('look at @a.ts ')
    expect(appendToDraft('look at ', '@a.ts ')).toBe('look at @a.ts ')
  })

  it('puts model and reasoning effort on one picker, other options on their own', () => {
    const option = (id: string, category: GuiConfigOption['category'], current: string, values: string[]): GuiConfigOption => ({
      id,
      category,
      label: id,
      current,
      values: values.map((v) => ({ value: v, label: v === 'high' ? '高' : v }))
    })
    const buttons = pickerButtons([
      option('mode', 'mode', 'agent', ['agent', 'ask']),
      planOption(true),
      permissionOption(['ask', 'accept-edits'], 'accept-edits'),
      option('effort', 'thought_level', 'high', ['low', 'high']),
      option('model', 'model', 'Sonnet 5', ['Sonnet 5', 'Opus 5.5']),
      option('only', 'other', 'x', ['x'])
    ])
    // Figma 65: model, effort, 权限 and 计划 as one 模式 button (planning: 计划), then the agent's own mode; a single
    // choice is not a picker.
    expect(buttons.map((b) => [b.key, b.label, b.toggle?.on])).toEqual([
      ['model', 'Sonnet 5', undefined],
      ['effort', '高', undefined],
      ['permission+plan', '计划', undefined],
      ['mode', 'agent', undefined]
    ])
    expect(pickerButtons([permissionOption(['ask'], 'ask')])).toEqual([])
  })

  it('lists 询问 / 接受编辑 / 自动 / 计划 on one 模式 button, and 快速 is a switch (Figma 65)', () => {
    const levels = permissionOption(['ask', 'accept-edits', 'auto'], 'auto')
    const [mode, fast] = pickerButtons([levels, planOption(false), fastOption(true, '快速没有生效：x')])
    expect(mode).toMatchObject({ key: 'permission+plan', label: '自动', mode: { current: 'auto' } })
    expect(mode?.mode?.choices.map((c) => `${c.value}:${c.label}`)).toEqual(['ask:询问', 'accept-edits:接受编辑', 'auto:自动', 'plan:计划'])
    expect(fast).toMatchObject({ key: 'fast', label: '快速', toggle: { on: true }, hint: '快速没有生效：x' })
    // An agent without a plan mode: three levels; one level and a plan mode (an ACP agent that only asks): two.
    expect(pickerButtons([levels])[0]?.mode?.choices).toHaveLength(3)
    expect(pickerButtons([permissionOption(['ask'], 'ask'), planOption(true)])[0]).toMatchObject({ label: '计划', mode: { current: 'plan', choices: [{ value: 'ask' }, { value: 'plan' }] } })
  })

  it('counts a session as empty until anything is said, runs or waits (Figma 59G / 65)', () => {
    const none = { items: [], live: null, busy: false, queued: [] }
    expect(chatIsEmpty(none)).toBe(true)
    expect(chatIsEmpty({ ...none, busy: true })).toBe(false)
    expect(chatIsEmpty({ ...none, items: [user('u')] })).toBe(false)
    expect(chatIsEmpty({ ...none, queued: [{ id: 'q', text: 'x' }] })).toBe(false)
  })

  it('lists the agents an empty session can switch to: installed with a GUI first, the others to install (Figma 65)', () => {
    const menu = guiAgentMenu({ claude: true, codex: false, grok: true, cursor: false, crush: true, pi: true, amp: true, adapters: { 'amp-acp': false } })
    // Claude Code and Codex are always there (as in 新建会话); Crush has no GUI at all.
    expect(menu.installed).toEqual(expect.arrayContaining(['claude', 'codex', 'grok']))
    expect(menu.installed).not.toContain('cursor')
    expect(menu.missing).toContain('cursor')
    expect([...menu.installed, ...menu.missing]).not.toContain('crush')
    // Pi runs its own rpc mode (PRD v1.160): installed. Amp's GUI needs amp-acp: listed apart (a pick installs).
    expect(menu.installed).toContain('pi')
    expect(menu.adapter).toEqual(['amp'])
    expect([...menu.installed, ...menu.missing]).not.toContain('amp')
  })

  it('offers each project once, by its main worktree, in the sidebar’s order (Figma 65)', () => {
    const projects = [{ id: 'p1', name: 'acme' }, { id: 'p2', name: 'web' }, { id: 'p3', name: 'gone' }]
    const worktrees = [
      { id: 'w1', projectId: 'p1', isMain: true },
      { id: 'w1b', projectId: 'p1', isMain: false },
      { id: 'w2', projectId: 'p2', isMain: true },
      { id: 'w3', projectId: 'p3', isMain: true, archived: {} }
    ]
    expect(projectChoices(projects, worktrees)).toEqual([
      { projectId: 'p1', name: 'acme', worktreeId: 'w1' },
      { projectId: 'p2', name: 'web', worktreeId: 'w2' }
    ])
  })

  it('turns wheel deltas into whole steps, keeping the rest', () => {
    expect(wheelSteps(0, 30)).toEqual({ steps: 0, rest: 30 })
    expect(wheelSteps(30, 30)).toEqual({ steps: 1, rest: 20 })
    expect(wheelSteps(0, -100)).toEqual({ steps: -2, rest: -20 })
  })

  it('turns a 模式 choice into the picker changes to send, in order', () => {
    expect(modeChanges('plan', false)).toEqual([['plan', 'on']])
    expect(modeChanges('plan', true)).toEqual([])
    expect(modeChanges('ask', false)).toEqual([['permission', 'ask']])
    // Leaving 计划: the level first (Claude and Grok keep it as where plan off returns), then plan off.
    expect(modeChanges('auto', true)).toEqual([['permission', 'auto'], ['plan', 'off']])
  })

  it('steps through a list, wrapping', () => {
    expect(stepIndex(-1, 1, 3)).toBe(0)
    expect(stepIndex(-1, -1, 3)).toBe(2)
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
    expect(stepIndex(0, 1, 0)).toBe(-1)
  })

  it('puts copy · time after the last block of each finished turn that has words (Figma 54B)', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u1', at: 1, text: 'hi', images: 0 },
      { kind: 'text', id: 't1', at: 2, text: 'Looking.' },
      { kind: 'tool', id: 'k1', at: 3, name: 'Read', arg: 'a.ts', state: 'ok' },
      { kind: 'text', id: 't2', at: 4, text: 'Done.' },
      { kind: 'user', id: 'u2', at: 5, text: 'and?', images: 0 },
      { kind: 'tool', id: 'k2', at: 6, name: 'Bash', arg: 'ls', state: 'ok' },
      { kind: 'user', id: 'u3', at: 7, text: 'more', images: 0 },
      { kind: 'text', id: 't3', at: 8, text: 'Going.' }
    ]
    const blocks = feedBlocks(items)
    expect([...turnEnds(blocks, true)]).toEqual([['t2', { text: 'Looking.\n\nDone.', at: 4 }]])
    expect([...turnEnds(blocks, false).keys()]).toEqual(['t2', 't3'])
  })
})
