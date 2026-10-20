// Fake agent for e2e/webgl-cjk-stress.spec.ts: streams Chinese text laid out like an agent's TUI (bullets, tool
// results, diff rows with red / green backgrounds) with many distinct glyph × color × attribute combinations, so a
// WebGL glyph atlas fills up and has to merge pages. Deterministic per seed.
//
//   node cjk-agent.mjs <seed> [linesPerSecond] [agent|dense]
//
// `agent` (default) writes like an agent: each burst draws on a vocabulary of a few hundred new characters, mostly
// in its line's own style. `dense` gives every character on screen its own glyph: the fastest way to fill an atlas,
// but more distinct glyphs on one screen than real output ever has.
//
// Commands on stdin (raw mode, one byte each):
//   g  print the next burst, paced over a few frames, then a line `@@done <n>@@`
//   r  stream without stopping at linesPerSecond (load measurement) until s, which prints `@@stopped@@`
//   k  answer at once with a line `@@key <n>@@` (input latency)
//   q  quit
const seed = Number(process.argv[2] ?? 1) || 1
const linesPerSecond = Number(process.argv[3] ?? 40) || 40
const dense = process.argv[4] === 'dense'
const VOCABULARY = 400
const BURST_LINES = 72
const LINES_PER_TICK = 3
const TICK_MS = 16

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(seed * 7919)
const pick = (items) => items[Math.floor(random() * items.length)]

// Every CJK Unified Ideograph PingFang draws, shuffled per seed: each session walks its own order.
const pool = []
for (let code = 0x4e00; code <= 0x9fa5; code++) pool.push(String.fromCodePoint(code))
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1))
  ;[pool[i], pool[j]] = [pool[j], pool[i]]
}
let cursor = 0
const nextHan = () => pool[cursor++ % pool.length]
let vocabulary = []
const newVocabulary = () => (vocabulary = Array.from({ length: VOCABULARY }, nextHan))
newVocabulary()
const han = () => (dense ? nextHan() : pick(vocabulary))

// Foreground looks an agent's TUI uses (Claude Code's orange / green / red / blue / gray, 256-color, attributes).
const FOREGROUNDS = [
  '', '', '1', '2', '3', '4', '9', '1;3', '2;3', '4:3', '53', '7',
  '38;2;215;119;87', '38;2;78;186;101', '38;2;255;107;128', '38;2;177;185;249', '38;2;153;153;153', '38;2;235;159;127',
  '1;38;2;215;119;87', '2;38;2;153;153;153', '38;5;75', '38;5;141', '38;5;179', '38;5;210', '4;58;2;255;107;128'
]
/** `agent`: a run is in its line's style three times in four, else in one of these. */
const ACCENTS = ['1', '2', '3', '38;2;215;119;87', '38;2;177;185;249', '38;2;78;186;101']
const DIFF_ADDED = '48;2;34;92;43'
const DIFF_REMOVED = '48;2;122;41;54'
const CODE_SPAN = '48;5;236'
const ASCII_WORDS = ['src/auth/session.ts', 'npm test', 'useEffect', 'git diff', 'TerminalSurface', 'OK', '200', 'README.md']
const PUNCTUATION = ['，', '。', '：', '、', '「', '」', '（', '）']

let columns = process.stdout.columns || 80
process.stdout.on('resize', () => (columns = process.stdout.columns || columns))

const sgr = (params) => `\x1b[0;${params}m`

/** One line: a prefix, then runs of 1–5 Han characters, each run in its own style, with punctuation and words. */
function line() {
  const kind = random()
  const lineNumber = String(Math.floor(random() * 900) + 10).padStart(4)
  // A reply line, a dim tool result, an added / removed diff row, or a bold heading; `base` is the line's own style.
  let prefix = `${sgr('1')}## `
  let base = '1'
  let background = ''
  if (kind < 0.3) {
    prefix = `${sgr('38;2;215;119;87')}⏺ `
    base = ''
  } else if (kind < 0.6) {
    prefix = `${sgr('2')}  ⎿  `
    base = '2'
  } else if (kind < 0.9) {
    background = kind < 0.8 ? DIFF_ADDED : DIFF_REMOVED
    prefix = `${sgr(background)}  ${lineNumber} ${kind < 0.8 ? '+' : '-'} `
    base = ''
  }
  let width = kind < 0.6 ? 5 : kind < 0.9 ? 10 : 3
  const limit = columns - 4
  let out = prefix
  while (width < limit - 12) {
    const roll = random()
    if (roll < 0.08) {
      const word = pick(ASCII_WORDS)
      out += `${sgr(`${background || CODE_SPAN};38;2;177;185;249`)}${word}`
      width += word.length
    } else if (roll < 0.2) {
      out += `${sgr(background || '0')}${pick(PUNCTUATION)}`
      width += 2
    } else {
      const look = dense ? pick(FOREGROUNDS) : random() < 0.75 ? base : pick(ACCENTS)
      const style = [background, look].filter(Boolean).join(';') || '0'
      const run = 1 + Math.floor(random() * 5)
      let text = ''
      for (let i = 0; i < run; i++) text += han()
      out += `${sgr(style)}${text}`
      width += run * 2
    }
  }
  return `${out}\x1b[0m\x1b[K\r\n`
}

let bursts = 0
let keys = 0
let streaming = null
let streamed = 0

function burst() {
  const n = ++bursts
  newVocabulary()
  let left = BURST_LINES
  const tick = () => {
    let chunk = ''
    for (let i = 0; i < LINES_PER_TICK && left > 0; i++, left--) chunk += line()
    process.stdout.write(chunk)
    if (left > 0) setTimeout(tick, TICK_MS)
    else process.stdout.write(`\x1b[0m@@done ${n}@@\r\n`)
  }
  tick()
}

function stream() {
  if (streaming) return
  const every = Math.max(10, Math.round(1000 / linesPerSecond))
  let owed = 0
  let last = Date.now()
  streaming = setInterval(() => {
    const now = Date.now()
    owed += ((now - last) * linesPerSecond) / 1000
    last = now
    let chunk = ''
    for (; owed >= 1; owed--) {
      if (++streamed % BURST_LINES === 0) newVocabulary()
      chunk += line()
    }
    if (chunk) process.stdout.write(chunk)
  }, every)
}

function stop() {
  if (streaming) clearInterval(streaming)
  streaming = null
  process.stdout.write('\x1b[0m@@stopped@@\r\n')
}

process.stdin.setRawMode?.(true)
process.stdin.on('data', (data) => {
  for (const byte of data) {
    const command = String.fromCharCode(byte)
    if (command === 'g') burst()
    else if (command === 'r') stream()
    else if (command === 's') stop()
    else if (command === 'k') process.stdout.write(`\x1b[0m@@key ${++keys}@@\r\n`)
    else if (command === 'q' || byte === 3) process.exit(0)
  }
})
process.stdin.on('end', () => process.exit(0))
process.stdout.write(`\x1b[0m@@ready ${seed}@@\r\n`)
