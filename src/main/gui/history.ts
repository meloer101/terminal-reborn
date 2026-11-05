// A GUI session's earlier conversation, rebuilt from the agent's own transcript (PRD F23 历史) with the phone's parser
// (@shared/transcript-chat): when it is resumed, and when a reattached process kept too few lines to replay. Claude's
// JSONL under ~/.claude/projects, Codex's rollout under ~/.codex/sessions. Electron-free.

import { existsSync, realpathSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createChatParser, type ChatItem } from '@shared/transcript-chat'
import { claudeTranscriptPath, type AgentDataDirs } from '../hooks/agent-title'

/** Like the phone's first read (remote/feed.ts): the newest part of a long transcript. */
const READ_BYTES = 32 * 1024 * 1024
/** Day folders looked at when searching Codex's rollouts for a thread (newest first). */
const MAX_DAY_DIRS = 400

export interface TranscriptSource {
  agent: 'claude' | 'codex'
  path: string
}

/** `<projects>/<cwd with every non-alphanumeric as ->/<id>.jsonl`, for the folder as given and as resolved. */
export function claudeTranscriptFor(cwd: string, agentSessionId: string, dirs: AgentDataDirs): string | null {
  const folders = new Set([cwd])
  try {
    folders.add(realpathSync(cwd))
  } catch {
    // Gone: only the name as given.
  }
  for (const root of dirs.claudeProjects) {
    for (const folder of folders) {
      const path = claudeTranscriptPath(join(root, folder.replace(/[^A-Za-z0-9]/g, '-'), `${agentSessionId}.jsonl`), dirs)
      if (path && existsSync(path)) return path
    }
  }
  return null
}

const numericDesc = (names: string[]): string[] => names.filter((n) => /^\d+$/.test(n)).sort((a, b) => Number(b) - Number(a))

async function dirs(path: string): Promise<string[]> {
  try {
    return numericDesc(await readdir(path))
  } catch {
    return []
  }
}

/** Codex's rollout of a thread: `sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl`. */
export async function codexRolloutFor(threadId: string, codexHome: string): Promise<string | null> {
  const root = join(codexHome, 'sessions')
  let looked = 0
  for (const year of await dirs(root)) {
    for (const month of await dirs(join(root, year))) {
      for (const day of await dirs(join(root, year, month))) {
        if (++looked > MAX_DAY_DIRS) return null
        const folder = join(root, year, month, day)
        let names: string[]
        try {
          names = await readdir(folder)
        } catch {
          continue
        }
        const name = names.find((n) => n.startsWith('rollout-') && n.endsWith(`-${threadId}.jsonl`))
        if (name) return join(folder, name)
      }
    }
  }
  return null
}

/** Every chat item of a transcript (its newest READ_BYTES). */
export async function readTranscript(source: TranscriptSource): Promise<ChatItem[] | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const size = (await stat(source.path)).size
    const length = Math.min(size, READ_BYTES)
    handle = await open(source.path, 'r')
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    let text = buffer.toString('utf8')
    // Started mid-file: the first line is cut.
    if (length < size) text = text.slice(text.indexOf('\n') + 1)
    const parser = createChatParser(source.agent)
    for (const line of text.split('\n')) parser.push(line)
    return parser.items.slice()
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
