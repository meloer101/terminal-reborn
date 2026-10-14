import { describe, expect, it } from 'vitest'
import type { PendingPrompt } from '@shared/agent-events'
import { permissionDetail, permissionOptions, permissionTitle, queueLabel } from './present'

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

  it('总是允许 only when the agent offered a rule; keys are numbered in order', () => {
    expect(permissionOptions(perm()).map((o) => [o.key, o.decision, o.label])).toEqual([
      [1, 'allow-once', '允许一次'],
      [2, 'allow-always', '总是允许'],
      [3, 'deny', '拒绝']
    ])
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
