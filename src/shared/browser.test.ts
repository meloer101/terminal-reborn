import { describe, expect, it } from 'vitest'
import {
  addConsoleEntry,
  EMPTY_CONSOLE,
  formatErrorsForAgent,
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

  it('formats distinct recent errors for the agent, with page-relative sources', () => {
    let summary: ConsoleSummary = EMPTY_CONSOLE
    summary = addConsoleEntry(summary, entry('error', 'Uncaught TypeError: x is undefined', 'http://localhost:5173/src/App.tsx?t=1', 12))
    summary = addConsoleEntry(summary, entry('error', 'Uncaught TypeError: x is undefined', 'http://localhost:5173/src/App.tsx?t=1', 12))
    summary = addConsoleEntry(summary, entry('error', 'Failed to load\nresource', 'https://cdn.example.com/a.js', 0))
    expect(formatErrorsForAgent(summary, 'http://localhost:5173/menu')).toBe(
      [
        '浏览器里 http://localhost:5173/menu 的控制台有 3 个错误，请看一下并修复：',
        '- Uncaught TypeError: x is undefined (src/App.tsx?t=1:12)',
        '- Failed to load ⏎ resource (https://cdn.example.com/a.js)'
      ].join('\n')
    )
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
      { pid: 200, port: 5173 },
      { pid: 300, port: 6006 }
    ])
    expect(parseLsofListen('')).toEqual([])
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

describe('portsChanged', () => {
  const a = [{ port: 5173, pid: 1, label: 'vite' }]
  it('ignores order and spots changes', () => {
    expect(portsChanged(a, [{ port: 5173, pid: 1, label: 'vite' }])).toBe(false)
    expect(portsChanged(a, [])).toBe(true)
    expect(portsChanged(a, [{ port: 5174, pid: 1, label: 'vite' }])).toBe(true)
    expect(portsChanged([...a, { port: 1, pid: 2, label: '' }], [{ port: 1, pid: 2, label: '' }, ...a])).toBe(false)
  })
})
