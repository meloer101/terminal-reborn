import { expect, test } from '@playwright/test'
import { launchApp, setWindowSize } from './launch'

test('app window opens with the shell regions', async () => {
  const app = await launchApp()
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('Wavi')
  for (const region of ['sidebar', 'main', 'terminal']) {
    await expect(page.locator(`[data-region="${region}"]`)).toBeVisible()
  }
  const spawnType = await page.evaluate(
    () => typeof (globalThis as unknown as { tr?: { pty?: { spawn?: unknown } } }).tr?.pty?.spawn
  )
  expect(spawnType).toBe('function')
  // A fresh profile has no projects yet: the sidebar explains that and offers to open one (Figma 09 · A).
  const sidebar = page.locator('[data-region="sidebar"]')
  await expect(sidebar.getByText('还没有项目', { exact: true })).toBeVisible()
  // F18: the sidebar keeps one quiet line; the one open-project button lives on the welcome page.
  await expect(page.getByTestId('empty-main').getByRole('button', { name: /^打开项目… ⌘O$/ })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: /^打开项目… ⌘O$/ })).toBeVisible()
  await app.close()
})

test('the boot screen hands its mark to the welcome page and remembers where the card is (PRD F18 · Figma 39I)', async () => {
  const app = await launchApp()
  const page = await app.firstWindow()
  const welcome = page.getByTestId('empty-main').locator('> div')
  // The dots form, the welcome page takes the mark over, turns it upright and slides it home; then everything is still.
  await expect(welcome).toHaveAttribute('data-entrance', 'done', { timeout: 10_000 })
  await expect(page.locator('#wavi-boot')).toHaveCount(0)
  await expect(page.locator('[data-entrance-part="greeting"]')).toBeVisible()
  const layout = await page.evaluate(() => JSON.parse(localStorage.getItem('tr.boot.layout') ?? 'null') as Record<string, number> | null)
  expect(layout).toMatchObject({ left: expect.any(Number), top: expect.any(Number), anchorY: expect.any(Number) })
  await app.close()
})

test('the sidebar resizes from its right edge (200–480) and main follows', async () => {
  const app = await launchApp()
  const page = await app.firstWindow()
  // Wide enough for the 480 maximum next to main's 560 minimum, whatever the screen.
  await setWindowSize(app, page, 1440, 900)
  const sidebar = page.locator('[data-region="sidebar"]')
  const main = page.locator('[data-region="main"]')
  const width = async () => Math.round((await sidebar.boundingBox())!.width)
  await expect.poll(width).toBe(264)

  const handle = page.getByRole('separator', { name: '调整侧栏宽度' })
  const h = (await handle.boundingBox())!
  const drag = async (dx: number) => {
    const b = (await handle.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, h.y + 300)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + dx, h.y + 300, { steps: 5 })
    await page.mouse.up()
  }
  await drag(100)
  await expect.poll(width).toBe(364)
  expect(Math.round((await main.boundingBox())!.x)).toBe(364)
  await drag(-400)
  await expect.poll(width).toBe(200)
  await drag(600)
  await expect.poll(width).toBe(480)
  // A narrower window shows less of the saved width, so main keeps its minimum.
  await setWindowSize(app, page, 1000, 700)
  await expect.poll(width).toBe(440)
  expect(Math.round((await main.boundingBox())!.width)).toBe(560)
  await setWindowSize(app, page, 1440, 900)
  await expect.poll(width).toBe(480)
  await handle.dblclick()
  await expect.poll(width).toBe(264)
  await app.close()
})
