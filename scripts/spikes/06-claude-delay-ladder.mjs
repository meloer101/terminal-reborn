/* eslint-disable no-undef */
// Q1 (Claude): how long must \r wait after the paste-end marker? Each attempt submits a trivial prompt and
// interrupts with Esc as soon as submission is observed. usage: EXP_REPO=... node 06-... [reps]
import { expRepo, launch, sleep, PASTE_START, PASTE_END } from './harness.mjs'

const reps = Number(process.argv[2] ?? 2)
const c = launch('claude', [], { cwd: expRepo() })
await c.waitFor(/Try "/, 20000)
await sleep(1500)

/** Last `❯` row of the screen = the live prompt. */
function livePrompt() {
  const rows = c.visible().split('\n').filter((l) => l.startsWith('❯'))
  return rows.at(-1) ?? ''
}
const isEmptyPrompt = (p) => p.trim() === '❯' || p.startsWith('❯ Try ')

const okCount = () => c.screen().split('\n').filter((l) => /^⏺ OK/.test(l)).length
const SPINNER = /esc to interrupt|[✢✳✶✻✽·*] \S+…/

async function attempt(label, fn) {
  const before = okCount()
  await fn()
  // Definitive proof of submission: a turn starts (spinner) and finishes with a new "⏺ OK" row.
  const started = (await c.waitFor(SPINNER, 4000)) >= 0
  let outcome = 'not-submitted'
  if (started) {
    const t = Date.now()
    while (Date.now() - t < 45000 && okCount() === before) await sleep(200)
    outcome = okCount() > before ? 'submitted+answered' : 'started-no-answer'
    await sleep(1500)
  }
  if (process.env.VERBOSE || process.argv[5]) {
    console.log(c.visible().split('\n').filter((l) => l.trim() && !/^[─ ]+$/.test(l)).map((l) => '    | ' + l.slice(0, 110)).join('\n'))
  }
  const lp = livePrompt()
  console.log(label.padEnd(36), outcome, isEmptyPrompt(lp) ? '' : `prompt=${JSON.stringify(lp.slice(0, 70))}`)
  if (!isEmptyPrompt(lp)) {
    c.write('\x03') // clear leftover text so attempts stay independent
    await sleep(800)
  }
  return outcome
}

// argv[4] PROMPT may contain \n escapes; use e.g. PROMPT='Reply with just OK.\n.\n.\n.' to force a [Pasted text] placeholder.
const gen = /^gen:(ascii|cjk):(\d+)$/.exec(process.argv[4] ?? '')
const head = 'Reply with just OK. Ignore the filler that follows. '
const text = gen
  ? head + (gen[1] === 'cjk' ? '你好世界今天天气不错' : 'lorem ipsum ').repeat(Number(gen[2]) / 10).slice(0, Number(gen[2]))
  : (process.argv[4] ?? 'Reply with just OK.').replace(/\\n/g, '\n')
const delays = (process.argv[3] ?? '0,10,30,60,120').split(',').map(Number)
for (const d of delays) {
  for (let r = 0; r < reps; r++) {
    await attempt(`paste, wait ${d}ms, \\r  (rep ${r + 1})`, async () => {
      c.write(PASTE_START + text + PASTE_END)
      await sleep(d)
      c.write('\r')
    })
  }
}
for (let r = 0; r < reps; r++) {
  await attempt(`single write paste+\\r (rep ${r + 1})`, async () => {
    c.write(PASTE_START + text + PASTE_END + '\r')
  })
}
const transcript = c.screen().split('\n').filter((l) => /^(❯|⏺|⎿)/.test(l) && !l.startsWith('❯ Try'))
console.log('--- transcript rows (user echo / assistant / notices) ---')
console.log(transcript.join('\n'))
c.kill()
process.exit(0)
