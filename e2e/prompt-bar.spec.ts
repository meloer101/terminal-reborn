// PromptBar with injected prompts (the hooks that produce real ones are a separate track).
// Question answers are keystrokes: the fixture session is a plain shell running `cat -v`, which echoes them.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'

const SESSION = 's-cookie'

interface Hook {
  inject(prompt: unknown): void
  log: Array<Record<string, unknown>>
}
interface TerminalHook {
  readScreen(sessionId: string, scrollbackLines?: number): string
}

let app: ElectronApplication
let page: Page
let seq = 0

const focusTerminal = () => page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"]`).click()
const bar = () => page.locator('[data-region="prompt-bar"]')
const composer = () => page.getByRole('textbox', { name: '输入框' })
const screen = () =>
  page.evaluate(
    (id) => (globalThis as unknown as { __trTerminals: TerminalHook }).__trTerminals.readScreen(id, 200),
    SESSION
  )
const log = () => page.evaluate(() => (globalThis as unknown as { __trPrompts: Hook }).__trPrompts.log)
const inject = (prompt: Record<string, unknown>) =>
  page.evaluate((p) => (globalThis as unknown as { __trPrompts: Hook }).__trPrompts.inject(p), prompt)
const setTheme = (theme: 'dark' | 'light') =>
  page.evaluate((t) => {
    const doc = (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document
    doc.documentElement.dataset.theme = t
  }, theme)

function permission(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'permission',
    id: `perm-${++seq}`,
    sessionId: SESSION,
    tool: 'Bash',
    input: { command: 'pnpm prisma migrate dev --name session_cookie' },
    summary: '运行 pnpm prisma migrate dev',
    canAllowAlways: true,
    createdAt: Date.now(),
    ...over
  }
}

function question(questions: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'question', id: `q-${++seq}`, sessionId: SESSION, questions, createdAt: Date.now(), ...over }
}

const colour = {
  header: 'Colour',
  question: '用哪种配色？',
  multiSelect: false,
  options: [{ label: 'Red', description: '暖色' }, { label: 'Green' }, { label: 'Blue' }]
}
const fruit = {
  header: 'Fruit',
  question: '选择水果',
  multiSelect: true,
  options: [{ label: 'Apple' }, { label: 'Banana' }, { label: 'Cherry' }]
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

test.beforeAll(async () => {
  app = await launchApp()
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await expect.poll(() => screen(), { timeout: 20_000 }).not.toBe('')
  await expect(composer()).toBeEnabled()
  // `cat -v` echoes every key (escape sequences as ^[[B), so question answers can be read off the screen.
  await page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"]`).click()
  await page.keyboard.type('cat -v')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
})

test.afterAll(async () => {
  await app.close()
})

test('permission bar shows the request; screenshots in both themes', async () => {
  await expect(bar()).toHaveCount(0)
  await inject(permission())
  await expect(bar()).toBeVisible()
  await expect(bar()).toContainText('Claude 请求运行命令')
  await expect(bar()).toContainText('pnpm prisma migrate dev --name session_cookie')
  await expect(bar().getByRole('button')).toHaveText(['1允许一次', '2总是允许', '3拒绝'])
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `test-results/prompt-bar-permission-${theme}.png` })
  }
  await setTheme('dark')
  await bar().getByRole('button', { name: '允许一次' }).click()
  await expect(bar()).toHaveCount(0)
})

test('clicking a permission button reports the right decision', async () => {
  for (const [name, decision] of [
    ['拒绝', 'deny'],
    ['总是允许', 'allow-always']
  ] as const) {
    const p = permission()
    await inject(p)
    await bar().getByRole('button', { name }).click()
    await expect(bar()).toHaveCount(0)
    expect((await log()).at(-1)).toMatchObject({ kind: 'permission', id: p['id'], decision })
  }
  // First test's click is in the log too.
  expect((await log())[0]).toMatchObject({ kind: 'permission', decision: 'allow-once' })
})

test('总是允许 is hidden when the agent offered no rule', async () => {
  await inject(permission({ canAllowAlways: false }))
  await expect(bar().getByRole('button')).toHaveText(['1允许一次', '2拒绝'])
  await bar().getByRole('button', { name: /拒绝/ }).click()
  await expect(bar()).toHaveCount(0)
})

test('several queued requests show 1 / N and are answered in order', async () => {
  const first = permission()
  const second = permission({ tool: 'Edit', input: { file_path: '/repo/src/auth.ts' } })
  await inject(first)
  await inject(second)
  await expect(bar()).toContainText('1 / 2')
  await expect(bar()).toContainText('Claude 请求运行命令')
  await composer().click()
  await page.keyboard.press('1')
  await expect(bar()).toContainText('Claude 请求修改文件')
  await expect(bar()).not.toContainText('1 / 2')
  expect((await log()).at(-1)).toMatchObject({ id: first['id'], decision: 'allow-once' })
  await page.keyboard.press('3')
  await expect(bar()).toHaveCount(0)
  expect((await log()).at(-1)).toMatchObject({ id: second['id'], decision: 'deny' })
})

test('digit keys choose while the composer is empty; ⌥digits when it holds text', async () => {
  const p = permission()
  await inject(p)
  await composer().fill('草稿')
  await composer().focus()
  // A plain digit is just text now.
  await page.keyboard.press('2')
  await expect(composer()).toHaveValue('草稿2')
  await expect(bar()).toBeVisible()
  // ⌥2 answers and leaves the draft alone.
  await page.keyboard.press('Alt+2')
  await expect(bar()).toHaveCount(0)
  await expect(composer()).toHaveValue('草稿2')
  expect((await log()).at(-1)).toMatchObject({ id: p['id'], decision: 'allow-always' })

  await composer().fill('')
  const q = permission()
  await inject(q)
  await composer().focus()
  await page.keyboard.press('3')
  await expect(bar()).toHaveCount(0)
  await expect(composer()).toHaveValue('')
  expect((await log()).at(-1)).toMatchObject({ id: q['id'], decision: 'deny' })
})

