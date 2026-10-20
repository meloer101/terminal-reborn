// Chinese input and display in the terminal (the CJK baseline): URLs in Chinese prose, and what reaches the PTY when an
// input method types. Input methods cannot run here, so each test replays, through CDP, the events Chromium on macOS
// produces for them (content/app_shim_remote_cocoa/render_widget_host_view_cocoa.mm, -keyEvent:): a keydown with
// keyCode 229 while the IME composes or inserts more than one character, then the composition update or commit and
// the keyup; or, for a single character the IME types without composing, the plain key's keydown followed by a
// keypress carrying the IME's character. A raw-mode reader in the shell prints every chunk the PTY receives.
import { expect, test, type CDPSession, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
  size(sessionId: string): { cols: number; rows: number } | null
}
interface TrWindow {
  tr: { ui: { openSettings(): void }; settings: { get(): Promise<{ appearance: { cjkFont: string } }> } }
}
const SESSION = 's-cookie'
/** Ends every capture: typed normally, so once it arrives everything sent before it has too. */
const SENTINEL = '='

let app: ElectronApplication
let page: Page
let cdp: CDPSession

const pane = () => page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"]`)
const xterm = () => pane().locator('.xterm')
const screen = (scrollback = 0) =>
  page.evaluate(
    ([id, n]) => (globalThis as unknown as { __trTerminals: Hook }).__trTerminals.readScreen(id as string, n as number),
    [SESSION, scrollback] as const
  )

const MOD = { alt: 1, meta: 4, shift: 8 } as const
type Mod = keyof typeof MOD
const modifiers = (mods: Mod[]) => mods.reduce((sum, mod) => sum | MOD[mod], 0)

/**
 * The pause between two keystrokes. xterm finishes composition work in setTimeout(0) callbacks, which run between a
 * typist's keys; CDP sends keys back to back, and Chromium holds timers while input is pending.
 */
const betweenKeys = () => page.evaluate(() => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 10), 0)))

/** One key an input method handles: keydown 229 (what Chromium sends then), the IME's work, the real keyup. */
async function imeKey(key: string, code: string, keyCode: number, work: () => Promise<unknown>, mods: Mod[] = []): Promise<void> {
  const m = modifiers(mods)
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: 229, modifiers: m })
  await work()
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers: m })
  await betweenKeys()
}

/** A key whose keydown is the plain key and whose keypress carries `text` (what the IME or the layout typed). */
async function textKey(key: string, code: string, keyCode: number, text: string, mods: Mod[] = []): Promise<void> {
  const m = modifiers(mods)
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers: m })
  await cdp.send('Input.dispatchKeyEvent', { type: 'char', key, code, text, unmodifiedText: text, windowsVirtualKeyCode: keyCode, modifiers: m })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers: m })
  await betweenKeys()
}

/** Sets the IME's marked text (the preedit); '' cancels the composition. */
const compose = (text: string) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
/** The IME commits `text`: ends the composition with it, or inserts it when there is none. */
const commit = (text: string) => cdp.send('Input.insertText', { text })

/** Types Pinyin letter by letter, as composing keys. */
async function pinyin(letters: string): Promise<void> {
  for (let i = 1; i <= letters.length; i++) {
    const letter = letters[i - 1]!
    await imeKey(letter, `Key${letter.toUpperCase()}`, letter.toUpperCase().charCodeAt(0), () => compose(letters.slice(0, i)))
  }
}

/** Every chunk the reader has printed, by its sequence number. */
async function chunks(): Promise<string[]> {
  const out: string[] = []
  for (const line of (await screen(500)).split('\n')) {
    const match = /^IN (\d+) (".*")$/.exec(line.trim())
    if (match) out[Number(match[1])] = JSON.parse(match[2]!) as string
  }
  return out
}

/** What the PTY received while `actions` ran. */
async function received(actions: () => Promise<void>): Promise<string> {
  const from = (await chunks()).length
  await actions()
  await betweenKeys()
  await page.keyboard.type(SENTINEL)
  let text = ''
  await expect
    .poll(async () => {
      text = (await chunks()).slice(from).join('')
      return text.includes(SENTINEL)
    })
    .toBe(true)
  return text.slice(0, text.indexOf(SENTINEL))
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
  await expect(pane()).toBeVisible()
  await expect.poll(() => screen(), { timeout: 20_000 }).not.toBe('')
  // A window behind others gets its timers throttled; xterm's composition handling runs on setTimeout(0), and the
  // window someone types into is in front.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.setBackgroundThrottling(false)))
  cdp = await page.context().newCDPSession(page)
})

