import { describe, expect, it } from 'vitest'
import { formatPairingCode, normalizePairingCode, pairingLink, parsePhoneRequest, parseRemoteResult, parseWindowSessions, REMOTE_LIMITS } from './remote'

describe('pairing codes', () => {
  it('reads what the phone typed, with or without the dash, and refuses misreadable letters', () => {
    expect(normalizePairingCode('4kx-92q')).toBe('4KX92Q')
    expect(normalizePairingCode(' 4KX 92Q ')).toBe('4KX92Q')
    expect(normalizePairingCode('4KX-920')).toBeNull()
    expect(normalizePairingCode('4KX9')).toBeNull()
    expect(normalizePairingCode(42)).toBeNull()
    expect(formatPairingCode('4KX92Q')).toBe('4KX-92Q')
  })

  it('puts the offer in a wavi:// link the camera can open', () => {
    const link = pairingLink({ v: 1, name: 'MacBook Pro', urls: ['ws://10.0.0.2:7429'], code: '4KX92Q', key: 'abc' })
    expect(link.startsWith('wavi://pair?d=')).toBe(true)
    const b64 = link.slice('wavi://pair?d='.length).replace(/-/g, '+').replace(/_/g, '/')
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    expect(JSON.parse(json)).toEqual({ v: 1, name: 'MacBook Pro', urls: ['ws://10.0.0.2:7429'], code: '4KX92Q', key: 'abc' })
  })
})

describe('parsePhoneRequest', () => {
  it('accepts each command in its documented shape', () => {
    expect(parsePhoneRequest({ id: 1, type: 'snapshot' })).toEqual({ id: 1, type: 'snapshot' })
    expect(parsePhoneRequest({ id: 2, type: 'watch', session: null })).toEqual({ id: 2, type: 'watch', session: null })
    expect(parsePhoneRequest({ id: 3, type: 'feed', session: 's1', before: 40 })).toEqual({ id: 3, type: 'feed', session: 's1', before: 40 })
    expect(parsePhoneRequest({ id: 4, type: 'send', session: 's1', text: '看截图', photos: [{ name: 'IMG_1.HEIC', data: 'AAAA' }] })).toEqual({
      id: 4,
      type: 'send',
      session: 's1',
      text: '看截图',
      photos: [{ name: 'IMG_1.HEIC', data: 'AAAA' }]
    })
    expect(parsePhoneRequest({ id: 5, type: 'permission', prompt: 'p1', decision: 'deny' })).toEqual({ id: 5, type: 'permission', prompt: 'p1', decision: 'deny' })
    expect(parsePhoneRequest({ id: 6, type: 'answer', prompt: 'p2', answers: { '要不要提示？': '显示' } })).toEqual({ id: 6, type: 'answer', prompt: 'p2', answers: { '要不要提示？': '显示' } })
    expect(parsePhoneRequest({ id: 7, type: 'new-session', project: 'p', workdir: 'worktree', agent: 'claude', base: 'main', branch: 'jacob/x', prompt: '  ' })).toEqual({
      id: 7,
      type: 'new-session',
      project: 'p',
      workdir: 'worktree',
      agent: 'claude',
      base: 'main',
      branch: 'jacob/x'
    })
    expect(parsePhoneRequest({ id: 8, type: 'diff', session: 's1', path: 'src/a.ts', scope: 'committed' })).toEqual({ id: 8, type: 'diff', session: 's1', path: 'src/a.ts', scope: 'committed' })
    expect(parsePhoneRequest({ id: 9, type: 'diff', session: 's1', path: 'b.ts', oldPath: 'a.ts', scope: 'uncommitted', untracked: false })).toEqual({ id: 9, type: 'diff', session: 's1', path: 'b.ts', oldPath: 'a.ts', scope: 'uncommitted' })
  })

  it('refuses anything off: unknown types, bad ids, empty sends, paths out of the worktree, too many photos', () => {
    expect(parsePhoneRequest({ type: 'snapshot' })).toBeNull()
    expect(parsePhoneRequest({ id: -1, type: 'snapshot' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'rm-rf' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: '   ' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'send', session: '../x', text: 'hi' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: 'a\0b' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: 'x'.repeat(REMOTE_LIMITS.textChars + 1) })).toBeNull()
    const photo = { name: 'a.jpg', data: 'AAAA' }
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: '', photos: Array(REMOTE_LIMITS.photos + 1).fill(photo) })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: '', photos: [{ name: 'a', data: 'not base64!' }] })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'diff', session: 's1', path: '../etc/passwd', scope: 'committed' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'diff', session: 's1', path: '/etc/passwd', scope: 'committed' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'diff', session: 's1', path: 'a.ts', scope: 'all' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'permission', prompt: 'p', decision: 'yes' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'answer', prompt: 'p', answers: {} })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'new-session', project: 'p', workdir: 'worktree', agent: 'bash' })).toBeNull()
    expect(parsePhoneRequest({ id: 1, type: 'new-session', project: 'p', workdir: 'worktree', agent: 'claude', branch: 'a b' })).toBeNull()
  })

  it('takes a photo-only send', () => {
    expect(parsePhoneRequest({ id: 1, type: 'send', session: 's1', text: '', photos: [{ name: 'a.jpg', data: 'AAAA' }] })).toMatchObject({ text: '', photos: [{ name: 'a.jpg' }] })
  })
})

