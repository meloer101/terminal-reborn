/* eslint-disable no-undef */
// Attachments into a running agent (free: nothing is submitted). For Claude and Codex: what does a bracketed paste of
// an image path, a file path, a path with spaces (raw / shell-escaped / quoted), two paths, do to the composer — and
// does Ctrl+V read an image from the system clipboard? The text clipboard is saved and put back afterwards.
//   usage: node scripts/spikes/50-attach-lab.mjs [claude|codex]
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexReady, codexRepo, launchCodex } from './codex-lib.mjs'
import { launch, PASTE_END, PASTE_START, sleep } from './harness.mjs'

const which = process.argv[2] ?? 'claude'
const dir = mkdtempSync(join(tmpdir(), 'trspike-attach-'))
// 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const img = join(dir, 'shot.png')
const spaced = join(dir, 'my shot 截图.png')
const text = join(dir, 'notes.md')
writeFileSync(img, PNG)
writeFileSync(spaced, PNG)
writeFileSync(text, '# notes\n')
const esc = (p) => p.replace(/([^A-Za-z0-9_\-./:@%+=,\u0080-￿])/g, '\\$1')

let agent
if (which === 'codex') {
  agent = launchCodex(codexRepo())
  console.log('ready', await codexReady(agent))
} else {
  agent = launch('claude', [], { cwd: process.cwd() })
  console.log('ready', await agent.waitFor(/❯/, 30000))
  await sleep(2500)
}

const composer = () => {
  const rows = agent.visible().split('\n')
  const i = rows.findLastIndex((l) => /^\s*[❯›]/.test(l))
  return rows
    .slice(Math.max(0, i - 3), i + 4)
    .map((l) => l.trimEnd().slice(0, 140))
    .filter((l) => l.trim())
}
const clear = async () => {
  // Claude: Esc Esc clears; Codex: Ctrl+C clears a non-empty composer.
  agent.write(which === 'codex' ? '\x03' : '\x1b\x1b')
  await sleep(800)
}

const cases = [
  ['image path', img],
  ['image path, spaces raw', spaced],
  ['image path, shell-escaped', esc(spaced)],
  ["image path, 'quoted'", `'${spaced}'`],
  ['two image paths', `${img} ${esc(spaced)}`],
  ['text file path', text]
]
// One paste per file, a space typed between (what Wavi sends for several files).
const sequences = [['image, space, image', [esc(img), esc(spaced)]], ['image, space, text file', [esc(img), esc(text)]]]
for (const [name, value] of cases) {
  agent.write(PASTE_START + value + PASTE_END)
  await agent.settle(600, 6000)
  console.log(name.padEnd(28), JSON.stringify(composer()))
  await clear()
}

for (const [name, values] of sequences) {
  for (const [i, value] of values.entries()) {
    if (i > 0) agent.write(' ')
    agent.write(PASTE_START + value + PASTE_END)
    await agent.settle(500, 6000)
  }
  console.log(name.padEnd(28), JSON.stringify(composer()))
  await clear()
}

// The same, written to the PTY in one go (no pause between the pastes).
{
  agent.write([esc(img), esc(spaced), esc(text)].map((v) => PASTE_START + v + PASTE_END).join(' ') + ' ')
  await agent.settle(800, 6000)
  console.log('one write, three files'.padEnd(28), JSON.stringify(composer()))
  await clear()
}

// Ctrl+V with an image on the clipboard (macOS). Keep the user's text clipboard.
let saved = null
try {
  saved = execFileSync('pbpaste', { encoding: 'utf8' })
} catch {
  /* empty */
}
execFileSync('osascript', ['-e', `set the clipboard to (read (POSIX file "${img}") as «class PNGf»)`])
agent.write('\x16')
await agent.settle(800, 6000)
console.log('Ctrl+V image clipboard'.padEnd(28), JSON.stringify(composer()))
await clear()
if (saved !== null) execFileSync('pbcopy', { input: saved })

agent.kill()
process.exit(0)
