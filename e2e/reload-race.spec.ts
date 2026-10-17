// A reload while the shell is still starting must not hand the new page a dead shell: with the pty daemon the late
// `spawned` report of the gone page's spawn used to be treated as an orphan and killed, just as the page reattached.
import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

interface Hook { readScreen(sessionId: string, n?: number): string }
test.describe.configure({ mode: 'parallel' })
for (let r = 0; r < 6; r++) {
  test(`a reload ${r * 25} ms after launch keeps the shell alive`, async () => {
    const profile = mkdtempSync(join(tmpdir(), 'tr-probe-reload-'))
    const project = mkdtempSync(join(tmpdir(), 'tr-probe-proj-'))
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'workspace.json'), JSON.stringify({
      version: 2, projects: [{ id: 'p1', name: 'p', rootPath: project }],
      worktrees: [{ id: 'w1', projectId: 'p1', branch: '', path: project, isMain: true }],
      sessions: [{ id: 's-shell', worktreeId: 'w1', kind: 'shell', title: 'Shell', startedAt: 1, lastActivityAt: 1 }],
      activeSessionId: 's-shell', sidebarCollapsed: false, rightPanel: null, drafts: {}
    }))
    const app = await launchApp({}, { userDataDir: profile })
    const page = await app.firstWindow()
    await page.waitForTimeout(r * 25)
    await page.addInitScript(() => { (globalThis as unknown as { __TR_TERMINAL_PROBE__: boolean }).__TR_TERMINAL_PROBE__ = true })
    await page.reload()
    // Long enough for the reattach (or a wrongly reported exit) to land.
    await page.waitForTimeout(2500)
    const s = await page.evaluate(() => (globalThis as unknown as { __trTerminals?: Hook }).__trTerminals?.readScreen('s-shell', 50) ?? '')
    await app.close()
    expect(s).not.toContain('进程已退出')
  })
}