describe('window messages', () => {
  it('reads a window answer and treats anything else as unreadable', () => {
    expect(parseRemoteResult({ ok: true })).toEqual({ ok: true })
    expect(parseRemoteResult({ ok: false, error: '会话不存在' })).toEqual({ ok: false, error: '会话不存在' })
    expect(parseRemoteResult({ ok: 'maybe' })).toBeNull()
  })

  it('validates the session list the window hands main', () => {
    const good = {
      projects: [{ id: 'p1', name: 'acme-web' }],
      sessions: [{ id: 's1', projectId: 'p1', title: '会话过期自动续期', agent: 'claude', status: 'running', action: '编辑 src/a.ts', activity: 1, branch: 'jacob/x' }],
      folders: { s1: { cwd: '/Users/me/acme', base: 'main', agentSession: '0f1e-22' } },
      roots: { p1: '/Users/me/acme' }
    }
    expect(parseWindowSessions(good)).toEqual(good)
    // A bad entry is left out, not the whole list.
    expect(parseWindowSessions({ ...good, sessions: [{ ...good.sessions[0], status: 'busy' }] })?.sessions).toEqual([])
    expect(parseWindowSessions({ ...good, sessions: [{ ...good.sessions[0], agent: 'rm' }] })?.sessions).toEqual([])
    const relative = parseWindowSessions({ ...good, folders: { s1: { cwd: '~/wt/x' } } })
    expect(relative?.folders).toEqual({})
    expect(relative?.sessions).toEqual([])
    expect(parseWindowSessions({ ...good, roots: { p1: '/a/../b' } })?.roots).toEqual({})
    expect(parseWindowSessions({ ...good, sessions: 'all' })).toBeNull()
  })
})

describe('exits from the phone', () => {
  it('reads exits, ship actions and archive, and refuses what is off', () => {
    expect(parsePhoneRequest({ id: 1, type: 'exits', session: 's1' })).toEqual({ id: 1, type: 'exits', session: 's1' })
    expect(parsePhoneRequest({ id: 2, type: 'archive', session: 's1' })).toEqual({ id: 2, type: 'archive', session: 's1' })
    expect(parsePhoneRequest({ id: 3, type: 'ship', session: 's1', action: { do: 'start', exit: 'pr' } })).toEqual({ id: 3, type: 'ship', session: 's1', action: { do: 'start', exit: 'pr' } })
    expect(parsePhoneRequest({ id: 4, type: 'ship', session: 's1', action: { do: 'edit', texts: { commit: 'feat: x', draft: true, other: 1 } } })).toEqual({
      id: 4,
      type: 'ship',
      session: 's1',
      action: { do: 'edit', texts: { commit: 'feat: x', draft: true } }
    })
    expect(parsePhoneRequest({ id: 5, type: 'ship', session: 's1', action: { do: 'submit' } })?.type).toBe('ship')
    expect(parsePhoneRequest({ id: 6, type: 'ship', session: 's1', action: { do: 'start', exit: 'open-pr' } })).toBeNull()
    expect(parsePhoneRequest({ id: 7, type: 'ship', session: 's1', action: { do: 'edit', texts: {} } })).toBeNull()
    expect(parsePhoneRequest({ id: 8, type: 'ship', session: 's1', action: { do: 'edit', texts: { title: 'x'.repeat(501) } } })).toBeNull()
    expect(parsePhoneRequest({ id: 9, type: 'ship', session: 's1', action: { do: 'force-push' } })).toBeNull()
  })

  it('carries an exit in progress in the session list, and drops a session whose one is malformed', () => {
    const ship = {
      kind: 'pr',
      title: '创建 PR',
      agent: 'Claude Code',
      stage: 'glance',
      steps: [{ id: 'write', label: 'Claude Code 写标题和正文', state: 'done' }, { id: 'push', label: '推送 jacob/x', state: 'pending' }],
      texts: { commit: '', title: 'feat: refresh', body: '…', draft: false },
      fields: ['title', 'body', 'draft'],
      submitLabel: '推送并创建 PR',
      submitBlocker: null,
      error: null
    }
    const list = {
      projects: [{ id: 'p1', name: 'acme' }],
      sessions: [{ id: 's1', projectId: 'p1', title: 't', agent: 'claude', status: 'idle', activity: 1, ship, shipNotice: '已创建 PR #12' }],
      folders: { s1: { cwd: '/w' } },
      roots: {}
    }
    expect(parseWindowSessions(list)?.sessions[0]).toMatchObject({ ship, shipNotice: '已创建 PR #12' })
    const bad = { ...list, sessions: [{ ...list.sessions[0], ship: { ...ship, stage: 'done' } }] }
    expect(parseWindowSessions(bad)?.sessions).toEqual([])
  })
})

