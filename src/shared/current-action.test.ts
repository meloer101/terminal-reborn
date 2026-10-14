import { describe, expect, it } from 'vitest'
import { basename, currentAction } from './current-action'

describe('currentAction', () => {
  it.each<[string, string, Record<string, unknown>, string]>([
    ['Read uses the basename', 'Read', { file_path: '/repo/src/a.ts' }, '读取 a.ts'],
    ['Edit', 'Edit', { file_path: '/repo/src/auth/session.ts' }, '编辑 session.ts'],
    ['Write', 'Write', { file_path: 'b.md', content: 'x' }, '编辑 b.md'],
    ['MultiEdit', 'MultiEdit', { file_path: '/x/c.tsx', edits: [] }, '编辑 c.tsx'],
    ['NotebookEdit', 'NotebookEdit', { notebook_path: '/x/n.ipynb' }, '编辑 n.ipynb'],
    ['Bash short', 'Bash', { command: 'pnpm test' }, '运行 pnpm test'],
    ['Bash collapses whitespace', 'Bash', { command: 'git\n  status' }, '运行 git status'],
    ['Grep', 'Grep', { pattern: 'useSession', path: 'src' }, "搜索 'useSession'"],
    ['Glob', 'Glob', { pattern: '**/*.ts' }, "搜索 '**/*.ts'"],
    ['WebSearch', 'WebSearch', { query: 'electron notification' }, "搜索 'electron notification'"],
    ['WebFetch host', 'WebFetch', { url: 'https://docs.example.com/a/b?q=1' }, '抓取 docs.example.com'],
    ['WebFetch invalid url', 'WebFetch', { url: 'not a url' }, '抓取 not a url'],
    ['Task', 'Task', { description: '梳理鉴权流程', prompt: 'long' }, '子任务：梳理鉴权流程'],
    ['Agent alias', 'Agent', { description: 'explore' }, '子任务：explore'],
    ['AskUserQuestion', 'AskUserQuestion', { questions: [{ question: '用哪个库？' }] }, '提问：用哪个库？'],
    ['AskUserQuestion without questions', 'AskUserQuestion', {}, '提问'],
    ['unknown tool', 'mcp__figma__get_screenshot', { nodeId: '1:2' }, 'mcp__figma__get_screenshot'],
    ['known tool without usable input', 'Read', {}, 'Read'],
    ['non-string input is ignored', 'Bash', { command: 42 }, 'Bash']
  ])('%s', (_name, tool, input, expected) => {
    expect(currentAction(tool, input)).toBe(expected)
  })

  it('truncates long Bash commands to 40 characters', () => {
    const command = 'a'.repeat(100)
    expect(currentAction('Bash', { command })).toBe(`运行 ${'a'.repeat(40)}…`)
  })

  it('does not add an ellipsis at exactly 40 characters', () => {
    expect(currentAction('Bash', { command: 'b'.repeat(40) })).toBe(`运行 ${'b'.repeat(40)}`)
  })
})

describe('basename', () => {
  it('handles trailing slashes, windows separators and bare names', () => {
    expect(basename('/a/b/')).toBe('b')
    expect(basename('C:\\a\\b.txt')).toBe('b.txt')
    expect(basename('x.ts')).toBe('x.ts')
  })
})
