import { describe, expect, it } from 'vitest'
import { EMPTY_CONSOLE, type BrowserPageState } from '@shared/browser'
import { browserLayout, consoleLine, emptyHint, isOpenPort, portText, sendLabel } from './view-model'

const page = (patch: Partial<BrowserPageState> = {}): BrowserPageState => ({
  worktree: '/w',
  url: 'http://localhost:5173/',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  mobile: false,
  loadError: null,
  console: EMPTY_CONSOLE,
  ...patch
})
const vite = { port: 5173, pid: 1, host: 'localhost', label: 'vite' }

describe('browserLayout', () => {
  it('shows the bare empty state (13E) when nothing is open and no port is known', () => {
    expect(browserLayout(undefined, [])).toEqual({ ports: false, console: false, well: 'empty' })
    expect(browserLayout(page({ url: '' }), [])).toEqual({ ports: false, console: false, well: 'empty' })
  })

  it('lists found ports above the empty state', () => {
    expect(browserLayout(page({ url: '' }), [vite])).toEqual({ ports: true, console: false, well: 'empty' })
  })

  it('shows the page with both rows, or the load error without the console', () => {
    expect(browserLayout(page(), [])).toEqual({ ports: true, console: true, well: 'page' })
    expect(browserLayout(page({ loadError: 'x' }), [vite])).toEqual({ ports: true, console: false, well: 'error' })
  })
})

describe('consoleLine', () => {
  it('reports errors and warnings', () => {
    expect(consoleLine({ errors: 2, warnings: 1, recentErrors: [] }, false)).toEqual({ errors: '2 个错误', rest: '· 1 个警告' })
    expect(consoleLine({ errors: 1, warnings: 0, recentErrors: [] }, false)).toEqual({ errors: '1 个错误', rest: '' })
    expect(consoleLine({ errors: 0, warnings: 3, recentErrors: [] }, true)).toEqual({ errors: null, rest: '3 个警告' })
  })

  it('says loading or quiet otherwise', () => {
    expect(consoleLine(EMPTY_CONSOLE, true).rest).toBe('正在载入…')
    expect(consoleLine(EMPTY_CONSOLE, false).rest).toBe('控制台没有错误')
  })
})

describe('labels', () => {
  it('names the agent the errors go to', () => {
    expect(sendLabel('claude')).toBe('发给 Claude')
    expect(sendLabel('codex')).toBe('发给 Codex')
    expect(sendLabel('shell')).toBe('发到终端')
  })

  it('formats port tags and the empty hint', () => {
    expect(portText(vite)).toBe(':5173 vite')
    expect(portText({ port: 8000, pid: 2, host: 'localhost', label: '' })).toBe(':8000')
    expect(emptyHint([])).toContain('dev server')
    expect(emptyHint([vite])).toContain('端口')
  })
})

describe('isOpenPort', () => {
  it('matches the page by host and port', () => {
    expect(isOpenPort(vite, 'http://localhost:5173/menu')).toBe(true)
    expect(isOpenPort(vite, 'http://127.0.0.1:5173/')).toBe(true)
    expect(isOpenPort(vite, 'http://localhost:5174/')).toBe(false)
    const lan = { port: 3000, pid: 1, host: '192.168.1.5', label: '' }
    expect(isOpenPort(lan, 'http://192.168.1.5:3000/')).toBe(true)
    expect(isOpenPort(lan, 'http://localhost:3000/')).toBe(false)
    expect(isOpenPort(vite, '')).toBe(false)
  })
})
