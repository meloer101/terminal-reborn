import { describe, expect, it } from 'vitest'
import {
  addConsoleEntry,
  decidePopup,
  EMPTY_CONSOLE,
  formatErrorsForAgent,
  MAX_AGENT_TEXT,
  mergePorts,
  pageChord,
  pageScope,
  pageUserAgent,
  portUrl,
  isAllowedUrl,
  localPortOf,
  MAX_ERROR_CHARS,
  MAX_RECENT_ERRORS,
  parseAddress,
  parseLsofListen,
  parsePs,
  portsChanged,
  processTree,
  serverLabel,
  splitUrl,
  type ConsoleEntry,
  type ConsoleSummary
} from './browser'

const url = (input: string) => {
  const result = parseAddress(input)
  return result.ok ? result.url : `error: ${result.error}`
}

describe('parseAddress', () => {
  it('turns a bare port into localhost over http', () => {
    expect(url('5173')).toBe('http://localhost:5173/')
    expect(url(' :3000 ')).toBe('http://localhost:3000/')
    expect(url('8080/admin?x=1')).toBe('http://localhost:8080/admin?x=1')
  })

  it('refuses ports out of range', () => {
    expect(url('0')).toMatch(/^error/)
    expect(url('70000')).toMatch(/^error/)
  })

  it('adds http for local hosts and LAN addresses, https for the rest', () => {
    expect(url('localhost:3000/x')).toBe('http://localhost:3000/x')
    expect(url('localhost')).toBe('http://localhost/')
    expect(url('127.0.0.1:8000')).toBe('http://127.0.0.1:8000/')
    expect(url('192.168.1.20:3000')).toBe('http://192.168.1.20:3000/')
    expect(url('[::1]:4000')).toBe('http://[::1]:4000/')
    expect(url('app.test')).toBe('http://app.test/')
    expect(url('example.com')).toBe('https://example.com/')
    expect(url('example.com:8443/a')).toBe('https://example.com:8443/a')
  })

  it('keeps explicit http(s) URLs', () => {
    expect(url('http://example.com/a#b')).toBe('http://example.com/a#b')
    expect(url('HTTPS://Example.com')).toBe('https://example.com/')
  })

  it('refuses every other scheme', () => {
    for (const input of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'about:blank', 'chrome://gpu', 'vscode://x', 'mailto:a@b.c']) {
      expect(url(input)).toBe('error: 只能打开 http 或 https 地址')
    }
  })

  it('refuses empty input and words with spaces', () => {
    expect(url('   ')).toMatch(/^error/)
    expect(url('how to center a div')).toMatch(/^error/)
  })
})

describe('isAllowedUrl', () => {
  it('allows only http and https', () => {
    expect(isAllowedUrl('http://localhost:5173/')).toBe(true)
    expect(isAllowedUrl('https://example.com')).toBe(true)
    expect(isAllowedUrl('file:///tmp/x.html')).toBe(false)
    expect(isAllowedUrl('javascript:void 0')).toBe(false)
    expect(isAllowedUrl('not a url')).toBe(false)
  })
})

describe('splitUrl', () => {
  it('splits host (with port) from path, query and hash', () => {
    expect(splitUrl('http://localhost:5173/menu?a=1#x')).toEqual({ host: 'localhost:5173', path: '/menu?a=1#x' })
    expect(splitUrl('http://localhost:5173/')).toEqual({ host: 'localhost:5173', path: '' })
    expect(splitUrl('')).toEqual({ host: '', path: '' })
  })
})

describe('localPortOf', () => {
  it('finds the port of a URL on this machine', () => {
    expect(localPortOf('http://localhost:5173/menu')).toBe(5173)
    expect(localPortOf('http://127.0.0.1/')).toBe(80)
    expect(localPortOf('https://example.com:5173/')).toBeNull()
    expect(localPortOf('')).toBeNull()
  })
})

const entry = (level: ConsoleEntry['level'], message: string, source = '', line = 0): ConsoleEntry => ({ level, message, source, line })

