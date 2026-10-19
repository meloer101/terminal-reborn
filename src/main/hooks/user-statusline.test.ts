import { describe, expect, it } from 'vitest'
import { resolveUserStatusLine, settingsCandidates } from './user-statusline'

const home = '/Users/u'
function sources(files: Record<string, unknown>, cwd = '/work/app', configDir?: string) {
  return {
    cwd,
    home,
    ...(configDir ? { configDir } : {}),
    readFile: (path: string) => (path in files ? (typeof files[path] === 'string' ? (files[path] as string) : JSON.stringify(files[path])) : null)
  }
}
const sl = (command: unknown) => ({ statusLine: { type: 'command', command } })

describe('resolveUserStatusLine', () => {
  it('follows Claude precedence: local project > project > user', () => {
    const files = {
      '/work/app/.claude/settings.local.json': sl('local.sh'),
      '/work/app/.claude/settings.json': sl('project.sh'),
      '/Users/u/.claude/settings.json': sl('user.sh')
    }
    expect(resolveUserStatusLine(sources(files))).toBe('local.sh')
    const { ['/work/app/.claude/settings.local.json']: _local, ...rest } = files
    expect(resolveUserStatusLine(sources(rest))).toBe('project.sh')
    expect(resolveUserStatusLine(sources({ '/Users/u/.claude/settings.json': sl('user.sh') }))).toBe('user.sh')
  })

  it('skips files without a statusLine, and unreadable or broken JSON', () => {
    const files = { '/work/app/.claude/settings.local.json': '{nope', '/work/app/.claude/settings.json': { model: 'x' }, '/Users/u/.claude/settings.json': sl('user.sh') }
    expect(resolveUserStatusLine(sources(files))).toBe('user.sh')
    expect(resolveUserStatusLine(sources({}))).toBeUndefined()
  })

  it('treats a higher-level statusLine that is not a usable command as the final word', () => {
    expect(resolveUserStatusLine(sources({ '/work/app/.claude/settings.json': { statusLine: null }, '/Users/u/.claude/settings.json': sl('user.sh') }))).toBeUndefined()
    expect(resolveUserStatusLine(sources({ '/Users/u/.claude/settings.json': { statusLine: { type: 'other', command: 'x' } } }))).toBeUndefined()
    expect(resolveUserStatusLine(sources({ '/Users/u/.claude/settings.json': sl('   ') }))).toBeUndefined()
  })

  it('never chains our own relay', () => {
    expect(resolveUserStatusLine(sources({ '/Users/u/.claude/settings.json': sl("/bin/sh '/A/tr-statusline.sh'") }))).toBeUndefined()
  })

  it('honours CLAUDE_CONFIG_DIR and ~ in the cwd', () => {
    expect(settingsCandidates({ cwd: '~/code/x', home, configDir: '/cfg' })).toEqual([
      '/Users/u/code/x/.claude/settings.local.json',
      '/Users/u/code/x/.claude/settings.json',
      '/cfg/settings.json'
    ])
    expect(resolveUserStatusLine(sources({ '/cfg/settings.json': sl('cfg.sh') }, '/w', '/cfg'))).toBe('cfg.sh')
  })
})
