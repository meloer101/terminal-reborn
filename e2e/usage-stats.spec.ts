// 设置 · 额度's token statistics (PRD F11 · 额度页, Figma 69″): the app reads Claude and Codex logs from a fixture home
// (TR_USAGE_STATS_HOME) through its worker, and the page shows week / month / year, the heatmap and the shares.
// Claude's logs start 40 days ago and Codex's 100 days ago, so the year view has empty months and both start dates.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'usage-stats')
const DAY = 24 * 60 * 60_000
const WITHIN = { timeout: 20_000 }

function writeFixture(home: string): void {
  const now = Date.now()
  const at = (daysAgo: number, hour: number): string => {
    const d = new Date(now - daysAgo * DAY)
    d.setHours(hour, 15, 0, 0)
    return d.toISOString()
  }
  const claudeDir = join(home, '.claude', 'projects', '-code-wavi')
  mkdirSync(claudeDir, { recursive: true })
  const claude: string[] = []
  for (let d = 0; d < 40; d++) {
    if (d % 6 === 5) continue
    for (const hour of [10, 15, 22]) {
      claude.push(
        JSON.stringify({
          type: 'assistant',
          timestamp: at(d, hour),
          sessionId: `s${d}`,
          cwd: d % 3 ? join(home, 'code', 'wavi') : join(home, 'code', 'acme-web'),
          message: { id: `m${d}-${hour}`, model: 'claude-opus-5-5', usage: { input_tokens: 2_000, cache_creation_input_tokens: 40_000, cache_read_input_tokens: 600_000 + d * 9_000, output_tokens: 8_000 } }
        })
      )
    }
  }
  writeFileSync(join(claudeDir, 'a.jsonl'), claude.join('\n') + '\n')
  const codexDir = join(home, '.codex', 'sessions', '2026', '01', '01')
  mkdirSync(codexDir, { recursive: true })
  for (let d = 0; d < 100; d += 3) {
    const lines = [
      { type: 'session_meta', timestamp: at(d, 11), payload: { id: `c${d}`, cwd: join(home, 'code', 'api') } },
      { type: 'turn_context', timestamp: at(d, 11), payload: { model: 'gpt-6-sol' } },
      { type: 'event_msg', timestamp: at(d, 11), payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 300_000 }, last_token_usage: { input_tokens: 290_000, cached_input_tokens: 250_000, output_tokens: 10_000, total_tokens: 300_000 } } } }
    ]
    writeFileSync(join(codexDir, `rollout-${d}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  }
}

test.describe('设置 · 额度 statistics', () => {
  let app: ElectronApplication
  let page: Page

  const setTheme = async (theme: 'dark' | 'light') => {
    await page.evaluate(
      (t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }),
      theme
    )
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  }
  const shoot = async (name: string) => {
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) }).catch(() => undefined)
    }
    await setTheme('dark')
  }

  test.beforeAll(async () => {
    const home = mkdtempSync(join(tmpdir(), 'tr-usage-home-'))
    writeFixture(home)
    app = await launchApp({ TR_USAGE_STATS_HOME: home })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 960)
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('month, week and year from the agents’ own logs, each agent from its first log', async () => {
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: /^额度/ }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    const stats = dialog.getByTestId('usage-stats')
    await expect(stats).toBeVisible(WITHIN)
    const bars = stats.getByTestId('usage-bar')
    // 月: 30 days, all on record (Claude and Codex both logged before).
    await expect(dialog.getByRole('tab', { name: '月' })).toHaveAttribute('aria-selected', 'true')
    await expect(bars).toHaveCount(30)
    await expect(stats.getByTestId('usage-kpis')).toContainText(/Token[\d,.]+(亿|万)比上月 [+-]\d+%/)
    await expect(stats.getByTestId('usage-by-agent')).toContainText(/Claude Code.*Codex/)
    await expect(stats.getByTestId('usage-by-project')).toContainText(/wavi.*acme-web.*api|wavi.*api.*acme-web/)
    await bars.nth(28).hover()
    await expect(stats.getByRole('tooltip')).toContainText(/月 \d+ 日 周.+Claude Code.+Codex/)
    await shoot('69-month')
    await stats.getByTestId('usage-by-project').scrollIntoViewIfNeeded()
    await shoot('69-month-bottom')
    await dialog.getByRole('heading', { name: '额度' }).scrollIntoViewIfNeeded()

    await dialog.getByRole('tab', { name: '周' }).click()
    await expect(bars).toHaveCount(7)
    await expect(bars.last()).toHaveText('今天')
    await shoot('69-week')

    // 年: months before Codex's first log are empty frames; both agents say where they start.
    await dialog.getByRole('tab', { name: '年' }).click()
    await expect(bars).toHaveCount(12)
    await expect(stats.locator('[data-testid="usage-bar"] [class*="noRecord"]').first()).toBeVisible()
    await expect(stats.getByText(/^\d+\/\d+ 起$/).first()).toBeVisible()
    await expect(stats.getByTestId('usage-kpis')).toContainText('最长连续')
    const heat = stats.getByTestId('usage-heatmap')
    expect(await heat.locator('[data-level="none"]').count()).toBeGreaterThan(200)
    await shoot('69-year')
    await page.keyboard.press('Escape')
  })
})
