import { describe, expect, it } from 'vitest'
import type { PendingPrompt } from '@shared/agent-events'
import { allowAlwaysLabel, permissionDetail, permissionOptions, permissionTitle, promptOptionCount, queueLabel, replyPlaceholder } from './present'

type Permission = Extract<PendingPrompt, { kind: 'permission' }>
const perm = (over: Partial<Permission> = {}): Permission => ({
  kind: 'permission',
  id: 'p',
  sessionId: 's',
  tool: 'Bash',
  input: { command: 'pnpm prisma migrate dev --name session_cookie' },
  summary: '运行 pnpm prisma migrate dev',
  canAllowAlways: true,
  createdAt: 0,
  ...over
})

describe('permission wording', () => {
  it('titles follow the tool and the agent', () => {
    expect(permissionTitle(perm(), 'claude')).toBe('Claude 请求运行命令')
    expect(permissionTitle(perm({ tool: 'Edit' }), 'codex')).toBe('Codex 请求修改文件')
    expect(permissionTitle(perm({ tool: 'mcp__x__y' }), 'claude')).toBe('Claude 请求使用 mcp__x__y')
  })

  it('detail is the command or path, one line, else the summary', () => {
    expect(permissionDetail(perm({ input: { command: 'a\n  b   c' } }))).toBe('a b c')
    expect(permissionDetail(perm({ tool: 'Write', input: { file_path: '/x/y.ts' } }))).toBe('/x/y.ts')
    expect(permissionDetail(perm({ tool: 'Grep', input: { pattern: 'useSession' } }))).toBe('useSession')
    expect(permissionDetail(perm({ tool: 'Other', input: {} }))).toBe('运行 pnpm prisma migrate dev')
  })

  it('allow-always only when the agent offered a rule; keys are numbered in order (Figma 02)', () => {
    const scoped = perm({ allowAlways: { scope: 'session', rules: [{ tool: 'Bash', content: 'pnpm prisma:*' }], directories: [] } })
    expect(permissionOptions(scoped).map((o) => [o.key, o.decision, o.label])).toEqual([
      [1, 'allow-once', '允许'],
      [2, 'allow-always', '允许，本会话不再询问 pnpm prisma'],
      [3, 'deny', '拒绝并说明…']
    ])
    expect(permissionOptions(perm())[1]?.label).toBe('允许，不再询问同类请求')
    expect(permissionOptions(perm({ canAllowAlways: false })).map((o) => [o.key, o.decision])).toEqual([
      [1, 'allow-once'],
      [2, 'deny']
    ])
  })

  it('shows 1 / N only for a queue', () => {
    expect(queueLabel(1)).toBeNull()
    expect(queueLabel(3)).toBe('1 / 3')
  })
})

describe('allow-always scope label', () => {
  const label = (rules: { tool: string; content?: string }[], directories: string[] = [], scope: 'session' | 'project' = 'session') =>
    allowAlwaysLabel({ scope, rules, directories })

  it('names the command prefix, domain or path the rule covers', () => {
    expect(label([{ tool: 'Bash', content: 'npm run test:*' }], [], 'project')).toBe('允许，本项目不再询问 npm run test')
    expect(label([{ tool: 'WebFetch', content: 'domain:docs.anthropic.com' }])).toBe('允许，本会话不再询问 docs.anthropic.com')
    expect(label([{ tool: 'Edit', content: '/repo/src/**' }])).toBe('允许，本会话不再询问 src/')
  })

  it('a whole-tool rule is named in Chinese without a space', () => {
    expect(label([{ tool: 'Edit' }], [], 'project')).toBe('允许，本项目不再询问文件修改')
    expect(label([{ tool: 'mcp__x__y' }])).toBe('允许，本会话不再询问 mcp__x__y')
  })

  it('directories only: 可访问; more than two subjects are summarised', () => {
    expect(label([], ['/work/project'])).toBe('允许，本会话可访问 project/')
    expect(label([{ tool: 'Bash', content: 'a' }, { tool: 'Bash', content: 'b' }, { tool: 'Bash', content: 'c' }])).toBe(
      '允许，本会话不再询问 a、b 等'
    )
  })

  it('long commands are clipped', () => {
    expect(label([{ tool: 'Bash', content: 'x'.repeat(50) }])).toBe(`允许，本会话不再询问 ${'x'.repeat(31)}…`)
  })
})

describe('composer placeholder while the bar shows', () => {
  it('counts the numbered options of the prompt on screen', () => {
    expect(promptOptionCount(perm())).toBe(3)
    expect(promptOptionCount(perm({ canAllowAlways: false }))).toBe(2)
    const q: PendingPrompt = {
      kind: 'question',
      id: 'q',
      sessionId: 's',
      createdAt: 0,
      questions: [
        { question: 'a', multiSelect: false, options: [{ label: '1' }, { label: '2' }] },
        { question: 'b', multiSelect: false, options: [{ label: '1' }, { label: '2' }, { label: '3' }] }
      ]
    }
    expect(promptOptionCount(q)).toBe(3)
    expect(promptOptionCount(q, 1)).toBe(4)
  })

  it('reads like Figma 02', () => {
    expect(replyPlaceholder('claude', 3)).toBe('回复 Claude，或按 1–3 直接选择')
    expect(replyPlaceholder('codex', 2)).toBe('回复 Codex，或按 1–2 直接选择')
    expect(replyPlaceholder('claude', 14)).toBe('回复 Claude，或按 1–9 直接选择')
  })
})
