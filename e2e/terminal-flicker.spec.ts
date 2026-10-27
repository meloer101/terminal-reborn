// Switching sessions, and the refit when a drawer finishes sliding, each used to paint one blank frame:
// both cleared the canvas inside a requestAnimationFrame, and xterm's own redraw is also a rAF, so a
// rAF queued from a rAF waits until the next frame (PRD §6.3). This records every frame with
// Page.startScreencast and counts frames whose terminal area is empty.
import { expect, test, type CDPSession, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'
import { decodePng, type Raster } from './png'

const AGENT = resolve('e2e/scale-agent.mjs')
const SHOTS = join(process.cwd(), 'test-results', 'terminal-flicker')
/** A sample this far from a screencast frame is a different moment; the terminal box would be wrong. */
const FRAME_MATCH_MS = 200
/** Light theme: a pixel with any channel below this is ink. Under 1% ink in the terminal area is a blank frame. */
const INK_CHANNEL = 200
const BLANK_INK = 0.01

interface Sample {
  perf: number
  date: number
  visible: boolean
  canvases: number
  innerWidth: number
  box: { x: number; y: number; width: number; height: number } | null
}

interface ScreencastFrameEvent {
  data: string
  sessionId: number
  metadata: { timestamp?: number }
}

interface Frame {
  /** metadata.timestamp in milliseconds (CDP reports seconds). */
  t: number
  png: Buffer
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

/** A throwaway world: fake `claude` first on the login shell's PATH, one repo and one worktree, light theme. */
function world() {
  const root = mkdtempSync(join(tmpdir(), 'tr-flicker-'))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const claudeConfig = join(root, 'claude-config')
  const profile = join(root, 'profile')
  for (const dir of [bin, zdot, claudeConfig, profile]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec '${process.execPath}' '${AGENT}' "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' })
  const projectRoot = join(root, 'proj')
  mkdirSync(join(projectRoot, 'src'), { recursive: true })
  writeFileSync(join(projectRoot, 'src', 'index.ts'), 'export const a = 1\n')
  git(projectRoot, 'init', '-q', '-b', 'main')
  git(projectRoot, 'add', '.')
  git(projectRoot, 'commit', '-qm', 'init')
  const worktree = join(root, 'proj-wt')
  git(projectRoot, 'worktree', 'add', '-q', worktree, '-b', 'flicker/wt')
  const ids = ['s-flicker-0', 's-flicker-1']
  const worktrees = [
    { id: 'w-0', projectId: 'p-0', branch: 'main', path: projectRoot, isMain: true },
    { id: 'w-1', projectId: 'p-0', branch: 'flicker/wt', path: worktree, isMain: false }
  ]
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 2,
      projects: [{ id: 'p-0', name: '闪烁项目', rootPath: projectRoot }],
      worktrees,
      sessions: ids.map((id, i) => ({
        id,
        worktreeId: `w-${i}`,
        kind: 'claude',
        title: `闪烁会话 ${i + 1}`,
        startedAt: 1,
        lastActivityAt: 1
      })),
      activeSessionId: null,
      sidebarCollapsed: false,
      rightPanel: null,
      drafts: {}
    })
  )
  // Fixed light theme so "ink" is any channel below 200. Opaque, so the terminal uses WebGL rather than the DOM renderer.
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ version: 1, appearance: { theme: 'light', terminalOpacity: 1 } }))
  const env = { ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: claudeConfig }
  return { profile, env, ids }
}

const screen = (page: Page, id: string) =>
  page.evaluate((sessionId) => {
    const hook = (globalThis as unknown as { __trTerminals?: { readScreen(sessionId: string, scrollbackLines?: number): string } }).__trTerminals
    return hook?.readScreen(sessionId, 0) ?? ''
  }, id)

/**
 * The session header is drawn on top of the terminal region (the region starts at the window's top edge).
 * Its bar is darker than the light terminal background, so a blank terminal still measures several percent
 * ink until that strip is left out.
 */
