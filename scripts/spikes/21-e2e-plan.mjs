/* eslint-disable no-undef */
// End-to-end check of the shipped planner/executor (src/shared/send-*.ts) against the real CLIs.
// Bundles the TypeScript on the fly with esbuild. usage: node 21-e2e-plan.mjs claude|codex
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { codexReady, codexRepo, codexUserMessages, launchCodex } from './codex-lib.mjs'
import { CLAUDE_SPINNER, claudeUserMessages, expRepo, launch, sleep } from './harness.mjs'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const out = join(mkdtempSync(join(tmpdir(), 'trspike-bundle-')), 'send.mjs')
await esbuild.build({
  stdin: {
    contents: "export * from './send-protocol'; export * from './send-executor'",
    resolveDir: resolve(import.meta.dirname, '../../src/shared'),
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  outfile: out,
  logLevel: 'error'
})
const { planSend, createSendQueue, sendQueued, detectBlockingDialog } = await import(pathToFileURL(out).href)

const agent = process.argv[2]
let c
let cwd
if (agent === 'claude') {
  cwd = expRepo()
  c = launch('claude', [], { cwd })
  await c.waitFor(/Try "/, 20000)
  await sleep(1500)
} else {
  cwd = codexRepo()
  c = launchCodex(cwd)
  await codexReady(c)
}
console.log('blocking dialog at idle:', detectBlockingDialog(c.screen()))
const io = { write: (d) => c.write(d), readScreen: () => c.screen(true) }
const queue = createSendQueue()
const busy = () => (agent === 'claude' ? CLAUDE_SPINNER.test(c.visible()) : /Working \(/.test(c.visible()))
const idle = async () => {
  await sleep(1500)
  const t = Date.now()
  while (busy() && Date.now() - t < 90000) await sleep(400)
  await sleep(1500)
}

const messages = [
  'Reply with just the word ALPHA.',
  'Reply with just the word BRAVO.\nignore\nignore\nignore\nignore',
  'Reply with just the word CHARLIE. Ignore the filler: ' + '你好世界今天天气不错'.repeat(150),
  'Reply with just the word DELTA. Ignore the filler: ' + 'lorem ipsum '.repeat(100)
]
for (const m of messages) {
  const t0 = Date.now()
  await sendQueued(queue, 's1', planSend(m, agent), io)
  console.log(`sent ${JSON.stringify(m.slice(0, 40))} (${m.length} chars) in ${Date.now() - t0} ms`)
  await idle()
}

// queued send while busy: first long-ish answer, second message sent while it runs
await sendQueued(queue, 's1', planSend('Write a 150-word story about a dog. Do not use tools.', agent), io)
await sleep(1500)
const t0 = Date.now()
await sendQueued(queue, 's1', planSend('Reply with just the word ECHO.', agent), io)
console.log(`send while busy took ${Date.now() - t0} ms; busy=${busy()}`)
await idle()
await sleep(8000)
await idle()

// local slash command
await sendQueued(queue, 's1', planSend(agent === 'claude' ? '/model' : '/status', agent), io)
await sleep(2000)
console.log('slash command ran:', agent === 'claude' ? /Select model/.test(c.visible()) : /Session:\s+[0-9a-f-]{8}/.test(c.visible()))
c.write('\x1b')
await sleep(500)

const got = agent === 'claude' ? claudeUserMessages(cwd) : codexUserMessages(cwd)
console.log('--- received by the model ---')
for (const m of got.filter((x) => !x.startsWith('<environment_context>'))) console.log(`(${m.length} chars)`, JSON.stringify(m.slice(0, 90)))
c.kill()
process.exit(0)
