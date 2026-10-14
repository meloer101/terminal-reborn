// PRD §1.3 send matrix against the real CLIs, driven through the composer inside the app.
// Opt-in (it calls the models): TR_E2E_AGENTS=claude,codex npm run test:e2e -- agents
// Each prompt asks for a number that does not appear in the prompt, so seeing it proves the
// model received and understood the message, not just that the TUI echoed it.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { launchApp } from './launch'

type Agent = 'claude' | 'codex'
const agents = (process.env.TR_E2E_AGENTS ?? '').split(',').filter((a): a is Agent => a === 'claude' || a === 'codex')

interface Hooks {
  __trTerminals: { readScreen(id: string, scrollback?: number): string }
  __trWorkspace: {
    getState(): {
      addProject(path: string): string
      addSession(projectId: string, kind: Agent): string | null
    }
  }
}

/** A solid red 16×16 PNG, written without any image library. */
function redPng(): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), body.length + 4)
    return out
  }
  const size = 16
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([255, 0, 0]))])
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk('IEND', Buffer.alloc(0))
  ])
  // Inside the working directory (so the agent may read it without a permission prompt), and
  // named without the colour so the answer cannot be matched from the echoed prompt.
  const path = join(process.cwd(), 'test-results', `tr-e2e-swatch-${Date.now()}.png`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, png)
  return path
}

const ask = (a: number, b: number) => `What is ${a} + ${b}? Reply with only the number.`

for (const agent of agents) {
  test.describe(`send matrix · ${agent}`, () => {
    test.describe.configure({ mode: 'serial' })
    test.setTimeout(240_000)

    let app: ElectronApplication
    let page: Page
    let sessionId: string

    const screen = () =>
      page.evaluate((id) => (globalThis as unknown as Hooks).__trTerminals.readScreen(id, 5000), sessionId)
    const composer = () => page.getByRole('textbox', { name: '输入框' })

    async function send(text: string): Promise<void> {
      await composer().fill(text)
      await composer().press('Enter')
      await expect(page.getByRole('alert')).toHaveCount(0)
    }

    async function expectReply(pattern: RegExp, timeout = 120_000): Promise<void> {
      await expect.poll(screen, { timeout, intervals: [1000] }).toMatch(pattern)
    }

    test.beforeAll(async () => {
      app = await launchApp()
      page = await app.firstWindow()
      await page.addInitScript(() => {
        ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
      })
      await page.reload()
      // The repository itself: already trusted by Claude on the author's machine; Codex is trusted per launch.
      sessionId = await page.evaluate(
        ([root, kind]) => {
          const ws = (globalThis as unknown as Hooks).__trWorkspace.getState()
          return ws.addSession(ws.addProject(root as string), kind as Agent) ?? ''
        },
        [process.cwd(), agent]
      )
      expect(sessionId).not.toBe('')
      // Ready once the TUI has drawn its input prompt.
      await expect.poll(screen, { timeout: 60_000, intervals: [500] }).toMatch(agent === 'claude' ? /\? for shortcuts|❯/ : /›/)
      await expect(composer()).toBeEnabled()
      await page.waitForTimeout(1500)
    })

    test.afterAll(async () => {
      await app?.close()
    })

    test('ASCII', async () => {
      await send(ask(1234, 1111))
      await expectReply(/\b2345\b/)
    })

    test('中文', async () => {
      await send('请计算 3000 加 456 等于多少？只回复数字。')
      await expectReply(/\b3456\b/)
    })

    test('multi-line (placeholder)', async () => {
      await send(['第一行：忽略', '第二行：忽略', '第三行：忽略', ask(7000, 890)].join('\n'))
      await expectReply(/\b7890\b/)
    })

    test('20 000 characters', async () => {
      const filler = 'lorem ipsum dolor sit amet '.repeat(Math.ceil(20_000 / 27)).slice(0, 20_000)
      await send(`${filler}\nIgnore the filler text above. ${ask(4000, 567)}`)
      await expectReply(/\b4567\b/, 180_000)
    })

    test('# is plain text', async () => {
      await send(`# ${ask(5000, 678)}`)
      await expectReply(/\b5678\b/)
    })

    test('image path', async () => {
      await send(`What is the single dominant colour of the image at ${redPng()} ? Reply with one English word.`)
      await expectReply(/\bred\b/i, 180_000)
    })

    test('sending while busy queues the message', async () => {
      await send('Write the numbers from 1 to 60, one per line, then stop.')
      await page.waitForTimeout(1500)
      await send(ask(6000, 789))
      await expectReply(/\b6789\b/, 180_000)
    })

    test('slash command', async () => {
      await send('/status')
      await expectReply(agent === 'claude' ? /Version|Model|Session/ : /Model|Directory|Session/, 30_000)
    })
  })
}

test('agent matrix is opt-in', () => {
  test.skip(agents.length > 0, 'running the real matrix')
  test.skip(true, 'set TR_E2E_AGENTS=claude,codex to run the real-agent send matrix')
})