test('digit keys also work with the terminal focused', async () => {
  const p = permission()
  await inject(p)
  await page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"]`).click()
  await page.keyboard.press('1')
  await expect(bar()).toHaveCount(0)
  expect((await log()).at(-1)).toMatchObject({ id: p['id'], decision: 'allow-once' })
})

test('Esc does not dismiss the bar; it returns focus to the composer', async () => {
  await inject(question([colour]))
  await page.keyboard.press('4') // 其他… opens the free-text field
  const field = page.getByRole('textbox', { name: '其他回答' })
  await expect(field).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(bar()).toBeVisible()
  await expect(composer()).toBeFocused()
  // clean up: answer with a click so later tests start empty
  await bar().getByRole('button', { name: /Green/ }).click()
  await expect(bar()).toHaveCount(0)
})

test('single-select question: render, click answers with the option digit', async () => {
  const q = question([colour])
  await inject(q)
  await expect(bar()).toContainText('用哪种配色？')
  await expect(bar()).toContainText('Colour')
  await expect(bar().getByRole('button')).toHaveText(['1Red暖色', '2Green', '3Blue', '4其他…'])
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `test-results/prompt-bar-question-${theme}.png` })
  }
  await setTheme('dark')
  await focusTerminal()
  await page.keyboard.type('mark-')
  await bar().getByRole('button', { name: /Blue/ }).click()
  await expect(bar()).toHaveCount(0)
  expect((await log()).at(-1)).toMatchObject({ kind: 'question', id: q['id'], selection: { kind: 'single', index: 2 } })
  await expect.poll(screen).toMatch(/mark-3/)
})

test('free-text answer: other field + Enter sends 4, the text, Enter', async () => {
  const q = question([colour])
  await inject(q)
  await composer().focus()
  await page.keyboard.press('4')
  const field = page.getByRole('textbox', { name: '其他回答' })
  await expect(field).toBeFocused()
  // digits are text inside the field
  await field.fill('teal 5')
  await field.press('Enter')
  await expect(bar()).toHaveCount(0)
  expect((await log()).at(-1)).toMatchObject({ selection: { kind: 'other', text: 'teal 5' } })
  await expect.poll(screen, { timeout: 10_000 }).toMatch(/4teal 5/)
})

test('multi-select question: toggles, other text, 提交 sends toggles → arrows → text → Submit row', async () => {
  const q = question([fruit])
  await inject(q)
  const submit = bar().getByRole('button', { name: '提交' })
  await expect(submit).toBeDisabled()
  await bar().getByRole('checkbox', { name: /Apple/ }).click()
  await bar().getByRole('checkbox', { name: /Cherry/ }).click()
  await expect(bar().getByRole('checkbox', { name: /Apple/ })).toBeChecked()
  await composer().focus()
  await page.keyboard.press('2') // toggle Banana on…
  await page.keyboard.press('2') // …and off again
  await expect(bar().getByRole('checkbox', { name: /Banana/ })).not.toBeChecked()
  await page.keyboard.press('4')
  await page.getByRole('textbox', { name: '其他回答' }).fill('kiwi')
  await page.screenshot({ path: 'test-results/prompt-bar-multi-dark.png' })
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(bar()).toHaveCount(0)
  expect((await log()).at(-1)).toMatchObject({ selection: { kind: 'multi', indices: [0, 2], other: 'kiwi' } })
  // 1 3, then ↓×3 to the "Type something" row, kiwi, ↓ (Submit row), Enter; tty echo shows ESC as ^[
  await expect.poll(screen, { timeout: 15_000 }).toMatch(/13\^\[\[B\^\[\[B\^\[\[Bkiwi\^\[\[B/)
})

test('two questions are answered in sequence, then the review is confirmed', async () => {
  const q = question([colour, { ...fruit, options: [{ label: 'Apple' }, { label: 'Banana' }] }])
  await inject(q)
  await expect(bar()).toContainText('问题 1 / 2')
  await expect(bar()).toContainText('用哪种配色？')
  await focusTerminal()
  await page.keyboard.type('seq-')
  await bar().getByRole('button', { name: /Red/ }).click()
  await expect(bar()).toContainText('问题 2 / 2')
  await expect(bar()).toContainText('选择水果')
  await bar().getByRole('checkbox', { name: /Banana/ }).click()
  await bar().getByRole('button', { name: '提交' }).click()
  await expect(bar()).toHaveCount(0)
  // Q1: 1.  Q2: 2, → (^[[C), then Enter confirms the review: the tty echoes the keys, and `cat -v` prints the
  // line again once the Enter has flushed it, so the sequence shows up twice.
  await expect.poll(screen, { timeout: 15_000 }).toMatch(/12\^\[\[C[\s\S]*12\^\[\[C/)
})

test('a prompt resolved elsewhere disappears; another session keeps its own prompts', async () => {
  const mine = permission()
  const other = permission({ sessionId: 's-perf' })
  await inject(mine)
  await inject(other)
  await expect(bar()).toHaveCount(1)
  await page.getByText('结算页性能优化').click()
  await expect(bar()).toBeVisible()
  await bar().getByRole('button', { name: /拒绝/ }).click()
  await expect(bar()).toHaveCount(0)
  await page.getByText('Cookie 会话迁移').click()
  await expect(bar()).toBeVisible()
  await bar().getByRole('button', { name: /拒绝/ }).click()
  await expect(bar()).toHaveCount(0)
})
