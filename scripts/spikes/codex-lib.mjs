/* eslint-disable no-undef */
// Shared helpers for the Codex experiments.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { launch, makeRepo, sleep } from './harness.mjs'

export const CODEX_BUSY = /esc to interrupt|Working \(/

/** Fresh git repo; folder trust pre-accepted per launch via -c (no global config write). */
export function codexRepo() {
  return realpathSync(makeRepo('codex'))
}

export function launchCodex(cwd, extraArgs = []) {
  return launch(
    'codex',
    ['-c', 'check_for_update_on_startup=false', '-c', `projects={"${cwd}"={trust_level="trusted"}}`, ...extraArgs],
    { cwd }
  )
}

export async function codexReady(c) {
  const ms = await c.waitFor(/›/, 20000)
  await sleep(2500) // MCP startup warnings etc. settle
  return ms
}

/** Newest Codex rollout file whose first line mentions `cwd`. */
export function codexUserMessages(cwd) {
  const root = join(process.env.HOME, '.codex', 'sessions')
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) files.push({ p, t: statSync(p).mtimeMs })
    }
  }
  walk(root)
  files.sort((a, b) => b.t - a.t)
  for (const f of files.slice(0, 20)) {
    const lines = readFileSync(f.p, 'utf8').split('\n').filter(Boolean)
    if (!lines[0]?.includes(cwd)) continue
    const out = []
    for (const l of lines) {
      const o = JSON.parse(l)
      const pl = o.payload
      if (o.type === 'response_item' && pl?.type === 'message' && pl.role === 'user') {
        out.push(pl.content.map((b) => b.text ?? '').join(''))
      }
    }
    return out
  }
  return []
}
