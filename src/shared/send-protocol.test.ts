import { describe, expect, it } from 'vitest'
import {
  AGENT_PROFILES,
  NEWLINE_KEY,
  PASTE_END,
  PASTE_START,
  SLASH_KEY_GAP_MS,
  SUBMIT_KEY,
  TYPED_CHUNK_CHARS,
  TYPED_CHUNK_GAP_MS,
  becomesPlaceholder,
  bracketedPaste,
  detectBlockingDialog,
  echoNeedles,
  isBareSlashCommand,
  isSlashText,
  normalizeSendText,
  pasteTimeoutMs,
  planSend,
  utf8ByteLength,
  type SendStep
} from './send-protocol'

const paste = (s: string): SendStep => ({ type: 'write', data: PASTE_START + s + PASTE_END })
const write = (data: string): SendStep => ({ type: 'write', data })
const T = (s: string): number => pasteTimeoutMs(utf8ByteLength(s))
const delay = (ms: number): SendStep => ({ type: 'delay', ms })
const wait = (needles: string[], timeoutMs: number): SendStep => ({ type: 'waitForText', needles, timeoutMs })

describe('utf8ByteLength / pasteTimeoutMs', () => {
  it('counts bytes, not UTF-16 units', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('你好')).toBe(6)
    expect(utf8ByteLength('😀')).toBe(4)
  })

  it('scales with bytes, has a floor and a cap', () => {
    expect(pasteTimeoutMs(0)).toBe(2000)
    expect(pasteTimeoutMs(1024)).toBe(2025)
    expect(pasteTimeoutMs(20_000)).toBe(2000 + Math.ceil((20_000 / 1024) * 25))
    expect(pasteTimeoutMs(10_000_000)).toBe(20_000)
  })

  it('gives CJK three times the budget of ASCII with the same character count', () => {
    const ascii = pasteTimeoutMs(utf8ByteLength('a'.repeat(5000)))
    const cjk = pasteTimeoutMs(utf8ByteLength('你'.repeat(5000)))
    expect(cjk - 2000).toBeGreaterThanOrEqual(3 * (ascii - 2000) - 3)
  })
})

describe('normalizeSendText', () => {
  it.each([
    ['CRLF -> LF', 'a\r\nb', 'a\nb'],
    ['lone CR -> LF', 'a\rb', 'a\nb'],
    ['keeps tabs and newlines', 'a\tb\nc', 'a\tb\nc'],
    ['strips ESC (cannot end the paste early)', 'x\x1b[201~y', 'x[201~y'],
    ['strips Ctrl+C and NUL', 'a\x03b\x00c', 'abc'],
    ['strips DEL', 'a\x7fb', 'ab'],
    ['keeps CJK and emoji', '你好 😀', '你好 😀']
  ])('%s', (_name, input, expected) => {
    expect(normalizeSendText(input)).toBe(expected)
  })
})

describe('becomesPlaceholder (measured thresholds)', () => {
  it.each([
    ['claude', 'a'.repeat(800), false],
    ['claude', 'a'.repeat(801), true],
    ['claude', '你'.repeat(800), false],
    ['claude', '你'.repeat(801), true],
    ['claude', 'a\nb\nc', false],
    ['claude', 'a\nb\nc\nd', true],
    ['codex', 'a'.repeat(1000), false],
    ['codex', 'a'.repeat(1001), true],
    ['codex', Array.from({ length: 30 }, () => 'x').join('\n'), false],
    ['shell', 'a'.repeat(5000), false]
  ] as const)('%s %s -> %s', (agent, text, expected) => {
    expect(becomesPlaceholder(text, agent)).toBe(expected)
  })
})