function contentRect(
  box: { x: number; y: number; width: number; height: number },
  titlebar: number
): { x: number; y: number; width: number; height: number } {
  const y = Math.max(box.y, titlebar)
  return { x: box.x, y, width: box.width, height: Math.max(0, box.y + box.height - y) }
}

/** Share of sampled pixels that are not the light background. `cssWidth` is the width the rect's coordinates are in. */
function inkRatio(raster: Raster, cssWidth: number, rect: { x: number; y: number; width: number; height: number }): number {
  if (cssWidth <= 0 || rect.width <= 0 || rect.height <= 0) return 1
  const scale = raster.width / cssWidth
  const x0 = Math.max(0, Math.floor(rect.x * scale))
  const y0 = Math.max(0, Math.floor(rect.y * scale))
  const x1 = Math.min(raster.width, Math.ceil((rect.x + rect.width) * scale))
  const y1 = Math.min(raster.height, Math.ceil((rect.y + rect.height) * scale))
  let samples = 0
  let ink = 0
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const o = (y * raster.width + x) * 4
      const r = raster.data[o] ?? 255
      const g = raster.data[o + 1] ?? 255
      const b = raster.data[o + 2] ?? 255
      samples++
      if (r < INK_CHANNEL || g < INK_CHANNEL || b < INK_CHANNEL) ink++
    }
  }
  return samples === 0 ? 1 : ink / samples
}

function nearestSample(samples: readonly Sample[], frameMs: number, clock: 'perf' | 'date'): { sample: Sample; distance: number } | null {
  let best: Sample | null = null
  let distance = Infinity
  for (const sample of samples) {
    const gap = Math.abs(sample[clock] - frameMs)
    if (gap < distance) {
      best = sample
      distance = gap
    }
  }
  return best ? { sample: best, distance } : null
}