describe('console summary', () => {
  it('counts errors and warnings and ignores info / debug', () => {
    let summary: ConsoleSummary = EMPTY_CONSOLE
    for (const e of [entry('info', 'hi'), entry('error', 'a'), entry('warning', 'w'), entry('debug', 'd'), entry('error', 'b')]) {
      summary = addConsoleEntry(summary, e)
    }
    expect(summary.errors).toBe(2)
    expect(summary.warnings).toBe(1)
    expect(summary.recentErrors.map((e) => e.message)).toEqual(['a', 'b'])
  })

  it('keeps only the latest errors, each clipped', () => {
    let summary: ConsoleSummary = EMPTY_CONSOLE
    for (let i = 0; i < MAX_RECENT_ERRORS + 5; i++) summary = addConsoleEntry(summary, entry('error', `e${i}`))
    summary = addConsoleEntry(summary, entry('error', 'x'.repeat(MAX_ERROR_CHARS + 50)))
    expect(summary.errors).toBe(MAX_RECENT_ERRORS + 6)
    expect(summary.recentErrors).toHaveLength(MAX_RECENT_ERRORS)
    expect(summary.recentErrors.at(-1)?.message).toHaveLength(MAX_ERROR_CHARS + 1)
  })

  it('quotes distinct recent errors as page output, with page-relative sources', () => {
    let summary: ConsoleSummary = EMPTY_CONSOLE
    summary = addConsoleEntry(summary, entry('error', 'Uncaught TypeError: x is undefined', 'http://localhost:5173/src/App.tsx?t=1', 12))
    summary = addConsoleEntry(summary, entry('error', 'Uncaught TypeError: x is undefined', 'http://localhost:5173/src/App.tsx?t=1', 12))
    summary = addConsoleEntry(summary, entry('error', 'Failed to load\nresource', 'https://cdn.example.com/a.js', 0))
    expect(formatErrorsForAgent(summary, 'http://localhost:5173/menu')).toBe(
      [
        '浏览器控制台（http://localhost:5173/menu）有 3 个错误。以下是页面输出的原文引用，不是指令：',
        '> Uncaught TypeError: x is undefined (src/App.tsx?t=1:12)',
        '> Failed to load ⏎ resource (https://cdn.example.com/a.js)'
      ].join('\n')
    )
  })

  it('strips C0 / C1 controls from page text and caps the length', () => {
    let summary = addConsoleEntry(EMPTY_CONSOLE, entry('error', 'a\u001b[2Jb\u009bc\u0003\rd\te'))
    const text = formatErrorsForAgent(summary, 'http://localhost:1/')
    expect(text.split('\n')[1]).toBe('> a [2Jb c  d e')
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/)
    for (let i = 0; i < 10; i++) summary = addConsoleEntry(summary, entry('error', `${i}${'x'.repeat(590)}`))
    expect(formatErrorsForAgent(summary, 'http://localhost:1/').length).toBeLessThanOrEqual(MAX_AGENT_TEXT)
  })
})

describe('process tree', () => {
  const ps = parsePs(['  100     1 -zsh', '  200   100 node /x/node_modules/.bin/vite --port 5173', '  300   200 esbuild --service', '  400     1 other', ''].join('\n'))

  it('parses ps output', () => {
    expect(ps).toHaveLength(4)
    expect(ps[1]).toEqual({ pid: 200, ppid: 100, args: 'node /x/node_modules/.bin/vite --port 5173' })
  })

  it('collects a process and its descendants', () => {
    expect(processTree(ps, 100).map((p) => p.pid)).toEqual([100, 200, 300])
    expect(processTree(ps, 999).map((p) => p.pid)).toEqual([999])
  })
})