describe('echoNeedles', () => {
  it('uses the first line prefix plus the placeholder needle', () => {
    expect(echoNeedles('reply with just OK', 'claude')).toEqual(['reply with just OK', '[Pasted text'])
    expect(echoNeedles('reply with just OK', 'codex')).toEqual(['reply with just OK', '[Pasted Content'])
  })

  it('truncates to 20 characters (code points)', () => {
    expect(echoNeedles('abcdefghijklmnopqrstuvwxyz', 'claude')[0]).toBe('abcdefghijklmnopqrst')
    expect(echoNeedles('你好世界今天天气不错你好世界今天天气不错你好世界', 'claude')[0]).toBe('你好世界今天天气不错你好世界今天天气不错')
  })

  it('skips leading blank lines and indentation', () => {
    expect(echoNeedles('\n\n   hello world', 'claude')[0]).toBe('hello world')
  })

  it('stops at a run of spaces or a tab (the TUI may re-render them)', () => {
    expect(echoNeedles('foo\tbar', 'claude')[0]).toBe('foo')
    expect(echoNeedles('foo    bar', 'codex')[0]).toBe('foo')
  })

  it('only the placeholder needle when the text will be collapsed', () => {
    expect(echoNeedles('a'.repeat(900), 'claude')).toEqual(['[Pasted text'])
    expect(echoNeedles('a\nb\nc\nd', 'claude')).toEqual(['[Pasted text'])
    expect(echoNeedles('a'.repeat(1500), 'codex')).toEqual(['[Pasted Content'])
  })

  it('has none for the shell', () => {
    expect(echoNeedles('ls', 'shell')).toEqual([])
  })
})

describe('slash helpers', () => {
  it.each([
    ['/help', true, true],
    ['/model-builder:dcf-model', true, true],
    ['/review fix the login bug', true, false],
    ['/', false, false],
    ['/ spaced', false, false],
    ['//comment', false, false],
    ['text /help', false, false],
    ['/Users/dev/file.ts', true, false]
  ])('%s -> slash=%s bare=%s', (text, slash, bare) => {
    expect(isSlashText(text)).toBe(slash)
    expect(isBareSlashCommand(text)).toBe(bare)
  })
})

