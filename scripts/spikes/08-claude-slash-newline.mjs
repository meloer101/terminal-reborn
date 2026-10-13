/* eslint-disable no-undef */
// Q1/Q3 (Claude, nothing is submitted except harmless local commands): slash/memory modes and newline keys.
import { expRepo, launch, show, sleep, PASTE_START, PASTE_END } from './harness.mjs'

const c = launch('claude', [], { cwd: expRepo() })
await c.waitFor(/Try "/, 20000)
await sleep(1500)

const tail = (n = 14) =>
  c
    .visible()
    .split('\n')
    .filter((l) => l.trim() && !/^[─ ]+$/.test(l))
    .slice(-n)
    .map((l) => '  | ' + l.slice(0, 110))
    .join('\n')
const clear = async () => {
  c.write('\x03')
  await sleep(600)
}

// --- slash mode ---
c.write('/')
await sleep(700)
show('typed "/" as keystroke', tail())
await clear()

c.write(PASTE_START + '/help' + PASTE_END)
await sleep(700)
show('pasted "/help" (no keystroke)', tail())
await clear()

c.write('/')
await sleep(300)
c.write(PASTE_START + 'mod' + PASTE_END)
await sleep(700)
show('"/" keystroke + paste "mod"', tail())
c.write(' ')
await sleep(700)
show('...then a trailing space', tail())
await clear()

c.write('/mod')
await sleep(700)
show('typed "/mod" (fuzzy menu, highlighted item)', tail())
await clear()

// --- memory mode ---
c.write('#')
await sleep(700)
show('typed "#"', tail(6))
await clear()
c.write(PASTE_START + '# note' + PASTE_END)
await sleep(700)
show('pasted "# note"', tail(6))
await clear()

// --- newline keys: a <seq> b ---
for (const [name, seq] of [
  ['ESC CR (Alt+Enter)', '\x1b\r'],
  ['LF (Ctrl+J)', '\n'],
  ['CSI 13;2u (Shift+Enter, kitty)', '\x1b[13;2u'],
  ['CSI 13;5u (Ctrl+Enter, kitty)', '\x1b[13;5u'],
  ['backslash + CR', '\\\r']
]) {
  c.write('first')
  await sleep(150)
  c.write(seq)
  await sleep(250)
  c.write('second')
  await sleep(500)
  const rows = c.visible().split('\n')
  const i = rows.findIndex((l) => l.startsWith('❯'))
  console.log(name.padEnd(34), JSON.stringify(rows.slice(i, i + 3).map((l) => l.trimEnd())))
  await clear()
}
c.kill()
process.exit(0)
