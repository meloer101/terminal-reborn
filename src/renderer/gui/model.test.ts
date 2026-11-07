import { describe, expect, it } from 'vitest'
import { Bot, Brain, ClipboardList, FilePlus, FileText, FolderSearch, Globe, ListTodo, MoveRight, Pencil, Search, Sparkles, Square, Terminal, ToggleLeft, Trash2, Wrench } from 'lucide-react'
import { matchCommands, permissionOption, planOption, type GuiConfigOption, type GuiPermissionOption, type GuiQuestion } from '@shared/gui-chat'
import type { ChatItem } from '@shared/transcript-chat'
import {
  appendToDraft,
  cardKey,
  composerKey,
  feedBlocks,
  permissionButtons,
  permissionPrimary,
  permissionTitle,
  sentMessage,
  shortAgentName,
  pickChoice,
  pickCommand,
  pickerButtons,
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
  todoStatus
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
      ['Read', FileText, '读取'],
      ['Edit', Pencil, '编辑'],
      ['MultiEdit', Pencil, '编辑'],
      ['Write', FilePlus, '写入'],
      ['NotebookEdit', Pencil, '编辑'],
      ['Bash', Terminal, '运行'],
      ['BashOutput', Terminal, '读取输出'],
      ['KillShell', Square, '停止'],
      ['Grep', Search, '搜索'],
      ['Glob', FolderSearch, '查找文件'],
      ['WebFetch', Globe, '读取'],
      ['WebSearch', Globe, '搜索网页'],
      ['Agent', Bot, '子 agent'],
      ['Task', Bot, '子 agent'],
      ['TodoWrite', ListTodo, '任务'],
      ['Skill', Sparkles, 'Skill'],
      ['ExitPlanMode', ClipboardList, '计划'],
      // ACP tool kinds (acp.ts KIND_NAMES)
      ['Delete', Trash2, '删除'],
      ['Move', MoveRight, '移动'],
      ['Search', Search, '搜索'],
      ['Think', Brain, '思考'],
      ['Fetch', Globe, '读取'],
      ['Mode', ToggleLeft, '切换模式'],
      ['Tool', Wrench, '工具'],
      // MCP tools and anything unknown: the tool's own name
      ['query_docs', Wrench, 'query_docs'],
      ['update_plan', Wrench, 'update_plan'],
      ['constructor', Wrench, 'constructor']
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
      expect(view).toMatchObject({ verb: '任务', icon: ListTodo, arg: '1 项', expandable: true })
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
    // Figma 56: model · effort, 权限, 计划 (a switch), then the agent's own mode; a single choice is not a picker.
    expect(buttons.map((b) => [b.key, b.label, b.toggle?.on])).toEqual([
      ['model+effort', 'Sonnet 5 · 高', undefined],
      ['permission', '接受编辑', undefined],
      ['plan', '计划', true],
      ['mode', 'agent', undefined]
    ])
    expect(pickerButtons([permissionOption(['ask'], 'ask')])).toEqual([])
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
