// A GUI session's earlier conversation, rebuilt from the agent's own transcript (PRD F23 历史) with the phone's parser
// (@shared/transcript-chat): when it is resumed, and when a reattached process kept too few lines to replay. Claude's
// JSONL under ~/.claude/projects, Codex's rollout under ~/.codex/sessions, Pi's session file under
// ~/.pi/agent/sessions (read with pi-rpc.ts). Electron-free.

import type { ClaudeOrCodex } from '@shared/agents'
import { existsSync, realpathSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { createChatParser, type ChatItem, type KeepImage } from '@shared/transcript-chat'
import { claudeTranscriptPath, type AgentDataDirs } from '../hooks/agent-title'
import { currentBranch, resumePointOf } from './claude-rewind'
import { piBranchMessages, piHistoryItems } from './pi-rpc'

/** Like the phone's first read (remote/feed.ts): the newest part of a long transcript. */
const READ_BYTES = 32 * 1024 * 1024
/** Day folders looked at when searching Codex's rollouts for a thread (newest first). */
const MAX_DAY_DIRS = 400

export interface TranscriptSource {
  agent: ClaudeOrCodex
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

/** Pi's sessions folder: `$PI_CODING_AGENT_DIR/sessions` or ~/.pi/agent/sessions (Paseo session-descriptor.ts). */
export function piSessionsDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const agentDir = env.PI_CODING_AGENT_DIR && isAbsolute(env.PI_CODING_AGENT_DIR) ? env.PI_CODING_AGENT_DIR : join(home, '.pi', 'agent')
  return join(agentDir, 'sessions')
}

/** Folders of Pi's sessions folder looked at (one per working folder). */
const MAX_PI_DIRS = 2_000

/** Pi's folder name for a working folder (session-manager.js `getDefaultSessionDirPath`, 0.84.1). */
export const piSessionFolder = (cwd: string): string => `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`

/**
 * Pi's session file of a conversation: `<sessions>/--<cwd>--/<time>_<id>.jsonl` — in the folder of `cwd` (as given or
 * resolved; Pi names it after its process's folder), else whichever folder holds it.
 */
export async function piSessionFileFor(sessionId: string, sessionsDir: string, cwd?: string): Promise<string | null> {
  const find = async (folder: string): Promise<string | null> => {
    try {
      const name = (await readdir(join(sessionsDir, folder))).find((n) => n.endsWith(`_${sessionId}.jsonl`))
      return name ? join(sessionsDir, folder, name) : null
    } catch {
      return null
    }
  }
  const cwds = new Set<string>()
  if (cwd) {
    cwds.add(cwd)
    try {
      cwds.add(realpathSync(cwd))
    } catch {
      // Gone: only the name as given.
    }
  }
  for (const folder of cwds) {
    const hit = await find(piSessionFolder(folder))
    if (hit) return hit
  }
  let folders: string[]
  try {
    folders = (await readdir(sessionsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return null
  }
  for (const folder of folders.slice(0, MAX_PI_DIRS)) {
    const hit = await find(folder)
    if (hit) return hit
  }
  return null
}

/** A Pi session file's conversation (its active branch). */
export async function readPiHistory(path: string, cwd: string, keep?: KeepImage): Promise<ChatItem[] | null> {
  const lines = await readLines(path)
  return lines ? piHistoryItems(piBranchMessages(lines), cwd, keep) : null
}

/** A transcript's lines (its newest READ_BYTES); null when it cannot be read. */
async function readLines(path: string): Promise<string[] | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const size = (await stat(path)).size
    const length = Math.min(size, READ_BYTES)
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    let text = buffer.toString('utf8')
    // Started mid-file: the first line is cut.
    if (length < size) text = text.slice(text.indexOf('\n') + 1)
    return text.split('\n')
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

const parseRow = (line: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Every chat item of a transcript; for Claude only its current branch (an edit leaves the cut turns in the file).
 * `keepImage` keeps the pictures sent inline as files.
 */
export async function readTranscript(source: TranscriptSource, keepImage?: KeepImage): Promise<ChatItem[] | null> {
  const lines = await readLines(source.path)
  if (!lines) return null
  const keep = source.agent === 'claude' ? currentBranch(lines.map(parseRow)) : null
  const parser = createChatParser(source.agent, undefined, keepImage)
  lines.forEach((line, i) => {
    if (!keep || keep[i]) parser.push(line)
  })
  return parser.items.slice()
}

/** Claude: where `--resume-session-at` resumes to edit the prompt `messageId` (claude-rewind.ts resumePointOf). */
export async function claudeResumePoint(path: string, messageId: string): Promise<string | null | undefined> {
  const lines = await readLines(path)
  return lines ? resumePointOf(lines.map(parseRow), messageId) : undefined
}
