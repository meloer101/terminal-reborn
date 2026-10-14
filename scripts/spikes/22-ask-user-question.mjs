/* eslint-disable no-undef */
// prompt-bar spike: drive the real Claude TUI's AskUserQuestion menu and record what each key sequence does.
// Usage: SCENARIO=single|multi|multiq|twosingle node scripts/spikes/22-ask-user-question.mjs '[["label","bytes"],500,...]'
// Lab dir /tmp/tr-prompt-lab (trusted once). Each run is ONE short Claude turn.
import { launch, show, sleep } from './harness.mjs'

const LAB = '/tmp/tr-prompt-lab'
const scenario = process.env.SCENARIO ?? 'single'
const PROMPTS = {
  single:
    'Call the AskUserQuestion tool once with ONE single-select question "Pick a colour" (header "Colour") with options Red, Green, Blue. After I answer, reply with only: ANSWER=<what I chose>',
  multi:
    'Call the AskUserQuestion tool once with ONE multi-select question "Pick fruits" (header "Fruit", multiSelect true) with options Apple, Banana, Cherry, Date. After I answer, reply with only: ANSWER=<what I chose>',
  twosingle:
    'Call the AskUserQuestion tool once with TWO single-select questions: (1) "Pick a colour" header "Colour" options Red, Green, Blue; (2) "Pick a size" header "Size" options Small, Large. After I answer, reply with only: ANSWER=<both answers>',
  multiq:
    'Call the AskUserQuestion tool once with TWO questions: (1) single-select "Pick a colour" header "Colour" options Red, Green, Blue; (2) multi-select "Pick fruits" header "Fruit" options Apple, Banana, Cherry. After I answer, reply with only: ANSWER=<both answers>'
}

// Key plan: array of [label, bytes] or a delay in ms; edit via argv[2] JSON after observing the menu.
const plan = process.argv[2] ? JSON.parse(process.argv[2]) : []

const c = launch('claude', [], { cwd: LAB })
if ((await c.waitFor(/Yes, I trust this folder|Try "/, 20000)) < 0) {
  show('startup failed', c.visible())
  c.kill()
  process.exit(1)
}
if (c.visible().includes('Yes, I trust this folder')) {
  await sleep(1500)
  c.write('\x1b[B')
  await sleep(500)
  c.write('\r')
  await c.waitFor('Try "', 20000)
}
await sleep(1500)
c.write('\x1b[200~' + PROMPTS[scenario] + '\x1b[201~')
await sleep(400)
c.write('\r')
const seen = await c.waitFor(/Other|Type something/, 90000)
await sleep(1500)
show(`menu (${seen}ms)`, c.visible())
for (const step of plan) {
  if (typeof step === 'number') {
    await sleep(step)
    continue
  }
  const [label, data] = step
  c.write(data)
  await sleep(700)
  show(`after ${label}`, c.visible())
}
if (plan.length) {
  await sleep(15000)
  show('final', c.screen(true).split('\n').filter((l) => l.trim()).slice(-30).join('\n'))
}
c.kill()
process.exit(0)