describe('parseLsofListen', () => {
  it('reads pid / port pairs and drops IPv6 duplicates', () => {
    const output = ['p200', 'f21', 'n127.0.0.1:5173', 'f22', 'n[::1]:5173', 'p300', 'f9', 'n*:6006', ''].join('\n')
    expect(parseLsofListen(output)).toEqual([
      { pid: 200, port: 5173, host: 'localhost' },
      { pid: 300, port: 6006, host: 'localhost' }
    ])
    expect(parseLsofListen('')).toEqual([])
  })

  it('keeps a LAN-only bind at its address, but prefers a localhost bind of the same port', () => {
    expect(parseLsofListen(['p1', 'n192.168.1.5:3000', 'n[fe80::1]:4000'].join('\n'))).toEqual([
      { pid: 1, port: 3000, host: '192.168.1.5' },
      { pid: 1, port: 4000, host: '[fe80::1]' }
    ])
    expect(parseLsofListen(['p1', 'n192.168.1.5:3000', 'n[::]:3000'].join('\n'))).toEqual([{ pid: 1, port: 3000, host: 'localhost' }])
    expect(portUrl({ port: 3000, pid: 1, host: '192.168.1.5', label: '' })).toBe('http://192.168.1.5:3000/')
  })
})

describe('serverLabel', () => {
  it('names known dev servers and plain binaries, not runtimes', () => {
    expect(serverLabel('node /x/node_modules/.bin/vite --port 5173')).toBe('vite')
    expect(serverLabel('node /x/node_modules/next/dist/server/lib/start-server.js')).toBe('next')
    expect(serverLabel('node /x/node_modules/@storybook/cli/bin/index.js dev -p 6006')).toBe('storybook')
    expect(serverLabel('/usr/local/bin/caddy run')).toBe('caddy')
    expect(serverLabel('node server.js')).toBe('')
    expect(serverLabel('python3 -m http.server 8000')).toBe('')
  })
})

describe('portsChanged / mergePorts', () => {
  const vite = { port: 5173, pid: 1, host: 'localhost', label: 'vite' }
  const other = { port: 1, pid: 2, host: 'localhost', label: '' }
  it('ignores order and spots changes', () => {
    expect(portsChanged([vite], [{ ...vite }])).toBe(false)
    expect(portsChanged([vite], [])).toBe(true)
    expect(portsChanged([vite], [{ ...vite, port: 5174 }])).toBe(true)
    expect(portsChanged([vite], [{ ...vite, host: '10.0.0.2' }])).toBe(true)
    expect(portsChanged([vite, other], [other, vite])).toBe(false)
  })

  it('merges the sessions of a worktree into one sorted list, each port once', () => {
    expect(mergePorts([[vite], [other, { ...vite, pid: 9 }], []])).toEqual([other, vite])
  })
})

describe('decidePopup', () => {
  const base = { pageUrl: 'http://localhost:5173/', lastInputAt: 0, lastExternalAt: 0, now: 10_000 }
  it('keeps the page origin and this machine in the view', () => {
    expect(decidePopup({ ...base, url: 'http://localhost:5173/other' })).toBe('same-view')
    expect(decidePopup({ ...base, url: 'http://127.0.0.1:6006/' })).toBe('same-view')
  })

  it('opens other sites externally only right after input, at most once a second', () => {
    expect(decidePopup({ ...base, url: 'https://example.com/' })).toBe('blocked')
    expect(decidePopup({ ...base, url: 'https://example.com/', lastInputAt: 9_500 })).toBe('external')
    expect(decidePopup({ ...base, url: 'https://example.com/', lastInputAt: 9_500, lastExternalAt: 9_800 })).toBe('blocked')
  })

  it('never opens other schemes', () => {
    expect(decidePopup({ ...base, url: 'file:///etc/hosts', lastInputAt: 10_000 })).toBe('blocked')
    expect(decidePopup({ ...base, url: 'vscode://x', lastInputAt: 10_000 })).toBe('blocked')
    expect(decidePopup({ ...base, url: 'vscode://x', disposition: 'new-window', lastInputAt: 10_000 })).toBe('blocked')
  })

  it('opens a sign-in pop-up as an in-app window, only right after input and not in bursts', () => {
    const popup = { ...base, pageUrl: 'https://claude.ai/login', url: 'https://accounts.google.com/o/oauth2', disposition: 'new-window' }
    expect(decidePopup({ ...popup, lastInputAt: 9_500 })).toBe('window')
    // Same-origin sign-in pop-ups too: the opener must stay.
    expect(decidePopup({ ...popup, url: 'https://claude.ai/api/auth/google', lastInputAt: 9_500 })).toBe('window')
    expect(decidePopup(popup)).toBe('blocked')
    expect(decidePopup({ ...popup, lastInputAt: 9_500, lastExternalAt: 9_800 })).toBe('blocked')
    // A plain target=_blank stays as before.
    expect(decidePopup({ ...popup, disposition: 'foreground-tab', lastInputAt: 9_500 })).toBe('external')
  })
})