test.afterAll(async () => {
  await app.close()
})

test('a URL in Chinese prose ends at the full-width punctuation after it (orca#30213)', async () => {
  const url = 'https://x.example/a'
  await pane().click()
  await page.keyboard.type(`clear; printf '%s\\n' '${url}。现在可以了'`)
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await screen()).split('\n')[0]?.trim()).toBe(`${url}。现在可以了`)
  /** The middle of the cell in column `col` of the first row, in page coordinates. */
  const cell = async (col: number) => {
    const box = await pane().locator('.xterm-screen').boundingBox()
    const size = await page.evaluate((id) => (globalThis as unknown as { __trTerminals: Hook }).__trTerminals.size(id), SESSION)
    if (!box || !size) throw new Error('no terminal')
    return { x: box.x + (box.width / size.cols) * (col + 0.5), y: box.y + (box.height / size.rows) * 0.5 }
  }
  const inside = await cell(5)
  await page.mouse.move(inside.x, inside.y)
  await expect(xterm()).toHaveAttribute('title', new RegExp(`^${url.replaceAll('.', '\\.')}\\n`))
  // 现 sits in cells 21–22, after the URL (19 cells) and 。 (2 cells): not part of the link.
  const after = await cell(22)
  await page.mouse.move(after.x, after.y)
  await expect(xterm()).not.toHaveAttribute('title', /.*/)
})

test.describe('input methods', () => {
  test.beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tr-e2e-cjk-'))
    const reader = join(dir, 'reader.js')
    writeFileSync(
      reader,
      [
        "const { StringDecoder } = require('node:string_decoder')",
        "const decoder = new StringDecoder('utf8')",
        'let n = 0',
        'process.stdin.setRawMode(true)',
        "process.stdin.on('data', (data) => {",
        '  const text = decoder.write(data)',
        "  if (text === '\\x04') process.exit(0)",
        "  process.stdout.write('IN ' + n++ + ' ' + JSON.stringify(text) + '\\r\\n')",
        '})',
        "process.stdout.write('READY\\r\\n')"
      ].join('\n')
    )
    await pane().click()
    await page.keyboard.type(`clear; node ${reader}`)
    await page.keyboard.press('Enter')
    await expect.poll(() => screen(), { timeout: 15_000 }).toMatch(/^READY$/m)
  })

  test.afterAll(async () => {
    await page.keyboard.press('Control+D')
  })

  test('plain typing still reaches the PTY key by key', async () => {
    expect(await received(() => page.keyboard.type('ls -la ~/x,y.z!'))).toBe('ls -la ~/x,y.z!')
  })

  test('Pinyin: Space picks the candidate; only the character arrives, the first key never leaks', async () => {
    const text = await received(async () => {
      await pinyin('ni')
      await imeKey(' ', 'Space', 32, () => commit('你'))
    })
    expect(text).toBe('你')
  })

  test('Backspace over the whole preedit sends nothing (orca#11936)', async () => {
    const text = await received(async () => {
      await pinyin('ceshi')
      for (const rest of ['cesh', 'ces', 'ce', 'c', '']) await imeKey('Backspace', 'Backspace', 8, () => compose(rest))
    })
    expect(text).toBe('')
  })

  test('Enter that confirms a composition sends the text, not a newline (orca#17820)', async () => {
    // Pinyin: Enter commits the letters as typed.
    expect(
      await received(async () => {
        await pinyin('api')
        await imeKey('Enter', 'Enter', 13, () => commit('api'))
      })
    ).toBe('api')
    // Japanese: Space converts, Enter confirms.
    expect(
      await received(async () => {
        await pinyin('nihongo')
        await imeKey(' ', 'Space', 32, () => compose('日本語'))
        await imeKey('Enter', 'Enter', 13, () => commit('日本語'))
      })
    ).toBe('日本語')
  })

  test('a single character picked with a number key stays, without the digit (orca#12099)', async () => {
    const text = await received(async () => {
      await pinyin('hao')
      await imeKey('1', 'Digit1', 49, () => commit('好'))
      await pinyin('haode')
      await imeKey('2', 'Digit2', 50, () => commit('好的'))
    })
    expect(text).toBe('好好的')
  })

  test('full-width punctuation the IME types without composing arrives full-width (orca#6147)', async () => {
    const text = await received(async () => {
      await textKey(',', 'Comma', 188, '，')
      await textKey('.', 'Period', 190, '。')
      await textKey('?', 'Slash', 191, '？', ['shift'])
      await textKey('!', 'Digit1', 49, '！', ['shift'])
      await textKey('<', 'Comma', 188, '《', ['shift'])
      await textKey('\\', 'Backslash', 220, '、')
      await textKey(';', 'Semicolon', 186, '；')
      // Two characters at once go through the IME path (keydown 229, then the text).
      await imeKey('^', 'Digit6', 54, () => commit('……'), ['shift'])
    })
    expect(text).toBe('，。？！《、；……')
  })

  test('a composition, then punctuation right after it, arrive in order', async () => {
    const text = await received(async () => {
      await pinyin('hao')
      await imeKey(' ', 'Space', 32, () => commit('好'))
      await textKey(',', 'Comma', 188, '，')
    })
    expect(text).toBe('好，')
  })

  test('⌥-composed letters and dead keys arrive as the letter (orca#20171)', async () => {
    const text = await received(async () => {
      await textKey('ç', 'KeyC', 67, 'ç', ['alt'])
      await textKey('ø', 'KeyO', 79, 'ø', ['alt'])
      await imeKey('Dead', 'KeyE', 69, () => compose('´'), ['alt'])
      await imeKey('e', 'KeyE', 69, () => commit('é'))
    })
    expect(text).toBe('çøé')
  })

  test('the ". " macOS adds after a typed space is dropped; typed text is not (orca#11504)', async () => {
    expect(
      await received(async () => {
        await textKey(' ', 'Space', 32, ' ')
        await commit('. ')
      })
    ).toBe(' ')
    // Not after a space: text the system inserts (dictation, the emoji picker) still arrives.
    expect(
      await received(async () => {
        await textKey('a', 'KeyA', 65, 'a')
        await commit('. ')
      })
    ).toBe('a. ')
  })

  test('⌘ shortcuts the renderer handles still work while a composition is open (cmux#440)', async () => {
    await pinyin('ni')
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 229, modifiers: MOD.meta })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: MOD.meta })
    const palette = page.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
    await pane().click()
    await compose('')
  })
})

