import { describe, expect, it } from 'vitest'
import type { RemoteSession } from '../../../src/shared/remote'
import type { ChatItem } from '../../../src/shared/transcript-chat'
import { applyFeed, groupSessions, hunkRows, lastLine, prependFeed, rowTime, shortAge, splitPath, unifiedRows, viaOf } from './model'

const text = (n: number, t = `t${n}`): ChatItem => ({ kind: 'text', id: `i${n}`, at: 0, text: t })
const session = (o: Partial<RemoteSession>): RemoteSession => ({ id: 's', projectId: 'p1', title: 'x', agent: 'claude', status: 'idle', activity: 0, ...o })

describe('applyFeed', () => {
  it('starts from a page, extends it with pushes and rewrites a changed last item', () => {
    let feed = applyFeed(undefined, { start: 50, items: [text(50), text(51)] })
    feed = applyFeed(feed, { start: 52, items: [text(52)] })
    expect(feed.items.map((i) => i.id)).toEqual(['i50', 'i51', 'i52'])
    feed = applyFeed(feed, { start: 52, items: [text(52, 'changed'), text(53)] })
    expect(feed).toEqual({ start: 50, items: [text(50), text(51), text(52, 'changed'), text(53)] })
  })

  it('replaces everything on reset or after a gap', () => {
    const feed = { start: 0, items: [text(0)] }
    expect(applyFeed(feed, { start: 0, items: [], reset: true })).toEqual({ start: 0, items: [] })
    expect(applyFeed(feed, { start: 5, items: [text(5)] })).toEqual({ start: 5, items: [text(5)] })
  })

  it('puts an older page in front only when it ends where the feed starts', () => {
    const feed = { start: 2, items: [text(2)] }
    expect(prependFeed(feed, { start: 0, items: [text(0), text(1)] }).items).toHaveLength(3)
    expect(prependFeed(feed, { start: 0, items: [text(0)] })).toBe(feed)
  })
})

describe('groupSessions', () => {
  it('puts the waiting ones first, the latest on top, then projects in order, newest first', () => {
    const groups = groupSessions({
      projects: [{ id: 'p1', name: 'acme-web' }, { id: 'p2', name: 'terminal-reborn' }, { id: 'p3', name: 'empty' }],
      sessions: [
        session({ id: 'a', projectId: 'p1', activity: 1 }),
        session({ id: 'b', projectId: 'p1', activity: 5 }),
        session({ id: 'w1', projectId: 'p2', status: 'needs_you', since: 300 }),
        session({ id: 'w2', projectId: 'p1', status: 'needs_you', since: 100 }),
        session({ id: 'c', projectId: 'p2', activity: 2 })
      ]
    })
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.session.id)])).toEqual([
      ['等你处理', ['w1', 'w2']],
      ['acme-web', ['b', 'a']],
      ['terminal-reborn', ['c']]
    ])
    expect(groups[0]!.rows[1]!.projectName).toBe('acme-web')
    expect(groups[1]!.rows[0]!.projectName).toBeUndefined()
  })
})

describe('times and labels', () => {
  it('writes short ages and the row time', () => {
    expect([shortAge(40_000), shortAge(180_000), shortAge(7_200_000), shortAge(200_000_000)]).toEqual(['40s', '3m', '2h', '2d'])
    expect(rowTime(session({ status: 'needs_you', since: 0 }), 120_000)).toBe('已等 2m')
    expect(rowTime(session({ activity: 0 }), 60_000)).toBe('1m')
  })

  it('names the connection, splits paths and finds the last output line', () => {
    expect(viaOf('ws://100.101.2.3:7429')).toBe('Tailscale')
    expect(viaOf('ws://100.20.2.3:7429')).toBe('局域网')
    expect(viaOf('ws://192.168.1.5:7429')).toBe('局域网')
    expect(splitPath('src/auth/session.ts')).toEqual({ name: 'session.ts', dir: 'src/auth/' })
    expect(lastLine('a\n✓ 12 passed (1.4s)\n\n')).toBe('✓ 12 passed (1.4s)')
    expect(lastLine(undefined)).toBeNull()
  })
})

describe('diff rows', () => {
  it('numbers structuredPatch hunks', () => {
    const rows = hunkRows([{ oldStart: 12, newStart: 12, lines: [' a', '-b', '+c', '+d', ' e'] }])
    expect(rows[0]).toEqual({ kind: 'hunk', text: '@@ -12,3 +12,4 @@' })
    expect(rows.slice(1).map((r) => (r.kind === 'line' ? [r.sign, r.old, r.new] : null))).toEqual([
      [' ', 12, 12],
      ['-', 13, null],
      ['+', null, 13],
      ['+', null, 14],
      [' ', 14, 15]
    ])
  })

  it('reads git diff text the same way', () => {
    const rows = unifiedRows('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@ fn\n a\n-b\n+c\n\\ No newline at end of file\n')
    expect(rows).toEqual([
      { kind: 'hunk', text: '@@ -1,2 +1,2 @@ fn' },
      { kind: 'line', sign: ' ', old: 1, new: 1, code: 'a' },
      { kind: 'line', sign: '-', old: 2, new: null, code: 'b' },
      { kind: 'line', sign: '+', old: null, new: 2, code: 'c' }
    ])
  })
})

describe('permission sheet text', () => {
  it('names what is asked and what 总是允许 would allow', async () => {
    const { permissionTitle, permissionSubject, allowAlwaysLabel } = await import('./model')
    expect(permissionTitle('Bash')).toBe('运行命令')
    expect(permissionTitle('mcp__x')).toBe('使用 mcp__x')
    expect(permissionSubject({ command: 'pnpm add -D msw', description: 'x' }, 's')).toBe('pnpm add -D msw')
    expect(permissionSubject({}, '运行 x')).toBe('运行 x')
    expect(allowAlwaysLabel([{ tool: 'Bash', content: 'pnpm add:*' }])).toBe('总是允许 pnpm add')
    expect(allowAlwaysLabel([{ tool: 'WebFetch', content: 'domain:example.com' }, { tool: 'Bash' }])).toBe('总是允许 example.com 等 2 项')
    expect(allowAlwaysLabel(undefined)).toBe('总是允许')
  })
})