describe('planSend', () => {
  describe('empty input', () => {
    it.each(['', '   ', '\n\n', '\t \r\n'])('%j -> no steps', (text) => {
      expect(planSend(text, 'claude')).toEqual([])
      expect(planSend(text, 'codex')).toEqual([])
      expect(planSend(text, 'shell')).toEqual([])
    })
  })

  describe('plain text, closed loop with a separate Enter', () => {
    it('claude ASCII', () => {
      expect(planSend('reply with just OK', 'claude')).toEqual([
        paste('reply with just OK'),
        wait(['reply with just OK', '[Pasted text'], T('reply with just OK')),
        delay(AGENT_PROFILES.claude.preEnterDelayMs),
        write(SUBMIT_KEY)
      ])
    })

    it('codex ASCII waits longer before Enter than claude', () => {
      const steps = planSend('reply with just OK', 'codex')
      expect(steps).toEqual([
        paste('reply with just OK'),
        wait(['reply with just OK', '[Pasted Content'], T('reply with just OK')),
        delay(150),
        write(SUBMIT_KEY)
      ])
      expect(AGENT_PROFILES.codex.preEnterDelayMs).toBeGreaterThanOrEqual(150)
    })

    it('CJK uses a byte-scaled timeout and a CJK needle', () => {
      const text = '你好世界'.repeat(100) // 400 chars, 1200 bytes
      const steps = planSend(text, 'claude')
      expect(steps[0]).toEqual(paste(text))
      expect(steps[1]).toEqual(wait(['你好世界'.repeat(5), '[Pasted text'], pasteTimeoutMs(1200)))
      expect(pasteTimeoutMs(1200)).toBeGreaterThan(pasteTimeoutMs(400))
    })

    it('multi-line below the placeholder threshold keeps the echo needle (claude)', () => {
      const steps = planSend('line one\nline two', 'claude')
      expect(steps[0]).toEqual(paste('line one\nline two'))
      expect(steps[1]).toEqual(wait(['line one', '[Pasted text'], T('line one\nline two')))
    })

    it('multi-line over the threshold waits for the placeholder only (claude)', () => {
      const text = 'a\nb\nc\nd\ne'
      const steps = planSend(text, 'claude')
      expect(steps).toEqual([paste(text), wait(['[Pasted text'], T(text)), delay(60), write(SUBMIT_KEY)])
    })

    it('multi-line stays inline for codex (no line threshold)', () => {
      const text = 'a\nb\nc\nd\ne'
      expect(planSend(text, 'codex')[1]).toEqual(wait(['a', '[Pasted Content'], T(text)))
    })

    it('20 000 ASCII chars: a single paste, placeholder needle, scaled timeout', () => {
      const text = 'x'.repeat(20_000)
      const steps = planSend(text, 'claude')
      expect(steps).toHaveLength(4)
      expect(steps[0]).toEqual(paste(text))
      expect(steps[1]).toEqual(wait(['[Pasted text'], pasteTimeoutMs(20_000)))
      expect(planSend(text, 'codex')[1]).toEqual(wait(['[Pasted Content'], pasteTimeoutMs(20_000)))
    })

    it('5 000 CJK chars (15 000 bytes): one paste, timeout from bytes', () => {
      const text = '汉'.repeat(5000)
      const steps = planSend(text, 'codex')
      expect(steps[0]).toEqual(paste(text))
      expect(steps[1]).toEqual(wait(['[Pasted Content'], pasteTimeoutMs(15_000)))
      expect(pasteTimeoutMs(15_000)).toBeGreaterThan(pasteTimeoutMs(5000))
    })

    it('never lets the text terminate the paste early', () => {
      const steps = planSend('before\x1b[201~rm -rf', 'claude')
      expect(steps[0]).toEqual(paste('before[201~rm -rf'))
    })

    it('CRLF input is sent with LF', () => {
      expect(planSend('a\r\nb', 'claude')[0]).toEqual(paste('a\nb'))
    })

    it('the Enter is never in the same write as the paste', () => {
      for (const agent of ['claude', 'codex'] as const) {
        for (const text of ['hi', 'a\nb\nc\nd', 'x'.repeat(5000), '/help', '/review please look']) {
          const writes = planSend(text, agent).filter((s) => s.type === 'write')
          for (const w of writes) {
            if (w.type === 'write' && w.data.includes(PASTE_END)) expect(w.data.endsWith(PASTE_END)).toBe(true)
          }
          expect(writes.at(-1)).toEqual(write(SUBMIT_KEY))
        }
      }
    })
  })

  describe('slash commands', () => {
    it('argument-less command: "/" as its own keystroke, trailing space, then paste of the rest', () => {
      expect(planSend('/help', 'claude')).toEqual([
        write('/'),
        delay(SLASH_KEY_GAP_MS),
        paste('help '),
        wait(['/help', '[Pasted text'], T('help ')),
        delay(60),
        write(SUBMIT_KEY)
      ])
    })

    it('codex bare command gets the same treatment with its own delay', () => {
      expect(planSend('/status', 'codex')).toEqual([
        write('/'),
        delay(SLASH_KEY_GAP_MS),
        paste('status '),
        wait(['/status', '[Pasted Content'], T('status ')),
        delay(150),
        write(SUBMIT_KEY)
      ])
    })

    it('command with arguments: "/" keystroke, no trailing space', () => {
      expect(planSend('/review fix the login bug', 'claude')).toEqual([
        write('/'),
        delay(SLASH_KEY_GAP_MS),
        paste('review fix the login bug'),
        wait(['/review fix the logi', '[Pasted text'], T('review fix the login bug')),
        delay(60),
        write(SUBMIT_KEY)
      ])
    })

    it('claude: slash text that would become a placeholder is typed in chunks, newlines as Alt+Enter', () => {
      const long = 'x'.repeat(TYPED_CHUNK_CHARS * 8 + 10)
      const text = `/plan ${long}\nsecond line`
      const steps = planSend(text, 'claude')
      expect(steps.some((s) => s.type === 'write' && s.data.includes(PASTE_START))).toBe(false)
      const writes = steps.filter((s) => s.type === 'write').map((s) => (s as { data: string }).data)
      // chunks reassemble to the original text with newline keys in place of "\n"
      expect(writes.slice(0, -1).join('').split(NEWLINE_KEY).join('\n')).toBe(text)
      expect(writes.at(-1)).toBe(SUBMIT_KEY)
      // every typed chunk is followed by a gap
      expect(steps.filter((s) => s.type === 'delay' && s.ms === TYPED_CHUNK_GAP_MS).length).toBeGreaterThanOrEqual(4)
      // waits for the start of the last line before submitting
      const waitStep = steps.find((s) => s.type === 'waitForText')
      expect(waitStep).toEqual(wait(['second line'], pasteTimeoutMs(utf8ByteLength(text))))
    })

    it('typed chunks are at most TYPED_CHUNK_CHARS code points', () => {
      const steps = planSend('/plan ' + '你'.repeat(1000), 'claude')
      for (const s of steps) {
        if (s.type === 'write' && s.data !== SUBMIT_KEY) expect([...s.data].length).toBeLessThanOrEqual(TYPED_CHUNK_CHARS)
      }
    })

    it('codex keeps pasting long slash text (typed mode is unverified there)', () => {
      const steps = planSend('/plan ' + 'x'.repeat(1500), 'codex')
      expect(steps[0]?.type).toBe('write')
      expect((steps[0] as { data: string }).data.startsWith(PASTE_START + '/plan')).toBe(true)
    })

    it('a path-like or "//" text is not treated as a slash command', () => {
      expect(planSend('//comment', 'claude')[0]).toEqual(paste('//comment'))
    })
  })

  describe('# notes', () => {
    it('are plain text (no memory mode exists in the measured versions)', () => {
      expect(planSend('#remember this', 'claude')[0]).toEqual(paste('#remember this'))
      expect(planSend('#remember this', 'codex')[0]).toEqual(paste('#remember this'))
    })
  })

  describe('shell agent', () => {
    it('single line: raw text, short pause, Enter', () => {
      expect(planSend('ls -la', 'shell')).toEqual([write('ls -la'), delay(20), write(SUBMIT_KEY)])
    })

    it('multi-line: bracketed paste, then Enter', () => {
      expect(planSend('echo a\necho b', 'shell')).toEqual([paste('echo a\necho b'), delay(20), write(SUBMIT_KEY)])
    })

    it('never waits for text', () => {
      expect(planSend('ls', 'shell').some((s) => s.type === 'waitForText')).toBe(false)
    })
  })
})

describe('bracketedPaste', () => {
  it('wraps in the CSI 200/201 markers', () => {
    expect(bracketedPaste('x')).toBe('\x1b[200~x\x1b[201~')
  })
})

describe('detectBlockingDialog', () => {
  it('recognises the three first-run dialogs', () => {
    expect(detectBlockingDialog(' ❯ No, exit\n   Yes, I trust this folder')).toBe('claude-trust')
    expect(detectBlockingDialog('> You are in /x\n\n  Do you trust the contents of this directory? Working')).toBe(
      'codex-trust'
    )
    expect(detectBlockingDialog('✨  Update available! 0.142.5 -> 0.154.0\n 3. Skip until next version')).toBe(
      'codex-update'
    )
  })

  it('returns null for a normal screen', () => {
    expect(detectBlockingDialog('❯ Try "how do I log an error?"')).toBeNull()
    expect(detectBlockingDialog('› Write tests for @filename')).toBeNull()
  })
})