test('Esc / Enter that end a composition do not close or submit the terminal search', async () => {
  await pane().click()
  await page.keyboard.press('Meta+f')
  const bar = page.getByTestId('terminal-search')
  const input = bar.getByRole('textbox', { name: '在终端中查找' })
  await expect(input).toBeFocused()
  await pinyin('zhong')
  await imeKey('Escape', 'Escape', 27, () => compose(''))
  await expect(input).toBeFocused()
  await pinyin('zhong')
  await imeKey(' ', 'Space', 32, () => commit('中'))
  await expect(input).toHaveValue('中')
  await page.keyboard.press('Escape')
  await expect(bar).toHaveCount(0)
})

test('Enter / Esc that end a composition in a settings search field do not pick or close', async () => {
  await page.evaluate(() => (globalThis as unknown as TrWindow).tr.ui.openSettings())
  const dialog = page.getByRole('dialog', { name: '设置' })
  await expect(dialog).toBeVisible()
  const before = (await page.evaluate(() => (globalThis as unknown as TrWindow).tr.settings.get())).appearance.cjkFont
  await dialog.getByRole('combobox', { name: '中文字体' }).click()
  const search = dialog.getByPlaceholder('搜索或输入字体名')
  await search.click()
  const list = dialog.getByRole('listbox', { name: '中文字体' })
  await pinyin('song')
  await imeKey('Enter', 'Enter', 13, () => commit('song'))
  await expect(search).toHaveValue('song')
  await expect(list).toBeVisible()
  await pinyin('ti')
  await imeKey('Escape', 'Escape', 27, () => compose(''))
  await expect(list).toBeVisible()
  await expect(dialog).toBeVisible()
  expect((await page.evaluate(() => (globalThis as unknown as TrWindow).tr.settings.get())).appearance.cjkFont).toBe(before)
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