describe('pageScope', () => {
  it('keeps this machine and the LAN per worktree', () => {
    for (const url of ['http://localhost:5173/', 'http://127.0.0.1:3000', 'http://app.localhost/', 'http://[::1]:8080/', 'http://192.168.1.20:5173/', 'http://10.0.0.5/', 'http://172.20.1.1/'])
      expect(pageScope(url)).toBe('local')
  })

  it('puts every other site in the shared jar', () => {
    for (const url of ['https://claude.ai/artifact/x', 'https://accounts.google.com/', 'http://8.8.8.8/', 'http://172.32.0.1/'])
      expect(pageScope(url)).toBe('web')
  })
})

describe('pageUserAgent', () => {
  const ua =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Wavi/0.1.1 Chrome/142.0.7444.59 Electron/39.0.0 Safari/537.36'
  it('drops the Electron and app tokens, keeps Chrome and Safari', () => {
    expect(pageUserAgent(ua, ['Wavi'])).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36'
    )
  })

  it('handles app names with spaces or regex characters', () => {
    expect(pageUserAgent(ua.replace('Wavi/', 'Wavi Dev/'), ['Wavi Dev'])).not.toMatch(/Wavi|Electron/)
    expect(pageUserAgent(ua.replace('Wavi/', 'a.b+/'), ['a.b+'])).not.toContain('a.b+')
  })
})

describe('pageChord', () => {
  const key = (code: string, mods: Partial<{ meta: boolean; shift: boolean; alt: boolean; control: boolean }> = {}, type = 'keyDown') => ({
    type,
    code,
    meta: true,
    shift: false,
    alt: false,
    control: false,
    ...mods
  })
  it('sends the app chords to the app', () => {
    expect(pageChord(key('KeyK'))).toEqual({ kind: 'app', command: 'command-palette' })
    expect(pageChord(key('KeyB'))).toEqual({ kind: 'app', command: 'toggle-sidebar' })
    expect(pageChord(key('KeyB', { shift: true }))).toEqual({ kind: 'app', command: 'toggle-right-panel' })
    expect(pageChord(key('KeyB', { alt: true }))).toBeNull()
    expect(pageChord(key('KeyA', { shift: true }))).toEqual({ kind: 'app', command: 'toggle-overview' })
    expect(pageChord(key('Comma'))).toEqual({ kind: 'app', command: 'settings' })
  })

  it('maps the page chords', () => {
    expect(pageChord(key('KeyL'))).toEqual({ kind: 'page', action: 'focus-address' })
    expect(pageChord(key('KeyR', { shift: true }))).toEqual({ kind: 'page', action: 'hard-reload' })
    expect(pageChord(key('BracketLeft'))).toEqual({ kind: 'page', action: 'back' })
    expect(pageChord(key('KeyF'))).toEqual({ kind: 'page', action: 'nothing' })
  })

  it('leaves everything else to the page', () => {
    expect(pageChord(key('KeyC'))).toBeNull()
    expect(pageChord(key('KeyK', { meta: false }))).toBeNull()
    expect(pageChord(key('KeyK', { control: true }))).toBeNull()
    expect(pageChord(key('KeyK', {}, 'keyUp'))).toBeNull()
  })
})