test('switching sessions and settling the right panel never paints a blank terminal frame', async () => {
  mkdirSync(SHOTS, { recursive: true })
  const { profile, env, ids } = world()
  const app: ElectronApplication = await launchApp(env, { userDataDir: profile })
  let cdp: CDPSession | null = null
  try {
    const page = await app.firstWindow()
    await setWindowSize(app, page, 1280, 800)
    // Screen reading with the real workspace. `__TR_E2E__` would swap in the fixture sessions.
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_TERMINAL_PROBE__?: boolean }).__TR_TERMINAL_PROBE__ = true
    })
    await page.reload()
    await setWindowSize(app, page, 1280, 800)
    await expect(page.locator('[data-region="sidebar"] [data-session-id]')).toHaveCount(ids.length, { timeout: 30_000 })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light', { timeout: 15_000 })

    for (const id of ids) {
      await page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`).click()
      await expect(page.locator(`[data-region="terminal"] [data-session-id="${id}"][data-shown="true"] .xterm-screen`)).toBeVisible({
        timeout: 20_000
      })
      await expect.poll(() => screen(page, id), { timeout: 30_000 }).toContain('@@ready@@')
    }
    for (const id of ids) await page.evaluate((sessionId) => (globalThis as unknown as { tr: { pty: { write(id: string, data: string): void } } }).tr.pty.write(sessionId, 'w'), id)
    await page.waitForTimeout(4_000)
    for (const id of ids) await page.evaluate((sessionId) => (globalThis as unknown as { tr: { pty: { write(id: string, data: string): void } } }).tr.pty.write(sessionId, 'i'), id)
    await page.waitForTimeout(6_000)
    for (const id of ids) {
      expect((await screen(page, id)).length, `${id} never filled the screen`).toBeGreaterThan(200)
    }

    const titlebar = await page.evaluate(() => {
      const n = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--titlebar-height'))
      return Number.isFinite(n) ? n : 0
    })
    const terminal = page.locator('[data-region="terminal"]')
    const before = await terminal.boundingBox()
    expect(before).not.toBeNull()
    const beforeContent = contentRect({ x: 0, y: before!.y, width: before!.width, height: before!.height }, titlebar)
    const pre = decodePng(await page.screenshot({ path: join(SHOTS, 'before.png'), clip: before! }))
    const preInk = inkRatio(pre, before!.width, { x: beforeContent.x, y: beforeContent.y - before!.y, width: beforeContent.width, height: beforeContent.height })
    expect(preInk, `terminal ink before the run was ${(preInk * 100).toFixed(2)}%`).toBeGreaterThan(0.05)

    await page.evaluate(() => {
      const bag = globalThis as unknown as { __flickerFrames?: Sample[] }
      bag.__flickerFrames = []
      const sample = (): void => {
        const pane = document.querySelector<HTMLElement>('[data-region="terminal"] [data-session-id][data-shown="true"]')
        const rect = document.querySelector('[data-region="terminal"]')?.getBoundingClientRect()
        bag.__flickerFrames?.push({
          perf: performance.now(),
          date: Date.now(),
          visible: pane !== null && pane.getBoundingClientRect().width > 0 && pane.getBoundingClientRect().height > 0,
          canvases: pane?.querySelectorAll('.xterm-screen canvas').length ?? 0,
          innerWidth: window.innerWidth,
          box: rect && rect.width > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
        })
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })

    const frames: Frame[] = []
    cdp = await page.context().newCDPSession(page)
    cdp.on('Page.screencastFrame', (event: ScreencastFrameEvent) => {
      frames.push({ t: (event.metadata.timestamp ?? 0) * 1000, png: Buffer.from(event.data, 'base64') })
      void cdp?.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
    })
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 4096, maxHeight: 4096 })

    // Eight switches, then four open/close cycles of the right panel. The gaps are long enough for the blank frame to land.
    for (let i = 0; i < 8; i++) {
      const id = ids[i % 2 === 0 ? 0 : 1]
      await page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`).click()
      await page.waitForTimeout(900)
    }
    const toggle = page.locator('[aria-label="右侧栏"] button').first()
    for (let i = 0; i < 4; i++) {
      await toggle.click()
      await page.waitForTimeout(1200)
    }
    await page.waitForTimeout(400)
    await cdp.send('Page.stopScreencast')

    const samples = await page.evaluate(() => (globalThis as unknown as { __flickerFrames: Sample[] }).__flickerFrames)
    const anchor = samples[0]
    expect(anchor, 'the per-frame probe recorded nothing').toBeTruthy()
    const first = frames[0]
    expect(first, 'screencast produced no frames').toBeTruthy()
    const clock: 'perf' | 'date' = Math.abs(first!.t - anchor!.perf) <= Math.abs(first!.t - anchor!.date) ? 'perf' : 'date'

    const blanks: string[] = []
    let saved = 0
    let unmatched = 0
    for (const [index, frame] of frames.entries()) {
      const match = nearestSample(samples, frame.t, clock)
      const box = match?.sample.box
      if (!match || match.distance > FRAME_MATCH_MS || !box) {
        unmatched++
        continue
      }
      const rect = contentRect(box, titlebar)
      if (rect.height <= 0 || rect.width <= 0) {
        unmatched++
        continue
      }
      const raster = decodePng(frame.png)
      const ratio = inkRatio(raster, match.sample.innerWidth, rect)
      if (ratio < BLANK_INK) {
        if (saved < 4) {
          writeFileSync(join(SHOTS, `blank-${index}.png`), frame.png)
          saved++
        }
        blanks.push(`#${index} t=${frame.t.toFixed(0)} ink=${(ratio * 100).toFixed(3)}% canvases=${match.sample.canvases}`)
      }
    }
    expect(unmatched, `${unmatched} screencast frames had no terminal box within ${FRAME_MATCH_MS} ms`).toBe(0)
    expect(frames.length, 'screencast dropped almost every frame').toBeGreaterThan(60)
    expect(blanks, `blank terminal frames (${blanks.length}):\n${blanks.join('\n')}`).toEqual([])

    const gaps = samples.filter((sample) => sample.visible && sample.canvases === 0)
    expect(gaps, `visible pane with no canvas (${gaps.length}), first at ${gaps[0]?.perf ?? ''}`).toEqual([])
  } finally {
    await cdp?.detach().catch(() => {})
    await app.close()
  }
})
