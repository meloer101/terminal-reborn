/* eslint-disable no-undef */
// Photos from the phone into a running Claude (remote control, PRD §6.16): a solid-colour image saved as PNG, JPEG and
// HEIC (what an iPhone sends), its path bracket-pasted with a question and submitted. Checks what the transcript holds
// (an image block and its media type) and what Claude answers. Spends a few small turns.
//   usage: cd <a trusted folder> && node scripts/spikes/51-remote-image-lab.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { claudeWaitIdle, launch, PASTE_END, PASTE_START, sleep } from './harness.mjs'

function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function solidPng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const dir = mkdtempSync(join(tmpdir(), 'trspike-photo-'))
const png = join(dir, 'photo.png')
writeFileSync(png, solidPng(256, 256, [220, 30, 30]))
const jpg = join(dir, 'photo.jpg')
const heic = join(dir, 'IMG_0001.HEIC')
execFileSync('sips', ['-s', 'format', 'jpeg', png, '--out', jpg], { stdio: 'ignore' })
execFileSync('sips', ['-s', 'format', 'heic', png, '--out', heic], { stdio: 'ignore' })

const cwd = process.cwd()
const transcript = () => {
  const d = join(process.env.HOME, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
  const f = readdirSync(d)
    .filter((x) => x.endsWith('.jsonl'))
    .map((x) => [join(d, x), statSync(join(d, x)).mtimeMs])
    .sort((a, b) => b[1] - a[1])[0][0]
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

const c = launch('claude', [], { cwd })
await c.waitFor(/❯/, 30000)
await sleep(2500)
// A warm-up turn first: the session's transcript file only appears with the first prompt.
c.write('Reply with only the word OK.\r')
await claudeWaitIdle(c, { maxMs: 60000 })
for (const [name, file] of [
  ['png', png],
  ['jpeg', jpg],
  ['heic', heic]
]) {
  const before = transcript().length
  c.write(PASTE_START + file + PASTE_END)
  await c.settle(600, 6000)
  const composer = c.visible().split('\n').findLast((l) => /^\s*❯/.test(l))?.trim()
  c.write(' What single colour fills this image? Reply with one lowercase English word, or "none" if you see no image.')
  await sleep(300)
  c.write('\r')
  await claudeWaitIdle(c, { maxMs: 90000 })
  const added = transcript().slice(before)
  const user = added.find((o) => o.type === 'user' && Array.isArray(o.message?.content) && !o.isMeta)
  const blocks = (user?.message.content ?? []).map((b) => (b.type === 'image' ? `image:${b.source?.media_type}` : b.type))
  const reply = added
    .filter((o) => o.type === 'assistant')
    .flatMap((o) => o.message.content.filter((b) => b.type === 'text').map((b) => b.text))
    .join(' ')
  console.log(name.padEnd(5), 'composer:', JSON.stringify(composer), 'blocks:', JSON.stringify(blocks), 'reply:', JSON.stringify(reply.slice(0, 80)))
}
c.write('\x03')
await sleep(300)
c.write('\x03')
await sleep(1500)
c.kill()
process.exit(0)
